import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services.asset_storage import ASSET_ROOT, AssetStorageService, sanitize_project_id

from ..dependencies import require_permission
from ..repository import repository
from ..scope import data_scope_for_user, filter_records_by_scope, record_in_scope
from ..task_index import (
    asset_phase_counts,
    directory_size,
    display_size,
    enrich_assets,
    project_tasks,
    scan_projects,
)


router = APIRouter(prefix="/v1/admin", tags=["admin-projects"])


class DeleteProjectPayload(BaseModel):
    confirm_project_id: str


class ProjectOwnerPayload(BaseModel):
    owner_user_id: Optional[int] = None


def _visible_projects(current_user, limit: int = 500):
    scope = data_scope_for_user(current_user)
    return filter_records_by_scope(scan_projects(limit=limit), scope)


def _project_summary_for_user(project_id: str, current_user):
    safe_project_id = sanitize_project_id(project_id)
    return next(
        (item for item in _visible_projects(current_user, limit=500) if item.get("project_id") == safe_project_id),
        None,
    )


def _ensure_project_access(project_id: str, current_user):
    summary = _project_summary_for_user(project_id, current_user)
    if not summary:
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")
    return summary


@router.get("/projects")
async def list_projects(
    limit: int = Query(default=50, ge=1, le=200),
    keyword: str = Query(default=""),
    status: str = Query(default=""),
    sort: str = Query(default="updated_at"),
    current_user=Depends(require_permission("project:read")),
):
    projects = scan_projects(limit=500)
    projects = filter_records_by_scope(projects, data_scope_for_user(current_user))
    if keyword:
        projects = [item for item in projects if keyword in item.get("project_id", "")]
    if status:
        projects = [item for item in projects if item.get("last_task_status") == status]
    if sort == "disk_usage":
        projects.sort(key=lambda item: (item.get("disk_usage") or {}).get("bytes") or 0, reverse=True)
    elif sort == "task_count":
        projects.sort(key=lambda item: item.get("task_count") or 0, reverse=True)
    else:
        projects.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return {"asset_root": str(ASSET_ROOT), "projects": projects[:limit]}


@router.put("/projects/{project_id}/owner")
async def assign_project_owner(
    project_id: str,
    payload: ProjectOwnerPayload,
    current_user=Depends(require_permission("project:update")),
):
    safe_project_id = sanitize_project_id(project_id)
    summary = _ensure_project_access(safe_project_id, current_user)
    before = repository.get_project_record(safe_project_id)
    project = repository.assign_project_owner(safe_project_id, payload.owner_user_id)
    if not project:
        raise HTTPException(status_code=400, detail="负责人不存在")
    after = next((item for item in scan_projects(limit=500) if item.get("project_id") == safe_project_id), None)
    repository.create_audit_log(
        "project.assign_owner",
        "project",
        safe_project_id,
        actor=current_user,
        before=before,
        after=after or project,
    )
    return {"project": after or project}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    current_user=Depends(require_permission("project:read")),
):
    storage = AssetStorageService(project_id)
    summary = _ensure_project_access(storage.project_id, current_user)
    manifest = storage.manifest()
    return {
        "project": summary,
        "manifest": manifest,
    }


