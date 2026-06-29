from fastapi import APIRouter, Depends

from ..dependencies import require_permission
from ..task_index import dashboard_snapshot


router = APIRouter(prefix="/v1/admin", tags=["admin-dashboard"])


@router.get("/dashboard")
async def get_dashboard(current_user=Depends(require_permission("dashboard:read"))):
    return dashboard_snapshot()
