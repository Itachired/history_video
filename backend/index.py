# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# Licensed under the 【火山方舟】原型应用软件自用许可协议
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at 
#     https://www.volcengine.com/docs/82379/1433703
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License. 

import base64
import binascii
import json
import logging
import mimetypes
import os
import sys
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import AsyncIterable, Dict, Union

from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env", override=True)

from app.clients.tos import TOSClient
from app.constants import (
    API_KEY,
    ARTIFACT_TOS_BUCKET,
    CGT_ENDPOINT_ID,
    LLM_ENDPOINT_ID,
    T2V_ENDPOINT_ID,
    TTS_ACCESS_KEY,
    TTS_API_RESOURCE_ID,
    TTS_APP_KEY,
    TTS_BASE_URL,
    VLM_ENDPOINT_ID,
)
from app.generators.factory import GeneratorFactory
from app.generators.phase import PhaseFinder, get_phase_from_message
from app.message_utils import get_last_message
from app.mode import Mode
from app.services.asset_storage import ASSET_ROOT, AssetStorageService

from fastapi import HTTPException, Query, Request
from fastapi.responses import FileResponse
from arkitect.core.component.llm.model import (
    ArkChatCompletionChunk,
    ArkChatRequest,
    ArkChatResponse,
)
from arkitect.core.component.bot import BotServer
from arkitect.launcher.runner import get_endpoint_config, get_runner
from arkitect.launcher.vefaas import bot_wrapper
from arkitect.telemetry.logger import INFO
from arkitect.telemetry.trace import setup_tracing, task
from arkitect.utils.context import set_account_id, set_resource_id, set_resource_type

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s][%(levelname)s] %(message)s"
)
LOGGER = logging.getLogger(__name__)

MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_REFERENCE_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

SERVER_STARTED_AT = datetime.now(timezone.utc).isoformat()


def _config_present(value: str) -> bool:
    return bool(value and not value.startswith("<your-"))


def _desktop_config_status():
    tts_configured = all(
        _config_present(value)
        for value in [TTS_ACCESS_KEY, TTS_API_RESOURCE_ID, TTS_APP_KEY, TTS_BASE_URL]
    )
    tos_configured = all(
        _config_present(value)
        for value in [
            os.getenv("TOS_ACCESSKEY", ""),
            os.getenv("TOS_SECRETKEY", ""),
            ARTIFACT_TOS_BUCKET,
        ]
    )
    return {
        "api_key": _config_present(API_KEY),
        "llm_endpoint_id": _config_present(LLM_ENDPOINT_ID),
        "t2v_endpoint_id": _config_present(T2V_ENDPOINT_ID),
        "cgt_endpoint_id": _config_present(CGT_ENDPOINT_ID),
        "vlm_endpoint_id": _config_present(VLM_ENDPOINT_ID),
        "tos": tos_configured,
        "tos_bucket": _config_present(ARTIFACT_TOS_BUCKET),
        "tts": tts_configured,
    }


def _desktop_capabilities(config: Dict[str, bool]):
    return {
        "script": config["api_key"] and config["llm_endpoint_id"],
        "image": config["api_key"] and config["t2v_endpoint_id"],
        "video": config["api_key"] and config["cgt_endpoint_id"],
        "tts": config["tts"],
        "film": config["tos"],
    }


def _asset_phase_counts(manifest: Dict):
    counts: Dict[str, Dict[str, int]] = {}
    for asset in manifest.get("assets", []):
        phase = asset.get("phase") or "unknown"
        status = asset.get("status") or "unknown"
        phase_counts = counts.setdefault(phase, {"total": 0})
        phase_counts["total"] += 1
        phase_counts[status] = phase_counts.get(status, 0) + 1
    return counts


