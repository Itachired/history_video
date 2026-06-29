from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.asset_storage import ASSET_ROOT, AssetStorageService

from .repository import repository


PHASE_LABELS = {
    "source": "素材",
    "role_images": "角色图",
    "storyboard_images": "分镜图",
    "storyboard_videos": "分镜视频",
    "film": "成片",
}


def _tenant_label(record: Dict[str, Any]) -> str:
    return record.get("tenant_display_name") or record.get("tenant_name") or record.get("tenant_id") or ""


def _workspace_label(record: Dict[str, Any]) -> str:
    return record.get("workspace_display_name") or record.get("workspace_name") or record.get("workspace_id") or ""

TASK_PHASE_ORDER = {
    "source": 10,
    "role_images": 20,
    "storyboard_images": 30,
    "storyboard_videos": 40,
    "film": 50,
}


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def display_size(size: int) -> str:
    value = float(size)
    for unit in ["B", "KB", "MB", "GB"]:
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{size} B"


def directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for item in path.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def asset_phase_counts(manifest: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    counts: Dict[str, Dict[str, int]] = {}
    for asset in manifest.get("assets", []):
        phase = asset.get("phase") or "unknown"
        status = asset.get("status") or "unknown"
        phase_counts = counts.setdefault(phase, {"total": 0})
        phase_counts["total"] += 1
        phase_counts[status] = phase_counts.get(status, 0) + 1
    return counts


def asset_preview_type(asset: Dict[str, Any]) -> str:
    filename = (asset.get("filename") or asset.get("relative_path") or "").lower()
    suffix = Path(filename).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    if suffix in {".mp4", ".webm", ".mov"}:
        return "video"
    if suffix in {".mp3", ".wav", ".m4a", ".aac", ".ogg"}:
        return "audio"
    return "file"


def enrich_assets(assets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            **asset,
            "preview_type": asset_preview_type(asset),
        }
        for asset in assets
    ]


def project_dirs() -> List[Path]:
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    return [path for path in ASSET_ROOT.iterdir() if path.is_dir()]


def load_project_manifest(project_dir: Path) -> Optional[Dict[str, Any]]:
    manifest_path = project_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    return AssetStorageService(project_dir.name).manifest()


