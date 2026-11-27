"""Validate actual cached bytes, all train indexes, and snapshot coverage."""
from pathlib import Path
import gzip, hashlib, json, re
root = Path(__file__).resolve().parents[1]/'dist/data/timetables'
manifest = json.loads((root/'index.json').read_text('utf-8'))
assert not manifest['errors'], manifest['errors']
assert len(manifest['snapshots']) == manifest['discovered'], 'Incomplete source download'
codes = set()
schedules = 0
for item in manifest['snapshots']:
    assert re.fullmatch(r'\d{4}\.\d{2}\.\d{2}', item['date'])
    assert re.fullmatch(r'[a-f0-9]{64}\.json\.gz', item['file'])
    raw = gzip.decompress((root/item['file']).read_bytes())
    assert hashlib.sha256(raw).hexdigest() == item['sha256']
    book = json.loads(raw)
    assert len(book['index']) == item['trains']
    assert len(book['records']) == item['schedules']
    for code, ids in book['index'].items():
        assert re.fullmatch(r'[A-Z]*\d+[A-Z]?', code), code
        assert ids
        for i in ids: assert code in book['records'][i]['codes']
    for row in book['records']:
        assert not row['id'].startswith('DUMMY')
        assert len(row['stops']) >= 2
        for s in row['stops']:
            assert isinstance(s[0], str) and s[0].strip()
            assert isinstance(s[3], int) and s[3] >= 0
    codes.update(book['index'])
    schedules += len(book['records'])
print('PASS: %d snapshots; %d distinct train numbers; %d train/version records' % (len(manifest['snapshots']),len(codes),schedules))