def _load_project_summary(project_dir: Path):
    manifest_path = project_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as exc:
        LOGGER.warning("failed to read project manifest: %s", manifest_path)
        return {
            "project_id": project_dir.name,
            "manifest_path": str(manifest_path),
            "project_dir": str(project_dir),
            "status": "manifest_error",
            "message": str(exc),
            "updated_at": datetime.fromtimestamp(
                manifest_path.stat().st_mtime,
                timezone.utc,
            ).isoformat(),
            "asset_count": 0,
            "phase_counts": {},
        }

    assets = manifest.get("assets", [])
    ready_count = len([asset for asset in assets if asset.get("status") == "ready"])
    storyboard_video_tasks = [
        asset
        for asset in assets
        if asset.get("phase") == "storyboard_videos"
        and (asset.get("video_gen_task_id") or asset.get("metadata", {}).get("video_gen_task_id"))
    ]
    film_ready = any(
        asset.get("phase") == "film" and asset.get("status") == "ready"
        for asset in assets
    )
    return {
        "project_id": manifest.get("project_id") or project_dir.name,
        "manifest_path": str(manifest_path),
        "project_dir": str(project_dir),
        "status": "ready" if assets else "empty",
        "created_at": manifest.get("created_at"),
        "updated_at": manifest.get("updated_at")
        or datetime.fromtimestamp(manifest_path.stat().st_mtime, timezone.utc).isoformat(),
        "asset_count": len(assets),
        "ready_asset_count": ready_count,
        "phase_counts": _asset_phase_counts(manifest),
        "storyboard_video_task_count": len(storyboard_video_tasks),
        "film_ready": film_ready,
    }


@task()
async def main(
    request: ArkChatRequest,
) -> AsyncIterable[Union[ArkChatCompletionChunk, ArkChatResponse]]:
    """
    Determines the phase and mode based on the last message in the
    current request and executes the corresponding response generator.
    """

    last_user_message = get_last_message(request.messages, "user")

    mode = Mode.CONFIRMATION
    if type(last_user_message.content) is str and last_user_message.content.startswith(
        Mode.REGENERATION.value
    ):
        mode = Mode.REGENERATION

    INFO(f"mode: {mode.value}")

    phase = PhaseFinder(request).get_next_phase()
    if mode == Mode.REGENERATION:
        phase = get_phase_from_message(last_user_message.content)

    INFO(f"phase: {phase.value}")

    generator = GeneratorFactory(phase).get_generator(request, mode)

    async for chunk in generator.generate():
        yield chunk


@bot_wrapper(trace_on=True)
@task(custom_attributes={"input": None, "output": None})
async def handler(
    request: ArkChatRequest,
) -> AsyncIterable[Union[ArkChatCompletionChunk, ArkChatResponse]]:
    async for resp in main(request):
        yield resp


async def upload_reference_image(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json payload")

    content_type = payload.get("content_type", "")
    image_data = payload.get("data", "")
    if content_type not in ALLOWED_REFERENCE_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="unsupported image type")
    if not image_data:
        raise HTTPException(status_code=400, detail="image data is required")

    if "," in image_data:
        image_data = image_data.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(image_data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="invalid base64 image data")

    if len(image_bytes) > MAX_REFERENCE_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="image exceeds 10MB limit")

    ext = ALLOWED_REFERENCE_IMAGE_TYPES[content_type]
    object_key = f"reference-images/{uuid.uuid4().hex}.{ext}"

    tos_client = TOSClient()
    tos_client.put_object(ARTIFACT_TOS_BUCKET, object_key, BytesIO(image_bytes))
    output = tos_client.pre_signed_url(ARTIFACT_TOS_BUCKET, object_key)

    return {
        "url": output.signed_url,
        "object_key": object_key,
    }


def _file_response(path: Path, filename: str):
    response = FileResponse(
        path=str(path),
        filename=filename,
        media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
    )
    if path.suffix.lower() in {".mp4", ".webm", ".mov"}:
        quoted_filename = filename.replace('"', "")
        response.headers["Content-Disposition"] = f'inline; filename="{quoted_filename}"'
    return response


async def get_project_manifest(project_id: str):
    storage = AssetStorageService(project_id)
    return storage.manifest()


async def download_project_asset(project_id: str, asset_id: str):
    storage = AssetStorageService(project_id)
    asset = storage.find_asset(asset_id)
    if not asset or asset.get("status") != "ready":
        raise HTTPException(status_code=404, detail="asset not found")
    try:
        file_path = storage.file_path_for_asset(asset)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="asset file not found")
    return _file_response(file_path, asset.get("filename") or file_path.name)


async def download_project_phase_archive(project_id: str, phase: str):
    archive_names = {
        "role_images": "role_images.zip",
        "storyboard_images": "storyboard_images.zip",
        "storyboard_videos": "storyboard_videos.zip",
        "film": "film.zip",
    }
    if phase not in archive_names:
        raise HTTPException(status_code=400, detail="unsupported archive phase")
    storage = AssetStorageService(project_id)
    try:
        archive_path = storage.build_archive(phase, archive_names[phase], include_manifest=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="no ready assets for phase")
    return _file_response(archive_path, archive_path.name)


