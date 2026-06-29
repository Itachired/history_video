import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..dependencies import require_permission
from ..repository import repository


router = APIRouter(prefix="/v1/admin/users", tags=["admin-users"])


class CreateUserPayload(BaseModel):
    username: str
    display_name: str
    password: str
    email: str = ""
    phone: str = ""
    role_ids: List[int] = []
    default_tenant_id: str = ""
    default_workspace_id: str = ""


class UpdateUserPayload(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    default_tenant_id: Optional[str] = None
    default_workspace_id: Optional[str] = None


class RolePayload(BaseModel):
    role_ids: List[int] = []


class ResetPasswordPayload(BaseModel):
    password: str


@router.get("")
async def list_users(
    keyword: str = Query(default=""),
    status: str = Query(default=""),
    current_user=Depends(require_permission("user:read")),
):
    return {"users": repository.list_users(keyword=keyword, status=status)}


@router.post("")
async def create_user(
    payload: CreateUserPayload,
    current_user=Depends(require_permission("user:create")),
):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    try:
        user = repository.create_user(
            payload.username.strip(),
            payload.display_name.strip() or payload.username.strip(),
            payload.password,
            payload.email,
            payload.phone,
            payload.role_ids,
            payload.default_tenant_id,
            payload.default_workspace_id,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="用户名已存在")
    repository.create_audit_log(
        "user.create",
        "user",
        str(user["id"]),
        actor=current_user,
        after=user,
    )
    return {"user": user}


@router.get("/{user_id}")
async def get_user(
    user_id: int,
    current_user=Depends(require_permission("user:read")),
):
    user = repository.get_user_detail(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"user": user}


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    payload: UpdateUserPayload,
    current_user=Depends(require_permission("user:update")),
):
    before = repository.get_user_detail(user_id)
    if not before:
        raise HTTPException(status_code=404, detail="用户不存在")
    user = repository.update_user(user_id, payload.model_dump(exclude_unset=True))
    repository.create_audit_log(
        "user.update",
        "user",
        str(user_id),
        actor=current_user,
        before=before,
        after=user,
    )
    return {"user": user}


@router.post("/{user_id}/disable")
async def disable_user(
    user_id: int,
    current_user=Depends(require_permission("user:disable")),
):
    if int(current_user["id"]) == user_id:
        raise HTTPException(status_code=400, detail="不能禁用当前登录用户")
    before = repository.get_user_detail(user_id)
    if not before:
        raise HTTPException(status_code=404, detail="用户不存在")
    if before.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="不能禁用超级管理员")
    user = repository.set_user_status(user_id, "disabled")
    repository.create_audit_log(
        "user.disable",
        "user",
        str(user_id),
        actor=current_user,
        before=before,
        after=user,
    )
    return {"user": user}


@router.post("/{user_id}/enable")
async def enable_user(
    user_id: int,
    current_user=Depends(require_permission("user:disable")),
):
    before = repository.get_user_detail(user_id)
    if not before:
        raise HTTPException(status_code=404, detail="用户不存在")
    user = repository.set_user_status(user_id, "active")
    repository.create_audit_log(
        "user.enable",
        "user",
        str(user_id),
        actor=current_user,
        before=before,
        after=user,
    )
    return {"user": user}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    payload: ResetPasswordPayload,
    current_user=Depends(require_permission("user:reset_password")),
):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    user = repository.get_user_detail(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    repository.reset_password(user_id, payload.password)
    repository.create_audit_log(
        "user.reset_password",
        "user",
        str(user_id),
        actor=current_user,
    )
    return {"ok": True}


@router.put("/{user_id}/roles")
async def replace_user_roles(
    user_id: int,
    payload: RolePayload,
    current_user=Depends(require_permission("user:update")),
):
    before = repository.get_user_detail(user_id)
    if not before:
        raise HTTPException(status_code=404, detail="用户不存在")
    user = repository.replace_user_roles(user_id, payload.role_ids)
    repository.create_audit_log(
        "user.update_roles",
        "user",
        str(user_id),
        actor=current_user,
        before=before,
        after=user,
    )
    return {"user": user}
