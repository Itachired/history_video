from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ..dependencies import get_current_admin_user, request_meta
from ..repository import repository
from ..security import create_access_token, verify_password


router = APIRouter(prefix="/v1/admin/auth", tags=["admin-auth"])


class LoginPayload(BaseModel):
    username: str
    password: str


class ChangePasswordPayload(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
async def login(payload: LoginPayload, request: Request, response: Response):
    user = repository.get_user_by_username(payload.username)
    meta = request_meta(request)
    if not user or not verify_password(payload.password, user.get("password_hash") or ""):
        repository.create_audit_log(
            "auth.login_failed",
            "auth",
            payload.username,
            actor={"username": payload.username},
            ip=meta["ip"],
            user_agent=meta["user_agent"],
        )
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="用户已被禁用")

    repository.touch_last_login(int(user["id"]))
    user_detail = repository.get_user_detail(int(user["id"]))
    token = create_access_token(int(user["id"]), user["username"])
    response.set_cookie(
        key="admin_access_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 8,
    )
    repository.create_audit_log(
        "auth.login_success",
        "auth",
        str(user["id"]),
        actor=user_detail,
        ip=meta["ip"],
        user_agent=meta["user_agent"],
    )
    return {"token": token, "user": user_detail}


@router.post("/logout")
async def logout(
    response: Response,
    current_user=Depends(get_current_admin_user),
):
    response.delete_cookie("admin_access_token")
    repository.create_audit_log("auth.logout", "auth", str(current_user["id"]), actor=current_user)
    return {"ok": True}


@router.get("/me")
async def me(current_user=Depends(get_current_admin_user)):
    return {"user": current_user}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordPayload,
    current_user=Depends(get_current_admin_user),
):
    user = repository.get_user_by_username(current_user["username"])
    if not user or not verify_password(payload.old_password, user.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="旧密码错误")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少 8 位")
    repository.reset_password(int(current_user["id"]), payload.new_password)
    repository.create_audit_log(
        "auth.change_password",
        "user",
        str(current_user["id"]),
        actor=current_user,
    )
    return {"ok": True}