async def download_project_all_archive(project_id: str):
    storage = AssetStorageService(project_id)
    try:
        archive_path = storage.build_all_archive()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="no ready assets")
    return _file_response(archive_path, archive_path.name)


async def download_storyboard_video_task(project_id: str, index: int, task_id: str):
    from volcenginesdkarkruntime import Ark

    storage = AssetStorageService(project_id)
    asset_id = f"storyboard_videos_{index + 1:02d}"
    asset = storage.find_asset(asset_id)
    if asset and asset.get("status") == "ready":
        file_path = storage.file_path_for_asset(asset)
        return _file_response(file_path, asset.get("filename") or file_path.name)

    client = Ark(api_key=API_KEY, region="cn-beijing")
    task_obj = client.content_generation.tasks.get(task_id=task_id)
    if task_obj.status != "succeeded":
        raise HTTPException(status_code=409, detail="video task is not completed")
    video_url = task_obj.content.video_url
    if not video_url:
        raise HTTPException(status_code=404, detail="video url is empty")

    asset = storage.store_url_asset(
        "storyboard_videos",
        index,
        video_url,
        f"shot_{index + 1:02d}",
        "mp4",
        metadata={"video_gen_task_id": task_id},
    )
    if not asset or asset.get("status") != "ready":
        raise HTTPException(status_code=500, detail="failed to store video asset")
    file_path = storage.file_path_for_asset(asset)
    return _file_response(file_path, asset.get("filename") or file_path.name)


def _absolute_url(request: Request, path: str):
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{str(request.base_url).rstrip('/')}{path if path.startswith('/') else f'/{path}'}"


def _task_id_from_asset(asset: dict):
    return asset.get("video_gen_task_id") or asset.get("metadata", {}).get("video_gen_task_id")


def _sync_storyboard_video_asset(request: Request, client, storage: AssetStorageService, asset: dict):
    task_id = _task_id_from_asset(asset)
    index = asset.get("index")
    if not task_id or index is None:
        return asset

    if asset.get("status") == "ready":
        return asset

    task_obj = client.content_generation.tasks.get(task_id=task_id)
    payload = task_obj.model_dump(exclude_none=True)
    status = payload.get("status")

    if status == "succeeded":
        video_url = payload.get("content", {}).get("video_url")
        if video_url:
            synced_asset = storage.store_url_asset(
                "storyboard_videos",
                index,
                video_url,
                f"shot_{index + 1:02d}",
                "mp4",
                metadata={"video_gen_task_id": task_id},
            )
            return synced_asset or asset
    if status == "failed":
        error = payload.get("error") or {}
        return storage.register_video_task_asset(
            "storyboard_videos",
            index,
            task_id,
            status="failed",
            message=error.get("message") or "video generation failed",
            metadata={"error": error},
        )
    if status:
        return storage.register_video_task_asset(
            "storyboard_videos",
            index,
            task_id,
            status=status,
        )
    return asset


async def sync_project_storyboard_videos(request: Request, project_id: str):
    from volcenginesdkarkruntime import Ark

    storage = AssetStorageService(project_id)
    client = Ark(api_key=API_KEY, region="cn-beijing")
    assets = [
        asset
        for asset in storage.manifest().get("assets", [])
        if asset.get("phase") == "storyboard_videos"
    ]
    synced_assets = []
    for asset in assets:
        try:
            synced_assets.append(_sync_storyboard_video_asset(request, client, storage, asset))
        except Exception as exc:
            LOGGER.exception("failed to sync storyboard video asset: %s", asset.get("asset_id"))
            synced_assets.append({
                **asset,
                "status": "sync_failed",
                "message": str(exc),
            })
    return {
        "project_id": project_id,
        "assets": sorted(synced_assets, key=lambda item: item.get("index", 0)),
    }


