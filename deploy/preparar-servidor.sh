#!/bin/sh
# Prepara el VPS (una sola vez): carpeta de la app y fragmento de nginx. Pide tu contraseña de ssh/sudo.
#
#   ./deploy/preparar-servidor.sh usuario@midominio.com
#
# Después, añade a mano `include snippets/matriculas.conf;` dentro del server { } con TLS y recarga nginx
# (el script no toca tu configuración existente de nginx). También instala el servicio de contacto (systemd);
# edita /etc/matriculas-contacto.env con los datos SMTP y arranca: sudo systemctl restart matriculas-contacto
set -eu
cd "$(dirname "$0")/.."
HOST=${1:?Uso: $0 usuario@host}
USER_REMOTE=${HOST%@*}
scp deploy/nginx-matriculas.conf "$HOST:/tmp/matriculas.conf"
sed "s/__USER__/$USER_REMOTE/g" deploy/matriculas-contacto.service > /tmp/matriculas-contacto.service
scp /tmp/matriculas-contacto.service .env.example "$HOST:/tmp/" && rm -f /tmp/matriculas-contacto.service
ssh -t "$HOST" 'sudo mkdir -p /var/www/matriculas-ocultas /etc/nginx/snippets \
  && sudo chown "$USER" /var/www/matriculas-ocultas \
  && sudo mv /tmp/matriculas.conf /etc/nginx/snippets/matriculas.conf \
  && mkdir -p ~/matriculas-contacto \
  && sudo mv /tmp/matriculas-contacto.service /etc/systemd/system/matriculas-contacto.service \
  && { [ -f /etc/matriculas-contacto.env ] || { sudo install -m 640 -o root -g "$USER" /tmp/.env.example /etc/matriculas-contacto.env && echo "Creado /etc/matriculas-contacto.env: EDÍTALO con tus datos SMTP (sudo nano /etc/matriculas-contacto.env)"; }; } \
  && sudo systemctl daemon-reload && sudo systemctl enable matriculas-contacto \
  && echo "Listo. Añade en el server { }:  include snippets/matriculas.conf;  y ejecuta: sudo nginx -t && sudo systemctl reload nginx"'
