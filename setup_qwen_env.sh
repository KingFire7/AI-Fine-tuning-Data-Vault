#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

CONDA_BIN="${CONDA_BIN:-/data01/liuchuan/miniconda3/bin/conda}"
SOURCE_PREFIX="${SOURCE_PREFIX:-/data01/liuchuan/miniconda3}"
TARGET_PREFIX="${TARGET_PREFIX:-$PWD/.conda-qwen38}"

if [ ! -x "$CONDA_BIN" ]; then
  echo "未找到 conda: $CONDA_BIN"
  exit 1
fi

if [ ! -x "$TARGET_PREFIX/bin/python" ]; then
  echo "创建项目 conda 环境: $TARGET_PREFIX"
  "$CONDA_BIN" create -y -p "$TARGET_PREFIX" --clone "$SOURCE_PREFIX"
fi

echo "安装/升级 Qwen 推理依赖"
"$TARGET_PREFIX/bin/python" -m pip install --upgrade \
  "transformers==4.45.2" \
  "tokenizers>=0.20,<0.21" \
  "safetensors>=0.4.5" \
  "huggingface_hub>=0.24,<1.0" \
  "accelerate>=0.34,<0.35" \
  "sentencepiece>=0.2" \
  "fastapi>=0.99,<0.100" \
  "pydantic>=1.10,<2" \
  "starlette>=0.27,<0.28" \
  "uvicorn[standard]>=0.23" \
  "cryptography>=39.0,<40" \
  "psutil>=5.9" \
  "typing_extensions>=4.10"

"$TARGET_PREFIX/bin/python" - <<'PY'
import sys
import torch
import transformers

print("python", sys.version.split()[0])
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "gpus", torch.cuda.device_count())
print("transformers", transformers.__version__)
PY
