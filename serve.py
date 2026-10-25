#!/usr/bin/env python3
"""Servidor estático local (solo 127.0.0.1:8765). Sin dependencias."""
import http.server, os, sys
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.onnx': 'application/octet-stream'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Abre http://localhost:{port}')
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
