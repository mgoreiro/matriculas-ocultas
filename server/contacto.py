#!/usr/bin/env python3
"""Servicio de contacto de «Ocultar matrículas» (solo biblioteca estándar de Python).

Recibe el formulario (POST /api/contacto, JSON) y lo envía por correo a CONTACT_TO.
Se configura por variables de entorno (o un fichero .env junto a este script / el indicado en MATRICULAS_ENV):

  CONTACT_TO     destinatario de los mensajes (obligatorio)            p. ej. mgoreiro@gmail.com
  SMTP_HOST      servidor SMTP (por defecto localhost)
  SMTP_PORT      puerto (por defecto 587; 465 usa SSL implícito; 25/otros según SMTP_SECURITY)
  SMTP_SECURITY  starttls | ssl | none   (por defecto: ssl si el puerto es 465, si no starttls)
  SMTP_USER / SMTP_PASSWORD   credenciales (opcionales)
  FROM_MODE      user   -> cabecera From = nombre y correo que escribe el visitante (Reply-To igual)
                 server -> From = SMTP_FROM (o SMTP_USER) y Reply-To = visitante (mejor entregabilidad)
  SMTP_FROM      remitente propio para FROM_MODE=server
  CONTACT_PORT   puerto de escucha cuando se ejecuta como servicio (127.0.0.1:8770)
  MAIL_DRY_RUN   1 -> no envía, solo escribe el correo en el log (pruebas)
"""
import json, os, re, smtplib, ssl, sys, time, threading
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    for path in (os.environ.get('MATRICULAS_ENV'), os.path.join(HERE, '.env'), os.path.join(HERE, '..', '.env')):
        if path and os.path.isfile(path):
            for line in open(path, encoding='utf-8'):
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))
            break


load_env()
EMAIL_RE = re.compile(r'^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]{2,}$')
CTRL_RE = re.compile(r'[\x00-\x1f\x7f]')
_hits, _lock = {}, threading.Lock()


def rate_limited(ip, per_hour=5):
    now = time.time()
    with _lock:
        hits = [t for t in _hits.get(ip, []) if now - t < 3600]
        if len(hits) >= per_hour:
            _hits[ip] = hits
            return True
        hits.append(now)
        _hits[ip] = hits
        return False


def build_message(name, email, text, ip, ua):
    cfg = os.environ
    msg = EmailMessage()
    msg['Subject'] = 'Comentario sobre app matrículas de ' + name
    msg['To'] = cfg['CONTACT_TO']
    if cfg.get('FROM_MODE', 'user') == 'server':
        msg['From'] = formataddr((name + ' (vía formulario)', cfg.get('SMTP_FROM') or cfg.get('SMTP_USER') or cfg['CONTACT_TO']))
    else:
        msg['From'] = formataddr((name, email))
    msg['Reply-To'] = formataddr((name, email))
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='matriculas-ocultas')
    msg.set_content(f'Nombre: {name}\nCorreo: {email}\n\n{text}\n\n--\nEnviado desde el formulario de contacto (IP {ip}; {ua[:120]})\n')
    return msg


def send(msg):
    cfg = os.environ
    if cfg.get('MAIL_DRY_RUN') == '1':
        print('--- MAIL_DRY_RUN ---\n' + msg.as_string() + '\n--------------------', file=sys.stderr, flush=True)
        return
    host, port = cfg.get('SMTP_HOST', 'localhost'), int(cfg.get('SMTP_PORT', '587'))
    sec = cfg.get('SMTP_SECURITY') or ('ssl' if port == 465 else 'starttls')
    envelope_from = cfg.get('SMTP_USER') or cfg.get('SMTP_FROM') or cfg['CONTACT_TO']
    ctx = ssl.create_default_context()
    smtp = smtplib.SMTP_SSL(host, port, timeout=20, context=ctx) if sec == 'ssl' else smtplib.SMTP(host, port, timeout=20)
    with smtp:
        if sec == 'starttls':
            smtp.starttls(context=ctx)
        if cfg.get('SMTP_USER'):
            smtp.login(cfg['SMTP_USER'], cfg.get('SMTP_PASSWORD', ''))
        smtp.send_message(msg, from_addr=envelope_from, to_addrs=[cfg['CONTACT_TO']])


def handle_contact(raw, ip, ua='', origin=None, host=None):
    """Devuelve (código HTTP, dict JSON). Reutilizado por serve.py (desarrollo) y por este servicio."""
    if not os.environ.get('CONTACT_TO'):
        return 503, {'error': 'El formulario de contacto no está configurado en el servidor.'}
    if origin and host and origin.split('://', 1)[-1] != host:
        return 403, {'error': 'Origen no permitido.'}
    try:
        d = json.loads(raw.decode('utf-8'))
        assert isinstance(d, dict)
    except Exception:
        return 400, {'error': 'Petición no válida.'}
    if d.get('website'):                      # campo trampa para bots: se finge éxito
        return 200, {'ok': True}
    name = CTRL_RE.sub(' ', str(d.get('name', ''))).strip()
    email = CTRL_RE.sub('', str(d.get('email', ''))).strip()
    text = str(d.get('message', '')).replace('\r\n', '\n').strip()
    if not (1 <= len(name) <= 100):
        return 400, {'error': 'Escribe tu nombre (máx. 100 caracteres).'}
    if len(email) > 254 or not EMAIL_RE.match(email):
        return 400, {'error': 'El correo no parece válido.'}
    if not (10 <= len(text) <= 5000):
        return 400, {'error': 'El mensaje debe tener entre 10 y 5000 caracteres.'}
    if d.get('consent') is not True:
        return 400, {'error': 'Debes aceptar el tratamiento de tus datos para poder responderte.'}
    if rate_limited(ip):
        return 429, {'error': 'Demasiados mensajes desde tu conexión; inténtalo más tarde.'}
    try:
        send(build_message(name, email, text, ip, ua))
    except Exception as e:                    # no filtramos detalles al visitante
        print('Error enviando correo:', repr(e), file=sys.stderr, flush=True)
        return 502, {'error': 'No se pudo enviar el mensaje ahora mismo. Inténtalo más tarde.'}
    return 200, {'ok': True}


class Handler(BaseHTTPRequestHandler):
    server_version = 'contacto'

    def _reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._reply(200, {'ok': True}) if self.path.rstrip('/') == '/api/health' else self._reply(404, {'error': 'no encontrado'})

    def do_POST(self):
        if self.path.rstrip('/') != '/api/contacto':
            return self._reply(404, {'error': 'no encontrado'})
        n = int(self.headers.get('Content-Length') or 0)
        if n > 20000:
            return self._reply(413, {'error': 'Mensaje demasiado largo.'})
        ip = self.headers.get('X-Real-IP') if self.client_address[0] in ('127.0.0.1', '::1') and self.headers.get('X-Real-IP') else self.client_address[0]
        code, obj = handle_contact(self.rfile.read(n), ip, self.headers.get('User-Agent', ''), self.headers.get('Origin'), self.headers.get('Host'))
        self._reply(code, obj)

    def log_message(self, fmt, *a):
        print('%s - %s' % (self.address_string(), fmt % a), file=sys.stderr, flush=True)


if __name__ == '__main__':
    if not os.environ.get('CONTACT_TO'):
        sys.exit('Falta CONTACT_TO (destinatario). Ver la cabecera de este fichero y .env.example')
    port = int(os.environ.get('CONTACT_PORT', '8770'))
    print(f'Servicio de contacto en 127.0.0.1:{port} → {os.environ["CONTACT_TO"]}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
