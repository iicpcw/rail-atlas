"""Download every published bulk snapshot; never restrict to imported train numbers.

Python 3.7+, standard library only. Resumable downloads and content-addressed gzip.
Run from any directory: python scripts/cache-timetables.py --downloads PATH
"""
import argparse, csv, gzip, hashlib, io, json, re, time, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/data/timetables'
CODE = re.compile(r'^[A-Z]*\d+[A-Z]?(?:/[A-Z]*\d+[A-Z]?)*$')

def request(url):
    for attempt in range(4):
        try:
            return urlopen(Request(url, headers={'User-Agent': 'rail-atlas-public-timetable-cache'}), timeout=90)
        except HTTPError as e:
            # Do not rotate hosts or evade access controls.
            if e.code in (400, 401, 403, 404): raise
            if e.code == 429: time.sleep(min(60, int(e.headers.get('Retry-After', '30'))))
            elif e.code >= 500: time.sleep(2 ** attempt)
            else: raise
        except OSError:
            if attempt == 3: raise
            time.sleep(2 ** attempt)
    raise RuntimeError('Retries exhausted: ' + url)

def getjson(url):
    with request(url) as r: return json.load(r)

def download(url, target):
    if target.exists(): return
    tmp = target.with_suffix(target.suffix + '.part')
    with request(url) as r, tmp.open('wb') as f:
        while True:
            block = r.read(1024 * 1024)
            if not block: break
            f.write(block)
    tmp.replace(target)

def aliases(code):
    # Full slash-separated codes only; expand abbreviated G123/6 to G126.
    parts = code.upper().split('/')
    result = [parts[0]]
    for part in parts[1:]:
        if part.isdigit():
            m = re.match(r'([A-Z]*)(\d+)$', parts[0])
            if m: part = m[1] + m[2][:-len(part)] + part
        result.append(part)
    return list(dict.fromkeys(result))

def rhythm(path):
    raw = json.loads(path.read_text(encoding='utf-8-sig'))
    records = []
    for key, stops in raw.items():
        if not isinstance(stops, list) or len(stops) < 2: continue
        codes = list(dict.fromkeys(s.get('station_train_code', '').upper() for s in stops))
        codes = [c for c in codes if CODE.fullmatch(c)]
        if not codes: continue
        ordered = sorted(stops, key=lambda s: int(s['station_no']))
        rows = [[s['station_name'], s.get('arrive_time', ''), s.get('start_time', ''),
                 int(s.get('arrive_day_diff') or 0)] for s in ordered]
        records.append({'id': key, 'codes': list(dict.fromkeys(a for c in codes for a in aliases(c))), 'stops': rows})
    return records, 0

def gtfs(path):
    records = []
    skipped = 0
    with zipfile.ZipFile(str(path)) as z:
        def rows(name): return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))
        names = {s['stop_id']: s['stop_name'] for s in rows('stops.txt')}
        trips = {}
        dates = {}
        if 'calendar_dates.txt' in z.namelist():
            for d in rows('calendar_dates.txt'):
                if d['exception_type'] == '1': dates.setdefault(d['service_id'], []).append(d['date'])
        for t in rows('trips.txt'):
            c = t.get('trip_short_name', '').upper()
            if t['trip_id'].startswith('DUMMY') or not CODE.fullmatch(c):
                skipped += 1
                continue
            trips[t['trip_id']] = {'id': t['trip_id'], 'codes': aliases(c), 'stops': [], 'service': t['service_id']}
        for s in rows('stop_times.txt'):
            t = trips.get(s['trip_id'])
            if t is None: continue
            def clock(value):
                if not value: return '', 0
                h, m = value.split(':')[:2]
                return '%02d:%s' % (int(h) % 24, m), int(h) // 24
            arrival, day = clock(s['arrival_time'])
            departure, depday = clock(s['departure_time'])
            t['stops'].append((int(s['stop_sequence']), [names[s['stop_id']], arrival, departure, day, depday]))
        for t in trips.values():
            t['stops'] = [s[1] for s in sorted(t['stops'])]
            service = t.pop('service')
            if service in dates: t['dates'] = sorted(set(dates[service]))
            if len(t['stops']) >= 2: records.append(t)
    return records, skipped

