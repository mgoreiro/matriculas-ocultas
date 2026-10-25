#!/bin/sh
# Descarga el modelo LaMa (ONNX, 198 MB, Apache-2.0) para el modo «Inteligente (IA)».
cd "$(dirname "$0")" && mkdir -p models && \
curl -L --fail -o models/lama_fp32.onnx https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
