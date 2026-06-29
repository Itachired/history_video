from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_permission
from ..repository import repository
from ..scope import data_scope_for_user, filter_records_by_scope, record_in_scope
from ..task_index import find_task, scan_tasks


router = APIRouter(prefix="/v1/admin", tags=["admin-tasks"])


def _task_scope_record(task):
    record = dict(task or {})
    if record.get("tenant_id") and record.get("workspace_id"):
        return record
    project = repository.get_project_record(record.get("project_id") or "") or {}
    return {
        **record,
        "tenant_id": record.get("tenant_id") or project.get("tenant_id") or "",
        "workspace_id": record.get("workspace_id") or project.get("workspace_id") or "",
        "owner_user_id": project.get("owner_user_id"),
        "created_by_user_id": project.get("created_by_user_id"),
    }


@router.get("/tasks")
async def list_tasks(
    limit: int = Query(default=100, ge=1, le=500),
    status: str = Query(default=""),
    phase: str = Query(default=""),
    project_id: str = Query(default=""),
    current_user=Depends(require_permission("task:read")),
):
    tasks = scan_tasks(
        limit=500,
        status=status,
        phase=phase,
        project_id=project_id,
    )
    visible_tasks = filter_records_by_scope(
        [_task_scope_record(task) for task in tasks],
        data_scope_for_user(current_user),
    )
    return {
        "tasks": visible_tasks[:limit]
    }


@router.get("/tasks/{task_id:path}")
async def get_task(
    task_id: str,
    current_user=Depends(require_permission("task:read")),
):
    task = find_task(task_id)
    if not task or not record_in_scope(_task_scope_record(task), data_scope_for_user(current_user)):
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"task": task}
