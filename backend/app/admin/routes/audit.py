from fastapi import APIRouter, Depends, Query

from ..dependencies import require_permission
from ..repository import repository


router = APIRouter(prefix="/v1/admin/audit-logs", tags=["admin-audit"])


@router.get("")
async def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    action: str = Query(default=""),
    actor_username: str = Query(default=""),
    resource_type: str = Query(default=""),
    tenant_id: str = Query(default=""),
    workspace_id: str = Query(default=""),
    current_user=Depends(require_permission("audit:read")),
):
    return {
        "logs": repository.list_audit_logs(
            limit=limit,
            action=action,
            actor_username=actor_username,
            resource_type=resource_type,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
        )
    }
