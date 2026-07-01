#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
RUNTIME_DIR="${PROJECT_ROOT}/backend-runtime"
BUILD_DIR="${PROJECT_ROOT}/.pyinstaller-build/mac"
SPEC_FILE="${BACKEND_DIR}/pyinstaller/chat2cartoon-backend.spec"
DEFAULT_CONDA_PYTHON="/opt/anaconda3/envs/video-gen1/bin/python"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script builds the macOS backend runtime and must run on macOS." >&2
  exit 1
fi

if [[ -n "${CHAT2CARTOON_BACKEND_PYTHON:-}" ]]; then
  PYTHON="${CHAT2CARTOON_BACKEND_PYTHON}"
elif [[ -x "${DEFAULT_CONDA_PYTHON}" ]]; then
  PYTHON="${DEFAULT_CONDA_PYTHON}"
else
  PYTHON="python3"
fi

if ! "${PYTHON}" - <<'PY' >/dev/null 2>&1
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("PyInstaller") else 1)
PY
then
  echo "PyInstaller is not installed for ${PYTHON}; installing it now..."
  "${PYTHON}" -m pip install "pyinstaller>=6.10,<7"
fi

echo "Using Python: $("${PYTHON}" -c 'import sys; print(sys.executable)')"
echo "Cleaning previous backend runtime build..."
rm -rf "${BUILD_DIR}" "${RUNTIME_DIR}/dist"
mkdir -p "${BUILD_DIR}" "${RUNTIME_DIR}"

echo "Building macOS backend runtime..."
"${PYTHON}" -m PyInstaller \
  --noconfirm \
  --clean \
  --workpath "${BUILD_DIR}" \
  --distpath "${RUNTIME_DIR}/dist" \
  "${SPEC_FILE}"

BACKEND_BIN="${RUNTIME_DIR}/dist/chat2cartoon-backend/chat2cartoon-backend"
if [[ ! -x "${BACKEND_BIN}" ]]; then
  echo "Expected backend executable was not created: ${BACKEND_BIN}" >&2
  exit 1
fi

chmod +x "${BACKEND_BIN}"

echo "Backend runtime created:"
ls -lh "${BACKEND_BIN}"
echo
echo "Electron packaged mode will use:"
echo "  backend-runtime/dist/chat2cartoon-backend/chat2cartoon-backend"
