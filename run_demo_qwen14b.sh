#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

SNAPSHOT_DIR="$PWD/vault_drive/model_cache/models--Qwen--Qwen2.5-14B-Instruct/snapshots/cf98f3b3bbb457ad9e2bb7baf9a0125b6b88caa8"

if [ ! -d "$SNAPSHOT_DIR" ]; then
  echo "未找到 Qwen2.5-14B-Instruct 本地快照: $SNAPSHOT_DIR"
  echo "请先下载模型，或改用 ./run_demo_qwen.sh 启动默认 0.5B 模型。"
  exit 1
fi

export AI_VAULT_MODEL_ID="$SNAPSHOT_DIR"
export AI_VAULT_DEVICE_MAP="${AI_VAULT_DEVICE_MAP:-auto}"
export AI_VAULT_CUDA_VISIBLE_DEVICES="${AI_VAULT_CUDA_VISIBLE_DEVICES:-4,5,6,7}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
export TRANSFORMERS_OFFLINE="${TRANSFORMERS_OFFLINE:-1}"

exec ./run_demo_qwen.sh
