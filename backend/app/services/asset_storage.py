import json
import mimetypes
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

from app.logger import ERROR, INFO, WARN


ASSET_ROOT = Path(
    os.getenv("ASSET_ROOT") or Path(__file__).resolve().parents[3] / "assets" / "generated"
)
DEFAULT_PROJECT_ID = "default"
MAX_ASSET_DOWNLOAD_BYTES = 500 * 1024 * 1024

PHASE_DIRECTORIES = {
    "role_images": "role_images",
    "storyboard_images": "storyboard_images",
    "storyboard_videos": "storyboard_videos",
    "film": "film",
    "source": "source",
}


def sanitize_project_id(project_id: Optional[str]) -> str:
    if not project_id:
        return DEFAULT_PROJECT_ID
    value = re.sub(r"[^a-zA-Z0-9_-]", "_", project_id.strip())
    return value[:80] or DEFAULT_PROJECT_ID


def get_project_id_from_content_options(content_options: Dict[str, Any]) -> str:
    return sanitize_project_id(content_options.get("project_id"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_filename(value: Optional[str], fallback: str) -> str:
    if not value:
        return fallback
    safe = re.sub(r"[\\/:*?\"<>|\s]+", "_", value.strip())
    safe = re.sub(r"_+", "_", safe).strip("._")
    return safe[:80] or fallback


def _extension_from_url(url: str, fallback: str) -> str:
    path = urlparse(url).path
    suffix = Path(path).suffix.lower().lstrip(".")
    if suffix:
        return suffix
    return fallback


def _extension_from_content_type(content_type: Optional[str], fallback: str) -> str:
    if not content_type:
        return fallback
    extension = mimetypes.guess_extension(content_type.split(";", 1)[0].strip())
    if not extension:
        return fallback
    guessed = extension.lstrip(".")
    if guessed in {"bin", "octet-stream"}:
        return fallback
    return guessed


def _is_downloadable_url(url: str) -> bool:
    return url.startswith("http://") or url.startswith("https://")


class AssetStorageService:
    def __init__(self, project_id: Optional[str]):
        self.project_id = sanitize_project_id(project_id)
        self.project_dir = ASSET_ROOT / self.project_id
        self.manifest_path = self.project_dir / "manifest.json"
        self.project_dir.mkdir(parents=True, exist_ok=True)

    def _phase_dir(self, phase: str) -> Path:
        directory = self.project_dir / PHASE_DIRECTORIES.get(phase, phase)
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def _read_manifest(self) -> Dict[str, Any]:
        if not self.manifest_path.exists():
            return {
                "project_id": self.project_id,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "assets": [],
            }
        try:
            with self.manifest_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            WARN(f"failed to read asset manifest, project_id={self.project_id}, error={e}")
            return {
                "project_id": self.project_id,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "assets": [],
            }

    def _write_manifest(self, manifest: Dict[str, Any]):
        manifest["project_id"] = self.project_id
        manifest["updated_at"] = _now_iso()
        self.project_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = self.manifest_path.with_suffix(".json.tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        tmp_path.replace(self.manifest_path)

    def manifest(self) -> Dict[str, Any]:
        return self._read_manifest()

    def _upsert_asset(self, asset: Dict[str, Any]) -> Dict[str, Any]:
        manifest = self._read_manifest()
        assets = manifest.setdefault("assets", [])
        for existing in assets:
            if existing.get("asset_id") == asset.get("asset_id"):
                existing.update(asset)
                asset = existing
                break
        else:
            assets.append(asset)
        self._write_manifest(manifest)
        self._track_asset(asset)
        return asset

    def _track_asset(self, asset: Dict[str, Any]):
        try:
            from app.admin.task_tracker import task_tracker

            task_tracker.attach_asset(
                self.project_id,
                asset.get("phase") or "unknown",
                asset,
            )
        except Exception as e:
            WARN(f"failed to track asset, project_id={self.project_id}, asset_id={asset.get('asset_id')}, error={e}")

    def _build_download_url(self, asset_id: str) -> str:
        return f"/v1/assets/projects/{self.project_id}/files/{asset_id}"

    def register_failed_asset(
        self,
        phase: str,
        index: int,
        source_url: str,
        message: str,
    ) -> Dict[str, Any]:
        asset_id = f"{phase}_{index + 1:02d}"
        return self._upsert_asset({
            "asset_id": asset_id,
            "phase": phase,
            "index": index,
            "source_url": source_url,
            "status": "failed",
            "message": message,
            "updated_at": _now_iso(),
        })

    def register_video_task_asset(
        self,
        phase: str,
        index: int,
        task_id: str,
        status: str = "submitted",
        message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        asset_id = f"{phase}_{index + 1:02d}"
        asset: Dict[str, Any] = {
            "asset_id": asset_id,
            "phase": phase,
            "index": index,
            "status": status,
            "video_gen_task_id": task_id,
            "metadata": {
                **(metadata or {}),
                "video_gen_task_id": task_id,
            },
            "updated_at": _now_iso(),
        }
        if message:
            asset["message"] = message
        return self._upsert_asset(asset)

    def find_phase_asset(self, phase: str, index: int) -> Optional[Dict[str, Any]]:
        asset_id = f"{phase}_{index + 1:02d}"
        return self.find_asset(asset_id)

    def local_download_url(self, asset_id: str) -> str:
        return self._build_download_url(asset_id)

    def store_url_asset(
        self,
        phase: str,
        index: int,
        url: str,
        filename_prefix: str,
        fallback_ext: str,
        display_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        if not _is_downloadable_url(url):
            return self.register_failed_asset(phase, index, url, "source url is not downloadable")

        asset_id = f"{phase}_{index + 1:02d}"
        filename_base = _safe_filename(display_name, filename_prefix)
        phase_dir = self._phase_dir(phase)

        try:
            with requests.get(url, stream=True, timeout=(10, 180)) as response:
                response.raise_for_status()
                extension = _extension_from_content_type(
                    response.headers.get("Content-Type"),
                    _extension_from_url(url, fallback_ext),
                )
                filename = f"{filename_prefix}_{filename_base}.{extension}" if display_name else f"{filename_prefix}.{extension}"
                filename = _safe_filename(filename, f"{filename_prefix}.{extension}")
                relative_path = f"{PHASE_DIRECTORIES.get(phase, phase)}/{filename}"
                file_path = phase_dir / filename

                total_size = 0
                with tempfile.NamedTemporaryFile(delete=False, dir=phase_dir) as tmp:
                    tmp_path = Path(tmp.name)
                    for chunk in response.iter_content(chunk_size=1024 * 256):
                        if not chunk:
                            continue
                        total_size += len(chunk)
                        if total_size > MAX_ASSET_DOWNLOAD_BYTES:
                            raise ValueError("asset exceeds download limit")
                        tmp.write(chunk)
                tmp_path.replace(file_path)
        except Exception as e:
            ERROR(f"failed to store url asset, project_id={self.project_id}, phase={phase}, index={index}, error={e}")
            return self.register_failed_asset(phase, index, url, str(e))

        asset = {
            "asset_id": asset_id,
            "phase": phase,
            "index": index,
            "filename": filename,
            "relative_path": relative_path,
            "source_url": url,
            "download_url": self._build_download_url(asset_id),
            "status": "ready",
            "size": total_size,
            "metadata": metadata or {},
            "updated_at": _now_iso(),
        }
        INFO(
            f"stored asset, project_id={self.project_id}, phase={phase}, "
            f"index={index}, path={relative_path}, size={total_size}"
        )
        return self._upsert_asset(asset)

    def store_bytes_asset(
        self,
        phase: str,
        index: int,
        data: bytes,
        filename: str,
        source_url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        asset_id = f"{phase}_{index + 1:02d}" if phase != "film" else "film_final"
        filename = _safe_filename(filename, f"{asset_id}.bin")
        phase_dir = self._phase_dir(phase)
        file_path = phase_dir / filename
        relative_path = f"{PHASE_DIRECTORIES.get(phase, phase)}/{filename}"
        file_path.write_bytes(data)
        asset = {
            "asset_id": asset_id,
            "phase": phase,
            "index": index,
            "filename": filename,
            "relative_path": relative_path,
            "source_url": source_url,
            "download_url": self._build_download_url(asset_id),
            "status": "ready",
            "size": len(data),
            "metadata": metadata or {},
            "updated_at": _now_iso(),
        }
        INFO(
            f"stored bytes asset, project_id={self.project_id}, phase={phase}, "
            f"index={index}, path={relative_path}, size={len(data)}"
        )
        return self._upsert_asset(asset)

    def find_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        for asset in self._read_manifest().get("assets", []):
            if asset.get("asset_id") == asset_id:
                return asset
        return None

    def ready_assets_for_phase(self, phase: str) -> List[Dict[str, Any]]:
        return [
            asset
            for asset in self._read_manifest().get("assets", [])
            if asset.get("phase") == phase and asset.get("status") == "ready"
        ]

    def file_path_for_asset(self, asset: Dict[str, Any]) -> Path:
        relative_path = asset.get("relative_path")
        if not relative_path:
            raise FileNotFoundError("asset has no local path")
        file_path = (self.project_dir / relative_path).resolve()
        if not str(file_path).startswith(str(self.project_dir.resolve())):
            raise FileNotFoundError("asset path is outside project directory")
        if not file_path.exists():
            raise FileNotFoundError("asset file not found")
        return file_path

    def build_archive(self, phase: str, archive_name: str, include_manifest: bool = False) -> Path:
        assets = self.ready_assets_for_phase(phase)
        if not assets:
            raise FileNotFoundError("no ready assets for phase")
        archive_dir = self._phase_dir("archives")
        archive_path = archive_dir / archive_name
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for asset in sorted(assets, key=lambda item: (item.get("index", 0), item.get("filename", ""))):
                file_path = self.file_path_for_asset(asset)
                zf.write(file_path, arcname=asset.get("relative_path") or file_path.name)
            if include_manifest and self.manifest_path.exists():
                zf.write(self.manifest_path, arcname="manifest.json")
        return archive_path

    def build_all_archive(self) -> Path:
        archive_dir = self._phase_dir("archives")
        archive_path = archive_dir / "all_assets.zip"
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
            has_file = False
            for asset in self._read_manifest().get("assets", []):
                if asset.get("status") != "ready":
                    continue
                try:
                    file_path = self.file_path_for_asset(asset)
                except FileNotFoundError:
                    continue
                zf.write(file_path, arcname=asset.get("relative_path") or file_path.name)
                has_file = True
            if self.manifest_path.exists():
                zf.write(self.manifest_path, arcname="manifest.json")
                has_file = True
        if not has_file:
            raise FileNotFoundError("no ready assets")
        return archive_path

    def copy_source_file(self, source_path: Path, filename: str) -> Dict[str, Any]:
        phase = "source"
        asset_id = f"source_{_safe_filename(Path(filename).stem, 'file')}"
        phase_dir = self._phase_dir(phase)
        safe_name = _safe_filename(filename, source_path.name)
        target_path = phase_dir / safe_name
        shutil.copyfile(source_path, target_path)
        relative_path = f"{PHASE_DIRECTORIES[phase]}/{safe_name}"
        return self._upsert_asset({
            "asset_id": asset_id,
            "phase": phase,
            "index": 0,
            "filename": safe_name,
            "relative_path": relative_path,
            "download_url": self._build_download_url(asset_id),
            "status": "ready",
            "size": target_path.stat().st_size,
            "updated_at": _now_iso(),
        })
