#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8010}"
export AI_VAULT_QWEN_ENABLED="${AI_VAULT_QWEN_ENABLED:-0}"

echo "AI 数据保险箱 Demo"
echo "访问地址: http://${HOST}:${PORT}"
python3 -m uvicorn app:app --host "$HOST" --port "$PORT"
