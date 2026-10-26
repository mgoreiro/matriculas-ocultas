#!/usr/bin/env python3
"""Servidor estático local (solo 127.0.0.1:8765). Sin dependencias."""
import http.server, os, sys
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.onnx': 'application/octet-stream'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        # mismas cabeceras de seguridad que deploy/nginx-matriculas.conf
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()
os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Abre http://localhost:{port}')
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
