import hashlib
import uuid
from typing import Any, Dict, Optional

from app.services.asset_storage import sanitize_project_id

from .repository import now_iso, repository


PHASE_TASK_MAP = {
    "RoleImage": "role_images",
    "FirstFrameImage": "storyboard_images",
    "Video": "storyboard_videos",
    "Film": "film",
}


def normalize_task_status(status: str) -> str:
    if status == "ready":
        return "succeeded"
    if status in {"submitted", "processing"}:
        return "running"
    if status in {"failed", "running", "succeeded", "pending", "canceled", "unknown"}:
        return status
    return "unknown"


def classify_error(message: str) -> Dict[str, Any]:
    value = message or ""
    if "ConnectTimeoutError" in value or "timed out" in value:
        return {
            "error_code": "ASSET_DOWNLOAD_TIMEOUT",
            "error_type": "network_timeout",
            "error_message": "外部资源下载超时",
            "retryable": True,
            "provider": "external_asset",
        }
    if "Max retries exceeded" in value:
        return {
            "error_code": "EXTERNAL_CONNECTION_RETRY_EXCEEDED",
            "error_type": "network_retry_exceeded",
            "error_message": "外部连接重试失败",
            "retryable": True,
            "provider": "external_asset",
        }
    if "asset exceeds download limit" in value:
        return {
            "error_code": "ASSET_TOO_LARGE",
            "error_type": "asset_limit",
            "error_message": "资产文件超过下载限制",
            "retryable": False,
            "provider": "asset_storage",
        }
    if "file not found" in value:
        return {
            "error_code": "ASSET_FILE_NOT_FOUND",
            "error_type": "asset_missing",
            "error_message": "资产文件不存在",
            "retryable": False,
            "provider": "asset_storage",
        }
    return {
        "error_code": "GENERATION_ERROR",
        "error_type": "unknown",
        "error_message": value[:500] or "任务执行失败",
        "retryable": False,
        "provider": "",
    }


def task_id_for(project_id: str, phase: str, request_fingerprint: str = "") -> str:
    safe_project_id = sanitize_project_id(project_id)
    if request_fingerprint:
        digest = hashlib.sha1(request_fingerprint.encode("utf-8")).hexdigest()[:10]
        return f"{safe_project_id}:{phase}:{digest}"
    return f"{safe_project_id}:{phase}"


