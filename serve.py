#!/usr/bin/env python3
"""Servidor estático local (solo 127.0.0.1:8765). Sin dependencias."""
import http.server, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server'))
import contacto  # mismo manejador que en producción (POST /api/contacto)
import json
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.onnx': 'application/octet-stream'}
    def do_POST(self):
        if self.path.rstrip('/') != '/api/contacto':
            return self.send_error(404)
        n = int(self.headers.get('Content-Length') or 0)
        code, obj = contacto.handle_contact(self.rfile.read(min(n, 20000)), self.client_address[0], self.headers.get('User-Agent', ''), self.headers.get('Origin'), self.headers.get('Host'))
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

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
