#!/usr/bin/env bash
# Start the LianLian Pay API on port 9999
set -e
cd "$(dirname "$0")"
source .venv/bin/activate
exec uvicorn app:app --host 0.0.0.0 --port 9999
