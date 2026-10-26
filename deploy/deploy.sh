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
rsync -az --delete --info=stats1,progress2 \
  --include='/index.html' --include='/LICENSE' --include='/NOTICE.md' \
  --include='/js/***' --include='/vendor/***' \
  --include='/models/' --include='/models/yolo-*.onnx' \
  --exclude='*' ./ "$HOST:$DEST/"
if [ "${1:-}" = "--lama" ]; then
  ssh "$HOST" "test -s $DEST/models/lama_fp32.onnx || curl -L --fail -o $DEST/models/lama_fp32.onnx https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
fi
echo "Subido a $HOST:$DEST"