def latest_time(values: List[Optional[str]]) -> Optional[str]:
    parsed = [(parse_iso(value), value) for value in values if value]
    parsed = [(dt, value) for dt, value in parsed if dt]
    if not parsed:
        return next((value for value in values if value), None)
    parsed.sort(key=lambda item: item[0] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return parsed[0][1]


def _task_status_from_assets(assets: List[Dict[str, Any]]) -> str:
    if any((asset.get("status") or "").lower() == "failed" for asset in assets):
        return "failed"
    if any((asset.get("status") or "").lower() in {"submitted", "running", "processing"} for asset in assets):
        return "running"
    if assets and all((asset.get("status") or "").lower() == "ready" for asset in assets):
        return "succeeded"
    if assets:
        return "unknown"
    return "pending"


def _phase_status_from_assets(assets: List[Dict[str, Any]]) -> str:
    if any((asset.get("status") or "").lower() == "failed" for asset in assets):
        return "failed"
    if any((asset.get("status") or "").lower() in {"submitted", "running", "processing"} for asset in assets):
        return "running"
    if assets and all((asset.get("status") or "").lower() == "ready" for asset in assets):
        return "succeeded"
    return "unknown"


def _asset_task_id(asset: Dict[str, Any]) -> str:
    metadata = asset.get("metadata") or {}
    return asset.get("video_gen_task_id") or metadata.get("video_gen_task_id") or ""


def _task_id_for_phase(project_id: str, phase: str, assets: List[Dict[str, Any]]) -> str:
    explicit_ids = sorted({_asset_task_id(asset) for asset in assets if _asset_task_id(asset)})
    if explicit_ids:
        return explicit_ids[0] if len(explicit_ids) == 1 else f"{project_id}:{phase}"
    return f"{project_id}:{phase}"


def build_project_summary(project_dir: Path) -> Optional[Dict[str, Any]]:
    manifest = load_project_manifest(project_dir)
    if not manifest:
        return None
    assets = manifest.get("assets", [])
    ready_count = len([asset for asset in assets if asset.get("status") == "ready"])
    film_ready = any(asset.get("phase") == "film" and asset.get("status") == "ready" for asset in assets)
    tasks = build_project_tasks(project_dir.name, manifest)
    last_task = tasks[0] if tasks else None
    disk_bytes = directory_size(project_dir)
    return {
        "project_id": manifest.get("project_id") or project_dir.name,
        "project_dir": str(project_dir),
        "manifest_path": str(project_dir / "manifest.json"),
        "created_at": manifest.get("created_at"),
        "updated_at": manifest.get("updated_at"),
        "asset_count": len(assets),
        "ready_asset_count": ready_count,
        "phase_counts": asset_phase_counts(manifest),
        "film_ready": film_ready,
        "task_count": len(tasks),
        "last_task_id": last_task.get("task_id") if last_task else "",
        "last_task_status": last_task.get("status") if last_task else "",
        "disk_usage": {
            "bytes": disk_bytes,
            "display": display_size(disk_bytes),
        },
    }


def _sync_project_record(summary: Dict[str, Any]) -> Dict[str, Any]:
    return repository.ensure_project_record(
        summary.get("project_id") or "",
        project_dir=summary.get("project_dir") or "",
        manifest_path=summary.get("manifest_path") or "",
        created_at=summary.get("created_at") or "",
        updated_at=summary.get("updated_at") or "",
    )


def _merge_project_record(summary: Dict[str, Any], record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not record:
        return {
            **summary,
            "owner_user_id": None,
            "owner_username": "",
            "owner_display_name": "",
            "ownership_status": "unassigned",
            "visibility": "private",
            "status": "active",
        }
    owner_user_id = record.get("owner_user_id")
    return {
        **summary,
        "name": record.get("name") or summary.get("project_id"),
        "owner_user_id": owner_user_id,
        "owner_username": record.get("owner_username") or "",
        "owner_display_name": record.get("owner_display_name") or "",
        "created_by_user_id": record.get("created_by_user_id"),
        "created_by_username": record.get("created_by_username") or "",
        "tenant_id": record.get("tenant_id") or "",
        "workspace_id": record.get("workspace_id") or "",
        "tenant_name": _tenant_label(record),
        "workspace_name": _workspace_label(record),
        "ownership_status": "assigned" if owner_user_id else "unassigned",
        "visibility": record.get("visibility") or "private",
        "status": record.get("status") or "active",
    }


def build_project_tasks(project_id: str, manifest: Dict[str, Any]) -> List[Dict[str, Any]]:
    assets = manifest.get("assets", [])
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for asset in assets:
        grouped[asset.get("phase") or "unknown"].append(asset)

    tasks = []
    for phase, phase_assets in grouped.items():
        phase_assets = sorted(phase_assets, key=lambda asset: (asset.get("index", 0), asset.get("asset_id") or ""))
        status = _task_status_from_assets(phase_assets)
        failed_asset = next((asset for asset in phase_assets if asset.get("status") == "failed"), None)
        updated_at = latest_time([asset.get("updated_at") for asset in phase_assets]) or manifest.get("updated_at")
        created_at = manifest.get("created_at") or updated_at
        ready_count = len([asset for asset in phase_assets if asset.get("status") == "ready"])
        total_count = len(phase_assets)
        tasks.append(
            {
                "task_id": _task_id_for_phase(project_id, phase, phase_assets),
                "project_id": project_id,
                "task_type": "asset_phase",
                "status": status,
                "phase": phase,
                "phase_label": PHASE_LABELS.get(phase, phase),
                "progress": round((ready_count / total_count) * 100) if total_count else 0,
                "asset_count": total_count,
                "ready_asset_count": ready_count,
                "failed_asset_count": len([asset for asset in phase_assets if asset.get("status") == "failed"]),
                "created_at": created_at,
                "started_at": created_at,
                "updated_at": updated_at,
                "finished_at": updated_at if status in {"succeeded", "failed"} else "",
                "duration_seconds": _duration_seconds(created_at, updated_at),
                "error_message": failed_asset.get("message") if failed_asset else "",
                "assets": enrich_assets(phase_assets),
                "events": build_task_events(phase, phase_assets),
            }
        )
    tasks.sort(
        key=lambda task: (
            parse_iso(task.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc),
            TASK_PHASE_ORDER.get(task.get("phase"), 999),
        ),
        reverse=True,
    )
    return tasks


def build_task_events(phase: str, assets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    events = []
    for asset in sorted(assets, key=lambda item: (item.get("index", 0), item.get("asset_id") or "")):
        status = (asset.get("status") or "unknown").lower()
        events.append(
            {
                "event_id": f"{asset.get('asset_id') or phase}:{status}",
                "phase": phase,
                "asset_id": asset.get("asset_id"),
                "status": _phase_status_from_assets([asset]),
                "message": asset.get("message") or asset.get("filename") or asset.get("source_url") or "",
                "created_at": asset.get("updated_at"),
                "updated_at": asset.get("updated_at"),
            }
        )
    return events


def _assets_for_task(project_id: str, phase: str) -> List[Dict[str, Any]]:
    project_dir = ASSET_ROOT / project_id
    if not (project_dir / "manifest.json").exists():
        return []
    storage = AssetStorageService(project_id)
    return enrich_assets([
        asset
        for asset in storage.manifest().get("assets", [])
        if (asset.get("phase") or "unknown") == phase
    ])


def normalize_db_task(task: Dict[str, Any]) -> Dict[str, Any]:
    phase = task.get("phase") or "unknown"
    project_id = task.get("project_id") or ""
    assets = _assets_for_task(project_id, phase) if project_id else []
    ready_count = len([asset for asset in assets if asset.get("status") == "ready"])
    failed_count = len([asset for asset in assets if asset.get("status") == "failed"])
    events = [
        {
            "event_id": event.get("event_id") or str(event.get("id") or ""),
            "phase": event.get("phase") or phase,
            "asset_id": event.get("asset_id") or "",
            "status": event.get("status") or "unknown",
            "message": event.get("message") or event.get("error_message") or "",
            "created_at": event.get("created_at"),
            "updated_at": event.get("finished_at") or event.get("created_at"),
        }
        for event in task.get("events", [])
    ]
    return {
        "task_id": task.get("task_id"),
        "project_id": project_id,
        "tenant_id": task.get("tenant_id") or "",
        "workspace_id": task.get("workspace_id") or "",
        "creator_user_id": task.get("creator_user_id"),
        "creator_username": task.get("creator_username") or "",
        "task_type": task.get("task_type") or "generation_phase",
        "status": task.get("status") or "unknown",
        "phase": phase,
        "phase_label": PHASE_LABELS.get(phase, phase),
        "progress": int(task.get("progress") or 0),
        "asset_count": len(assets),
        "ready_asset_count": ready_count,
        "failed_asset_count": failed_count,
        "created_at": task.get("created_at"),
        "started_at": task.get("started_at") or task.get("created_at"),
        "updated_at": task.get("updated_at"),
        "finished_at": task.get("finished_at") or "",
        "duration_seconds": _duration_seconds(task.get("started_at") or task.get("created_at"), task.get("finished_at") or task.get("updated_at")),
        "error_code": task.get("error_code") or "",
        "error_type": task.get("error_type") or "",
        "error_message": task.get("error_message") or task.get("error_detail") or "",
        "error_detail": task.get("error_detail") or "",
        "provider": task.get("provider") or "",
        "retryable": bool(task.get("retryable")),
        "assets": assets,
        "events": events,
    }


def _merge_formal_and_manifest_tasks(
    formal_tasks: List[Dict[str, Any]],
    manifest_tasks: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    normalized_formal = [normalize_db_task(task) for task in formal_tasks]
    covered = {
        (task.get("project_id"), task.get("phase"))
        for task in normalized_formal
    }
    merged = normalized_formal + [
        task
        for task in manifest_tasks
        if (task.get("project_id"), task.get("phase")) not in covered
    ]
    merged.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return merged


def _duration_seconds(start: Optional[str], end: Optional[str]) -> Optional[int]:
    start_dt = parse_iso(start)
    end_dt = parse_iso(end)
    if not start_dt or not end_dt:
        return None
    return max(0, int((end_dt - start_dt).total_seconds()))


def scan_projects(limit: int = 200) -> List[Dict[str, Any]]:
    summaries = []
    for project_dir in project_dirs():
        summary = build_project_summary(project_dir)
        if summary:
            record = _sync_project_record(summary)
            summaries.append(_merge_project_record(summary, record))
    summaries.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return summaries[:limit]


def scan_tasks(
    limit: int = 200,
    status: str = "",
    phase: str = "",
    project_id: str = "",
) -> List[Dict[str, Any]]:
    manifest_tasks: List[Dict[str, Any]] = []
    for project_dir in project_dirs():
        if project_id and project_id not in project_dir.name:
            continue
        manifest = load_project_manifest(project_dir)
        if not manifest:
            continue
        manifest_tasks.extend(build_project_tasks(manifest.get("project_id") or project_dir.name, manifest))
    formal_tasks = repository.list_generation_tasks(
        limit=1000,
        status=status,
        phase=phase,
        project_id=project_id,
    )
    tasks = _merge_formal_and_manifest_tasks(formal_tasks, manifest_tasks)
    if status:
        tasks = [task for task in tasks if task.get("status") == status]
    if phase:
        tasks = [task for task in tasks if task.get("phase") == phase]
    tasks.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return tasks[:limit]


def find_task(task_id: str) -> Optional[Dict[str, Any]]:
    formal = repository.get_generation_task(task_id)
    if formal:
        return normalize_db_task(formal)
    for task in scan_tasks(limit=1000):
        if task.get("task_id") == task_id:
            return task
    return None


def project_tasks(project_id: str) -> List[Dict[str, Any]]:
    storage = AssetStorageService(project_id)
    manifest = storage.manifest()
    formal_tasks = repository.list_generation_tasks_by_project(storage.project_id)
    return _merge_formal_and_manifest_tasks(
        formal_tasks,
        build_project_tasks(storage.project_id, manifest),
    )


def dashboard_snapshot() -> Dict[str, Any]:
    projects = scan_projects(limit=500)
    tasks = scan_tasks(limit=1000)
    assets_total = sum(project.get("asset_count") or 0 for project in projects)
    ready_assets = sum(project.get("ready_asset_count") or 0 for project in projects)
    disk_usage_bytes = sum((project.get("disk_usage") or {}).get("bytes") or 0 for project in projects)

    status_counter = Counter(task.get("status") or "unknown" for task in tasks)
    phase_map: Dict[str, Dict[str, Any]] = {}
    for task in tasks:
        phase = task.get("phase") or "unknown"
        item = phase_map.setdefault(
            phase,
            {
                "phase": phase,
                "phase_label": PHASE_LABELS.get(phase, phase),
                "total": 0,
                "succeeded": 0,
                "failed": 0,
                "running": 0,
                "unknown": 0,
            },
        )
        item["total"] += 1
        status = task.get("status") or "unknown"
        item[status] = item.get(status, 0) + 1

    recent_failures = [
        {
            key: task.get(key)
            for key in [
                "task_id",
                "project_id",
                "status",
                "phase",
                "phase_label",
                "error_message",
                "updated_at",
            ]
        }
        for task in tasks
        if task.get("status") == "failed"
    ][:8]

    project_rankings = sorted(
        projects,
        key=lambda item: (item.get("disk_usage") or {}).get("bytes") or 0,
        reverse=True,
    )[:8]

    return {
        "summary": {
            "project_count": len(projects),
            "asset_count": assets_total,
            "ready_asset_count": ready_assets,
            "task_count": len(tasks),
            "succeeded_task_count": status_counter.get("succeeded", 0),
            "failed_task_count": status_counter.get("failed", 0),
            "running_task_count": status_counter.get("running", 0),
            "pending_task_count": status_counter.get("pending", 0),
            "disk_usage_bytes": disk_usage_bytes,
            "disk_usage_display": display_size(disk_usage_bytes),
        },
        "task_status": [
            {"status": status, "count": count}
            for status, count in sorted(status_counter.items())
        ],
        "phase_stats": sorted(
            phase_map.values(),
            key=lambda item: TASK_PHASE_ORDER.get(item.get("phase"), 999),
        ),
        "recent_failures": recent_failures,
        "project_rankings": project_rankings,
    }
