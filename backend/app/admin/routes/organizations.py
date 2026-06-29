from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..dependencies import require_permission
from ..repository import repository


router = APIRouter(prefix="/v1/admin/organizations", tags=["admin-organizations"])


class TenantPayload(BaseModel):
    tenant_id: Optional[str] = None
    name: str
    display_name: str = ""
    billing_mode: str = "internal"
    billing_currency: str = "CNY"
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""


class WorkspacePayload(BaseModel):
    workspace_id: Optional[str] = None
    tenant_id: str
    name: str
    display_name: str = ""
    description: str = ""
    billing_mode: str = "inherit"
    monthly_budget_limit: float = 0


@router.get("/tenants")
async def list_tenants(current_user=Depends(require_permission("organization:read"))):
    return {"tenants": repository.list_tenants()}


@router.post("/tenants")
async def create_tenant(
    payload: TenantPayload,
    current_user=Depends(require_permission("organization:update")),
):
    tenant = repository.create_tenant(payload.model_dump())
    repository.create_audit_log(
        "organization.tenant.create",
        "tenant",
        tenant["tenant_id"],
        actor=current_user,
        tenant_id=tenant["tenant_id"],
        after=tenant,
    )
    return {"tenant": tenant}


@router.get("/workspaces")
async def list_workspaces(
    tenant_id: str = Query(default=""),
    current_user=Depends(require_permission("organization:read")),
):
    return {"workspaces": repository.list_workspaces(tenant_id=tenant_id)}


@router.post("/workspaces")
async def create_workspace(
    payload: WorkspacePayload,
    current_user=Depends(require_permission("organization:update")),
):
    workspace = repository.create_workspace({
        **payload.model_dump(),
        "created_by_user_id": current_user.get("id"),
        "created_by_username": current_user.get("username") or "",
    })
    repository.create_audit_log(
        "organization.workspace.create",
        "workspace",
        workspace["workspace_id"],
        actor=current_user,
        tenant_id=workspace["tenant_id"],
        workspace_id=workspace["workspace_id"],
        after=workspace,
    )
    return {"workspace": workspace}
