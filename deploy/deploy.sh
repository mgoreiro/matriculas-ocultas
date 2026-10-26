#!/bin/sh
# Sube la app a un VPS con nginx por rsync (solo los ficheros que necesita el navegador).
#
#   ./deploy/deploy.sh usuario@midominio.com [--lama]
#
# --lama  descarga en el propio servidor el modelo LaMa (198 MB) si aún no está (no lo sube desde casa).
# Requisito (una vez, en el VPS): sudo mkdir -p /var/www/matriculas-ocultas && sudo chown "$USER" /var/www/matriculas-ocultas
set -eu
cd "$(dirname "$0")/.."
HOST=${1:?Uso: $0 usuario@host [--lama]}; shift || true
DEST=${DEST:-/var/www/matriculas-ocultas}
# Lista explícita + --relative: compatible con el rsync de macOS (openrsync) y no toca models/lama_fp32.onnx del servidor.
rsync -azR --delete -v \
  index.html LICENSE NOTICE.md js vendor \
  models/yolo-v9-t-640-license-plates-end2end.onnx models/yolo-v9-s-608-license-plates-end2end.onnx \
  "$HOST:$DEST/"
# Servicio de contacto (fuera del directorio web) y reinicio si ya está instalado
ssh "$HOST" 'mkdir -p ~/matriculas-contacto' && rsync -az server/contacto.py "$HOST:matriculas-contacto/"
ssh "$HOST" 'systemctl is-enabled matriculas-contacto >/dev/null 2>&1 && sudo systemctl restart matriculas-contacto || true'
if [ "${1:-}" = "--lama" ]; then
  ssh "$HOST" "test -s $DEST/models/lama_fp32.onnx || curl -L --fail -o $DEST/models/lama_fp32.onnx https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
fi
echo "Subido a $HOST:$DEST"
