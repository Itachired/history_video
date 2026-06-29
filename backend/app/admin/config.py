import os
from pathlib import Path


_backend_root = Path(__file__).resolve().parents[2]
_default_data_dir = _backend_root / "data"

ADMIN_DATABASE_PATH = Path(
    os.getenv("ADMIN_DATABASE_PATH") or _default_data_dir / "admin.db"
)
DEFAULT_ADMIN_TOKEN_SECRET = "chat2cartoon-admin-dev-secret"
ADMIN_TOKEN_SECRET = os.getenv("ADMIN_TOKEN_SECRET") or os.getenv("API_KEY") or DEFAULT_ADMIN_TOKEN_SECRET
ADMIN_TOKEN_EXPIRE_SECONDS = int(os.getenv("ADMIN_TOKEN_EXPIRE_SECONDS") or str(60 * 60 * 8))
ADMIN_BOOTSTRAP_USERNAME = os.getenv("ADMIN_BOOTSTRAP_USERNAME") or "admin"
ADMIN_BOOTSTRAP_PASSWORD = os.getenv("ADMIN_BOOTSTRAP_PASSWORD") or "admin123456"
ADMIN_BOOTSTRAP_DISPLAY_NAME = os.getenv("ADMIN_BOOTSTRAP_DISPLAY_NAME") or "系统管理员"
