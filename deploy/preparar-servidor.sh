#!/bin/sh
# Prepara el VPS (una sola vez): carpeta de la app y fragmento de nginx. Pide tu contraseña de ssh/sudo.
#
#   ./deploy/preparar-servidor.sh usuario@midominio.com
#
# Después, añade a mano `include snippets/matriculas.conf;` dentro del server { } con TLS y recarga nginx
# (el script no toca tu configuración existente).
set -eu
cd "$(dirname "$0")/.."
HOST=${1:?Uso: $0 usuario@host}
scp deploy/nginx-matriculas.conf "$HOST:/tmp/matriculas.conf"
ssh -t "$HOST" 'sudo mkdir -p /var/www/matriculas-ocultas /etc/nginx/snippets \
  && sudo chown "$USER" /var/www/matriculas-ocultas \
  && sudo mv /tmp/matriculas.conf /etc/nginx/snippets/matriculas.conf \
  && echo "Listo. Añade en el server { }:  include snippets/matriculas.conf;  y ejecuta: sudo nginx -t && sudo systemctl reload nginx"'
