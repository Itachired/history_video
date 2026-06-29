from typing import Callable, Dict, Optional

from fastapi import Header, HTTPException, Request

from .repository import repository
from .security import decode_access_token


def _token_from_request(request: Request, authorization: str = "") -> str:
    if authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    cookie_token = request.cookies.get("admin_access_token")
    return cookie_token or ""


def get_admin_user_from_token(token: str) -> Optional[Dict]:
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    user = repository.get_user_detail(int(payload.get("sub") or 0))
    if not user or user.get("status") != "active":
        return None
    return user


def get_current_admin_user(
    request: Request,
    authorization: str = Header(default=""),
) -> Dict:
    token = _token_from_request(request, authorization)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    user = get_admin_user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="用户不可用")
    return user


def get_optional_admin_user(
    request: Request,
    authorization: str = Header(default=""),
) -> Dict:
    token = _token_from_request(request, authorization)
    return get_admin_user_from_token(token) or {}


def require_permission(permission_code: str) -> Callable:
    def dependency(
        request: Request,
        authorization: str = Header(default=""),
    ) -> Dict:
        user = get_current_admin_user(request, authorization)
        if user.get("is_super_admin") or permission_code in user.get("permissions", []):
            return user
        raise HTTPException(status_code=403, detail="权限不足")

    return dependency


def request_meta(request: Request) -> Dict[str, str]:
    client = request.client
    return {
        "ip": client.host if client else "",
        "user_agent": request.headers.get("user-agent", ""),
    }
