#!/bin/sh
set -eu

MODEL_DIR="${EDGEJEV_MODEL_DIR:-/models/jev-int8}"
EDGEJEV_PORT="${EDGEJEV_PORT:-8009}"

python3 /app/scripts/prepare_edgejev_model.py

if [ -f "$MODEL_DIR/edgejev.json" ] && [ -f "$MODEL_DIR/model.onnx" ] && [ -f "$MODEL_DIR/tokenizer.json" ]; then
  echo "[edgejev] starting local inference on 127.0.0.1:$EDGEJEV_PORT"
  edgejev serve --model "$MODEL_DIR" --host 127.0.0.1 --port "$EDGEJEV_PORT" &
else
  echo "[edgejev] model unavailable; web shell will start without inference"
fi

exec npm start