async def get_video_generation_task(
    request: Request,
    task_id: str,
    project_id: str = Query(default=""),
    index: int = Query(default=-1),
):
    from volcenginesdkarkruntime import Ark

    client = Ark(api_key=API_KEY, region="cn-beijing")
    try:
        task_obj = client.content_generation.tasks.get(task_id=task_id)
    except Exception as exc:
        LOGGER.exception("failed to get video generation task: %s", task_id)
        raise HTTPException(status_code=502, detail=f"failed to get video generation task: {exc}")

    payload = task_obj.model_dump(exclude_none=True)
    status = payload.get("status")
    local_asset = None
    if project_id and index >= 0:
        storage = AssetStorageService(project_id)
        existing_asset = storage.find_phase_asset("storyboard_videos", index)
        if existing_asset and existing_asset.get("status") == "ready":
            local_asset = existing_asset
        elif existing_asset:
            local_asset = _sync_storyboard_video_asset(request, client, storage, existing_asset)
        elif status == "succeeded":
            video_url = payload.get("content", {}).get("video_url")
            if video_url:
                local_asset = storage.store_url_asset(
                    "storyboard_videos",
                    index,
                    video_url,
                    f"shot_{index + 1:02d}",
                    "mp4",
                    metadata={"video_gen_task_id": task_id},
                )
        elif status == "failed":
            error = payload.get("error") or {}
            local_asset = storage.register_video_task_asset(
                "storyboard_videos",
                index,
                task_id,
                status="failed",
                message=error.get("message") or "video generation failed",
                metadata={"error": error},
            )
        elif status:
            local_asset = storage.register_video_task_asset(
                "storyboard_videos",
                index,
                task_id,
                status=status,
            )

    if local_asset:
        payload["local_asset"] = local_asset
        if local_asset.get("status") == "ready" and local_asset.get("download_url"):
            payload.setdefault("content", {})
            payload["content"]["video_url"] = _absolute_url(request, local_asset["download_url"])

    return payload


async def get_desktop_status(request: Request):
    config = _desktop_config_status()
    return {
        "status": "ok",
        "backend": {
            "base_url": str(request.base_url).rstrip("/"),
            "port": os.getenv("_FAAS_RUNTIME_PORT") or "8888",
            "asset_root": str(ASSET_ROOT),
            "python": sys.executable,
            "started_at": SERVER_STARTED_AT,
            "cwd": os.getcwd(),
        },
        "config": config,
        "capabilities": _desktop_capabilities(config),
    }


async def list_desktop_projects(limit: int = Query(default=20, ge=1, le=100)):
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    projects = []
    for project_dir in ASSET_ROOT.iterdir():
        if not project_dir.is_dir():
            continue
        summary = _load_project_summary(project_dir)
        if summary:
            projects.append(summary)
    projects.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return {
        "asset_root": str(ASSET_ROOT),
        "projects": projects[:limit],
    }


if __name__ == "__main__":
    port = os.getenv("_FAAS_RUNTIME_PORT")
    set_resource_type(os.getenv("RESOURCE_TYPE") or "")
    set_resource_id(os.getenv("RESOURCE_ID") or "")
    set_account_id(os.getenv("ACCOUNT_ID") or "")
    setup_tracing(
        endpoint=os.getenv("TRACE_ENDPOINT"),
        trace_on=True,
        log_dir="./",
    )

    server = BotServer(
        runner=get_runner(main),
        health_check_path="/v1/ping",
        endpoint_config=get_endpoint_config("/api/v3/bots/chat/completions", main),
        clients={},
    )
    server.app.add_api_route(
        "/v1/assets/upload-reference-image",
        upload_reference_image,
        methods=["POST", "OPTIONS"],
    )
    server.app.add_api_route(
        "/v1/assets/projects/{project_id}/manifest",
        get_project_manifest,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/assets/projects/{project_id}/files/{asset_id}",
        download_project_asset,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/assets/projects/{project_id}/archive/{phase}",
        download_project_phase_archive,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/assets/projects/{project_id}/archive-all",
        download_project_all_archive,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/assets/projects/{project_id}/storyboard-videos/{index}/{task_id}",
        download_storyboard_video_task,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/assets/projects/{project_id}/storyboard-videos/sync",
        sync_project_storyboard_videos,
        methods=["POST", "GET", "OPTIONS"],
    )
    server.app.add_api_route(
        "/v1/video-tasks/{task_id}",
        get_video_generation_task,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/desktop/status",
        get_desktop_status,
        methods=["GET"],
    )
    server.app.add_api_route(
        "/v1/desktop/projects",
        list_desktop_projects,
        methods=["GET"],
    )
    server.run(app=server.app, port=int(port) if port else 8888)
