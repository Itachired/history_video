import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import require_permission
from ..repository import repository


router = APIRouter(prefix="/v1/admin", tags=["admin-roles"])


class CreateRolePayload(BaseModel):
    code: str
    name: str
    description: str = ""
    permission_codes: List[str] = []


class UpdateRolePayload(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    permission_codes: Optional[List[str]] = None


@router.get("/roles")
async def list_roles(current_user=Depends(require_permission("role:read"))):
    return {"roles": repository.list_roles()}


@router.post("/roles")
async def create_role(
    payload: CreateRolePayload,
    current_user=Depends(require_permission("role:create")),
):
    try:
        role = repository.create_role(
            payload.code.strip(),
            payload.name.strip(),
            payload.description,
            payload.permission_codes,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="角色编码已存在")
    repository.create_audit_log(
        "role.create",
        "role",
        str(role["id"]),
        actor=current_user,
        after=role,
    )
    return {"role": role}


@router.patch("/roles/{role_id}")
async def update_role(
    role_id: int,
    payload: UpdateRolePayload,
    current_user=Depends(require_permission("role:update")),
):
    before = repository.get_role(role_id)
    if not before:
        raise HTTPException(status_code=404, detail="角色不存在")
    try:
        role = repository.update_role(role_id, payload.model_dump(exclude_unset=True))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="角色编码已存在")
    repository.create_audit_log(
        "role.update",
        "role",
        str(role_id),
        actor=current_user,
        before=before,
        after=role,
    )
    return {"role": role}


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: int,
    current_user=Depends(require_permission("role:delete")),
):
    before = repository.get_role(role_id)
    if not before:
        raise HTTPException(status_code=404, detail="角色不存在")
    if before.get("is_system"):
        raise HTTPException(status_code=400, detail="系统角色不能删除")
    ok = repository.delete_role(role_id)
    if not ok:
        raise HTTPException(status_code=400, detail="角色删除失败")
    repository.create_audit_log(
        "role.delete",
        "role",
        str(role_id),
        actor=current_user,
        before=before,
    )
    return {"ok": True}


@router.get("/permissions")
async def list_permissions(current_user=Depends(require_permission("permission:read"))):
    return {"permissions": repository.list_permissions()}
