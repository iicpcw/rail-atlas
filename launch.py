from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import webbrowser
root = Path(__file__).resolve().parent / "dist"
if not (root / "index.html").is_file():
    raise SystemExit("Missing dist/index.html. Extract the complete ZIP before starting.")
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
try:
    server = ThreadingHTTPServer(("127.0.0.1", 8765), handler)
except OSError:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
url = "http://127.0.0.1:{}/".format(server.server_port)
print("Travel map: " + url, flush=True)
print("Keep this window open. Press Ctrl+C to stop.", flush=True)
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