class TaskTracker:
    def ensure_task(
        self,
        project_id: str,
        phase: str,
        task_type: str = "generation_phase",
        task_id: str = "",
        status: str = "running",
        progress: int = 0,
        input_summary: str = "",
        creator: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        safe_project_id = sanitize_project_id(project_id)
        final_task_id = task_id or task_id_for(safe_project_id, phase)
        metadata = metadata or {}
        tenant_id = metadata.get("tenant_id") or ""
        workspace_id = metadata.get("workspace_id") or ""
        task = repository.upsert_generation_task(
            task_id=final_task_id,
            project_id=safe_project_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            task_type=task_type,
            status=normalize_task_status(status),
            phase=phase,
            progress=progress,
            creator_user_id=creator.get("id") if creator else None,
            creator_username=creator.get("username", "") if creator else "",
            input_summary=input_summary,
            started_at=now_iso(),
            metadata=metadata,
        )
        repository.create_generation_task_event(
            task_id=final_task_id,
            project_id=safe_project_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            phase=phase,
            status=normalize_task_status(status),
            message="任务开始",
            started_at=task.get("started_at") or now_iso(),
            metadata=metadata,
        )
        return task

    def attach_asset(
        self,
        project_id: str,
        phase: str,
        asset: Dict[str, Any],
        task_id: str = "",
        creator: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        if not asset:
            return None
        safe_project_id = sanitize_project_id(project_id)
        final_task_id = task_id or task_id_for(safe_project_id, phase)
        status = normalize_task_status(asset.get("status") or "unknown")
        message = asset.get("message") or asset.get("filename") or asset.get("source_url") or ""
        progress = 100 if status == "succeeded" else 0
        error_info = classify_error(message) if status == "failed" else {}

        task = repository.upsert_generation_task(
            task_id=final_task_id,
            project_id=safe_project_id,
            task_type="asset_phase",
            status=status,
            phase=phase,
            progress=progress,
            creator_user_id=creator.get("id") if creator else None,
            creator_username=creator.get("username", "") if creator else "",
            error_code=error_info.get("error_code", ""),
            error_type=error_info.get("error_type", ""),
            error_message=error_info.get("error_message", ""),
            error_detail=message if status == "failed" else "",
            provider=error_info.get("provider", ""),
            retryable=bool(error_info.get("retryable")),
            started_at=asset.get("updated_at") or now_iso(),
            finished_at=asset.get("updated_at") or now_iso() if status in {"succeeded", "failed"} else "",
            metadata={
                "asset_id": asset.get("asset_id"),
                "source_task_id": asset.get("video_gen_task_id") or (asset.get("metadata") or {}).get("video_gen_task_id"),
            },
        )
        repository.create_generation_task_event(
            task_id=final_task_id,
            project_id=safe_project_id,
            phase=phase,
            status=status,
            message=message[:1000],
            asset_id=asset.get("asset_id") or "",
            error_code=error_info.get("error_code", ""),
            error_type=error_info.get("error_type", ""),
            error_message=error_info.get("error_message", ""),
            finished_at=asset.get("updated_at") or now_iso(),
            metadata={
                "filename": asset.get("filename"),
                "relative_path": asset.get("relative_path"),
                "download_url": asset.get("download_url"),
                "source_task_id": asset.get("video_gen_task_id") or (asset.get("metadata") or {}).get("video_gen_task_id"),
            },
        )
        return task

    def finish_task(
        self,
        project_id: str,
        phase: str,
        status: str = "succeeded",
        task_id: str = "",
        creator: Optional[Dict[str, Any]] = None,
    ):
        safe_project_id = sanitize_project_id(project_id)
        final_task_id = task_id or task_id_for(safe_project_id, phase)
        final_status = normalize_task_status(status)
        current = repository.get_generation_task(final_task_id)
        if current and current.get("status") == "failed" and final_status == "succeeded":
            return current
        finished_at = now_iso()
        task = repository.update_generation_task(
            final_task_id,
            {
                "status": final_status,
                "progress": 100 if final_status == "succeeded" else 0,
                "finished_at": finished_at,
                "creator_user_id": creator.get("id") if creator else None,
                "creator_username": creator.get("username", "") if creator else "",
            },
        )
        repository.create_generation_task_event(
            task_id=final_task_id,
            project_id=safe_project_id,
            phase=phase,
            status=final_status,
            message="任务完成" if final_status == "succeeded" else "任务结束",
            finished_at=finished_at,
        )
        return task

    def fail_task(
        self,
        project_id: str,
        phase: str,
        message: str,
        task_id: str = "",
        creator: Optional[Dict[str, Any]] = None,
    ):
        safe_project_id = sanitize_project_id(project_id)
        final_task_id = task_id or task_id_for(safe_project_id, phase)
        error_info = classify_error(message)
        repository.upsert_generation_task(
            task_id=final_task_id,
            project_id=safe_project_id,
            task_type="generation_phase",
            status="failed",
            phase=phase,
            progress=0,
            creator_user_id=creator.get("id") if creator else None,
            creator_username=creator.get("username", "") if creator else "",
            error_code=error_info["error_code"],
            error_type=error_info["error_type"],
            error_message=error_info["error_message"],
            error_detail=message,
            provider=error_info.get("provider", ""),
            retryable=bool(error_info.get("retryable")),
            started_at=now_iso(),
            finished_at=now_iso(),
        )
        return repository.create_generation_task_event(
            task_id=final_task_id,
            project_id=safe_project_id,
            phase=phase,
            status="failed",
            message=message[:1000],
            error_code=error_info["error_code"],
            error_type=error_info["error_type"],
            error_message=error_info["error_message"],
            finished_at=now_iso(),
        )


task_tracker = TaskTracker()