@router.get("/projects/{project_id}/detail")
async def get_project_detail(
    project_id: str,
    current_user=Depends(require_permission("project:read")),
):
    storage = AssetStorageService(project_id)
    manifest = storage.manifest()
    summary = next((item for item in scan_projects(limit=500) if item.get("project_id") == storage.project_id), None)
    if not summary and not storage.manifest_path.exists():
        raise HTTPException(status_code=404, detail="项目不存在")
    if not record_in_scope(summary, data_scope_for_user(current_user)):
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")
    disk_size = directory_size(storage.project_dir)
    assets = enrich_assets(manifest.get("assets", []))
    tasks = project_tasks(storage.project_id)
    return {
        "project": summary,
        "manifest": manifest,
        "assets": assets,
        "tasks": tasks,
        "phase_counts": asset_phase_counts(manifest),
        "disk_usage": {
            "bytes": disk_size,
            "display": display_size(disk_size),
        },
    }


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    current_user=Depends(require_permission("project:delete")),
):
    safe_project_id = sanitize_project_id(project_id)
    _ensure_project_access(safe_project_id, current_user)
    project_dir = ASSET_ROOT / safe_project_id
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(status_code=404, detail="项目不存在")
    before = next((item for item in scan_projects(limit=500) if item.get("project_id") == safe_project_id), None)
    shutil.rmtree(project_dir)
    repository.delete_project_record(safe_project_id)
    repository.create_audit_log(
        "project.delete",
        "project",
        safe_project_id,
        actor=current_user,
        before=before,
    )
    return {"ok": True}


@router.post("/projects/{project_id}/delete")
async def safe_delete_project(
    project_id: str,
    payload: DeleteProjectPayload,
    current_user=Depends(require_permission("project:delete")),
):
    safe_project_id = sanitize_project_id(project_id)
    _ensure_project_access(safe_project_id, current_user)
    if payload.confirm_project_id != safe_project_id:
        raise HTTPException(status_code=400, detail="确认项目 ID 不匹配")
    project_dir = ASSET_ROOT / safe_project_id
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(status_code=404, detail="项目不存在")
    before = next((item for item in scan_projects(limit=500) if item.get("project_id") == safe_project_id), None)
    shutil.rmtree(project_dir)
    repository.delete_project_record(safe_project_id)
    repository.create_audit_log(
        "project.delete",
        "project",
        safe_project_id,
        actor=current_user,
        before=before,
    )
    return {"ok": True}


@router.get("/projects/{project_id}/assets")
async def list_project_assets(
    project_id: str,
    current_user=Depends(require_permission("asset:read")),
):
    storage = AssetStorageService(project_id)
    _ensure_project_access(storage.project_id, current_user)
    manifest = storage.manifest()
    return {
        "project_id": storage.project_id,
        "assets": enrich_assets(manifest.get("assets", [])),
    }


@router.get("/projects/{project_id}/tasks")
async def list_project_tasks(
    project_id: str,
    current_user=Depends(require_permission("task:read")),
):
    _ensure_project_access(project_id, current_user)
    return {
        "project_id": sanitize_project_id(project_id),
        "tasks": project_tasks(project_id),
    }


@router.delete("/projects/{project_id}/assets/{asset_id}")
async def delete_project_asset(
    project_id: str,
    asset_id: str,
    current_user=Depends(require_permission("asset:delete")),
):
    storage = AssetStorageService(project_id)
    _ensure_project_access(storage.project_id, current_user)
    manifest = storage.manifest()
    assets = manifest.get("assets", [])
    asset = next((item for item in assets if item.get("asset_id") == asset_id), None)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    relative_path = asset.get("relative_path")
    if relative_path:
        file_path = storage.project_dir / relative_path
        if file_path.exists() and file_path.is_file():
            file_path.unlink()
    manifest["assets"] = [item for item in assets if item.get("asset_id") != asset_id]
    storage._write_manifest(manifest)
    repository.create_audit_log(
        "asset.delete",
        "asset",
        asset_id,
        actor=current_user,
        before=asset,
    )
    return {"ok": True}


@router.get("/projects/{project_id}/archive")
async def export_project_archive(
    project_id: str,
    current_user=Depends(require_permission("project:export")),
):
    storage = AssetStorageService(project_id)
    _ensure_project_access(storage.project_id, current_user)
    try:
        archive_path = storage.build_all_archive()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="没有可导出的资产")
    repository.create_audit_log(
        "project.export",
        "project",
        storage.project_id,
        actor=current_user,
    )
    return {
        "project_id": storage.project_id,
        "archive_path": str(archive_path),
        "download_url": f"/v1/assets/projects/{storage.project_id}/archive-all",
    }
