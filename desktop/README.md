# Electron Desktop Shell

This folder contains the desktop shell for the local history/knowledge video
generator. It intentionally wraps the existing `frontend` and `backend`
projects instead of replacing them.

## Development

Start the backend/frontend manually, then run Electron:

```bash
cd backend
_FAAS_RUNTIME_PORT=8889 python index.py
```

```bash
cd frontend
pnpm dev
```

```bash
cd desktop
pnpm install
pnpm dev
```

By default the shell loads `http://localhost:8080` and connects to
`http://127.0.0.1:8889`. If the backend is not already running, the shell tries
to start `backend/index.py`.

Useful overrides:

```bash
CHAT2CARTOON_RENDERER_URL=http://localhost:8080 pnpm dev
CHAT2CARTOON_BACKEND_PYTHON=/opt/anaconda3/envs/video-gen1/bin/python pnpm dev
CHAT2CARTOON_BACKEND_PORT=8889 pnpm dev
CHAT2CARTOON_ASSET_ROOT=/Users/me/Movies/chat2cartoon/generated pnpm dev
```

## Browser Compatibility

The browser frontend remains independent. Electron APIs are optional in the
renderer, so `frontend/pnpm dev` continues to work without this desktop shell.
