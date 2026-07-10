#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

RUNTIME_CONFIG="$PWD/.runtime_config.env"
if [ -f "$RUNTIME_CONFIG" ]; then
  # shellcheck disable=SC1090
  source "$RUNTIME_CONFIG"
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8010}"
CONDA_ENV="${CONDA_ENV:-$PWD/.conda-qwen38}"
AI_VAULT_CUDA_VISIBLE_DEVICES="${AI_VAULT_CUDA_VISIBLE_DEVICES:-4,5,6,7}"

if [ ! -x "$CONDA_ENV/bin/python" ]; then
  echo "未找到 Qwen conda 环境: $CONDA_ENV"
  echo "请先执行: ./setup_qwen_env.sh"
  exit 1
fi

export CUDA_VISIBLE_DEVICES="$AI_VAULT_CUDA_VISIBLE_DEVICES"
export AI_VAULT_CUDA_VISIBLE_DEVICES
export AI_VAULT_QWEN_ENABLED="${AI_VAULT_QWEN_ENABLED:-1}"
export AI_VAULT_MODEL_ID="${AI_VAULT_MODEL_ID:-Qwen/Qwen2.5-0.5B-Instruct}"
export AI_VAULT_MODEL_CACHE="${AI_VAULT_MODEL_CACHE:-$PWD/vault_drive/model_cache}"
export HF_HOME="${HF_HOME:-$PWD/vault_drive/model_cache/huggingface}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-$PWD/vault_drive/model_cache/transformers}"
export HF_HUB_DISABLE_TELEMETRY="${HF_HUB_DISABLE_TELEMETRY:-1}"
export HF_ENDPOINT="${AI_VAULT_HF_ENDPOINT:-https://huggingface.co}"
export AI_VAULT_MAX_NEW_TOKENS="${AI_VAULT_MAX_NEW_TOKENS:-140}"
export TOKENIZERS_PARALLELISM="${TOKENIZERS_PARALLELISM:-false}"

echo "AI 数据保险箱 Demo · Qwen 真实模型模式"
echo "模型: $AI_VAULT_MODEL_ID"
echo "模型缓存: $AI_VAULT_MODEL_CACHE"
echo "物理 GPU 白名单: $CUDA_VISIBLE_DEVICES"
echo "设备映射: ${AI_VAULT_DEVICE_MAP:-single-gpu-auto-select}"
echo "HF_ENDPOINT: $HF_ENDPOINT"
echo "访问地址: http://${HOST}:${PORT}"
"$CONDA_ENV/bin/python" -m uvicorn app:app --host "$HOST" --port "$PORT"
