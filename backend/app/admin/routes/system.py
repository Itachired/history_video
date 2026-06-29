import os
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from app.constants import (
    API_KEY,
    ARTIFACT_TOS_BUCKET,
    CGT_ENDPOINT_ID,
    LLM_ENDPOINT_ID,
    T2V_ENDPOINT_ID,
    TTS_ACCESS_KEY,
    TTS_API_RESOURCE_ID,
    TTS_APP_KEY,
    TTS_BASE_URL,
    VLM_ENDPOINT_ID,
)
from app.services.asset_storage import ASSET_ROOT

from ..config import (
    ADMIN_BOOTSTRAP_PASSWORD,
    ADMIN_BOOTSTRAP_USERNAME,
    ADMIN_DATABASE_PATH,
    ADMIN_TOKEN_SECRET,
    DEFAULT_ADMIN_TOKEN_SECRET,
)
from ..dependencies import require_permission
from ..repository import repository
from ..security import verify_password


router = APIRouter(prefix="/v1/admin/system", tags=["admin-system"])

SERVER_STARTED_AT = datetime.now(timezone.utc).isoformat()


def _config_present(value: str) -> bool:
    return bool(value and not value.startswith("<your-"))


def _default_admin_password_is_active() -> bool:
    user = repository.get_user_by_username(ADMIN_BOOTSTRAP_USERNAME)
    if not user:
        return False
    return verify_password(ADMIN_BOOTSTRAP_PASSWORD, user.get("password_hash") or "")


@router.get("/status")
async def get_system_status(
    request: Request,
    current_user=Depends(require_permission("system:read")),
):
    tts_configured = all(
        _config_present(value)
        for value in [TTS_ACCESS_KEY, TTS_API_RESOURCE_ID, TTS_APP_KEY, TTS_BASE_URL]
    )
    tos_configured = all(
        _config_present(value)
        for value in [
            os.getenv("TOS_ACCESSKEY", ""),
            os.getenv("TOS_SECRETKEY", ""),
            ARTIFACT_TOS_BUCKET,
        ]
    )
    config = {
        "api_key": _config_present(API_KEY),
        "llm_endpoint_id": _config_present(LLM_ENDPOINT_ID),
        "t2v_endpoint_id": _config_present(T2V_ENDPOINT_ID),
        "cgt_endpoint_id": _config_present(CGT_ENDPOINT_ID),
        "vlm_endpoint_id": _config_present(VLM_ENDPOINT_ID),
        "tos": tos_configured,
        "tos_bucket": _config_present(ARTIFACT_TOS_BUCKET),
        "tts": tts_configured,
    }
    security = {
        "default_admin_password_active": _default_admin_password_is_active(),
        "default_token_secret": ADMIN_TOKEN_SECRET == DEFAULT_ADMIN_TOKEN_SECRET,
    }
    security["warnings"] = [
        warning
        for warning in [
            "默认管理员密码仍可登录，请尽快修改。"
            if security["default_admin_password_active"]
            else "",
            "ADMIN_TOKEN_SECRET 未配置，当前使用开发默认值。"
            if security["default_token_secret"]
            else "",
        ]
        if warning
    ]
    return {
        "status": "ok",
        "backend": {
            "base_url": str(request.base_url).rstrip("/"),
            "port": os.getenv("_FAAS_RUNTIME_PORT") or "8888",
            "asset_root": str(ASSET_ROOT),
            "database_path": str(ADMIN_DATABASE_PATH),
            "python": sys.executable,
            "started_at": SERVER_STARTED_AT,
            "cwd": os.getcwd(),
        },
        "config": config,
        "capabilities": {
            "script": config["api_key"] and config["llm_endpoint_id"],
            "image": config["api_key"] and config["t2v_endpoint_id"],
            "video": config["api_key"] and config["cgt_endpoint_id"],
            "tts": config["tts"],
            "film": config["tos"],
        },
        "security": security,
    }