def save_snapshot(records, date, source, skipped):
    # Identical train objects deduplicated within each snapshot, aliases reference all variants.
    records.sort(key=lambda r: r['id'])
    index = {}
    for i, r in enumerate(records):
        for code in r['codes']: index.setdefault(code, []).append(i)
    data = json.dumps({'schema': 1, 'records': records, 'index': index}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(data).hexdigest()
    file = digest + '.json.gz'
    if not (OUT / file).exists():
        with (OUT / file).open('wb') as target:
            with gzip.GzipFile(filename='', mode='wb', fileobj=target, compresslevel=9, mtime=0) as compressed:
                compressed.write(data)
    return dict(date=date, source=source, file=file, sha256=digest, trains=len(index), schedules=len(records), excludedSynthetic=skipped, bytes=(OUT/file).stat().st_size)

def sources():
    repo = 'wj0575/RailRhythm12306'
    tree = getjson('https://api.github.com/repos/' + repo + '/git/trees/main?recursive=1')
    for item in tree['tree']:
        m = re.fullmatch(r'train_data/train_list(\d{8})\.json', item['path'])
        if m:
            day = m[1]
            yield dict(id='rhythm-'+day, date=day[:4]+'.'+day[4:6]+'.'+day[6:], kind='rhythm', url='https://raw.githubusercontent.com/'+repo+'/main/'+item['path'], source='RailRhythm12306', suffix='.json')
    page = 1
    while True:
        releases = getjson('https://api.github.com/repos/wensimehrp/chinese-railway-gtfs/releases?per_page=100&page='+str(page))
        if not releases: break
        for release in releases:
            for asset in release['assets']:
                if asset['name'] == 'output_gtfs.zip':
                    m = re.search(r'(\d{8})', release['tag_name'])
                    if not m: continue
                    day = m[1]
                    yield dict(id=release['tag_name'], date=day[:4]+'.'+day[4:6]+'.'+day[6:], kind='gtfs', url=asset['browser_download_url'], source='chinese-railway-gtfs (CC BY 4.0)', suffix='.zip')
        page += 1

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, default=ROOT.parent/'timetable-downloads')
    args = parser.parse_args()
    args.downloads.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = OUT/'index.json'
    old = json.loads(manifest.read_text('utf-8')) if manifest.exists() else {'snapshots': []}
    completed = {s['id']: s for s in old['snapshots']}
    catalog = list(sources())
    errors = []
    pool = ThreadPoolExecutor(max_workers=4)
    downloads = {s['id']: pool.submit(download, s['url'], args.downloads/(s['id']+s['suffix'])) for s in catalog if s['id'] not in completed}
    def checkpoint():
        report = dict(schema=1, generatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), scope='All published bulk files from the listed sources; not all Chinese historical timetables.', discovered=len(catalog), snapshots=sorted(completed.values(), key=lambda s:(s['date'],s['id'])), errors=errors, missingYears=list(range(2019,2025)))
        tmp = manifest.with_suffix('.tmp')
        tmp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        tmp.replace(manifest)
    for i, s in enumerate(catalog):
        if s['id'] in completed and (OUT/completed[s['id']]['file']).exists(): continue
        try:
            path = args.downloads/(s['id']+s['suffix'])
            if s['id'] in downloads: downloads[s['id']].result()
            else: download(s['url'], path)
            records, skipped = (rhythm if s['kind']=='rhythm' else gtfs)(path)
            if not records: raise ValueError('No usable train records')
            item = save_snapshot(records, s['date'], s['source'], skipped)
            item.update(id=s['id'], url=s['url'])
            completed[s['id']] = item
            print('%d/%d %s: %d trains, %d schedules' % (i+1,len(catalog),s['id'],item['trains'],item['schedules']), flush=True)
        except Exception as e:
            errors.append(dict(id=s['id'], error=str(e)))
            print('FAILED '+s['id']+': '+str(e), flush=True)
        checkpoint()
    checkpoint()
    pool.shutdown()
    print('Cached %d/%d bulk files; errors %d' % (len(completed),len(catalog),len(errors)), flush=True)
    if errors: raise SystemExit(1)

if __name__ == '__main__': main()
