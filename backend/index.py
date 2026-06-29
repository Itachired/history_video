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
import re
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

from app.clients.llm import LLMClient
from app.clients.tos import TOSClient
from app.admin import register_admin_routes
from app.admin.billing_context import reset_billing_context, set_billing_context
from app.admin.dependencies import get_admin_user_from_token
from app.admin.repository import repository
from app.admin.task_tracker import PHASE_TASK_MAP, task_tracker
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
    MAX_STORY_BOARD_NUMBER,
)
from app.generators.factory import GeneratorFactory
from app.generators.phase import PhaseFinder, get_phase_from_message
from app.generators.phases.knowledge_style import build_knowledge_style_prompt
from app.message_utils import get_last_message
from app.mode import Mode
from app.services.asset_storage import ASSET_ROOT, AssetStorageService
from app.services.asset_storage import get_project_id_from_content_options, sanitize_project_id

from fastapi import HTTPException, Query, Request
from fastapi.responses import FileResponse
from arkitect.core.component.llm.model import (
    ArkChatCompletionChunk,
    ArkChatRequest,
    ArkChatResponse,
    ArkMessage,
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
STORYBOARD_REWRITE_MAX_TEXT_LENGTH = 30000
STORYBOARD_REWRITE_MAX_INSTRUCTION_LENGTH = 1000
ALLOWED_REFERENCE_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

SERVER_STARTED_AT = datetime.now(timezone.utc).isoformat()


def _clean_text(value) -> str:
    return value if isinstance(value, str) else ""


def _validate_storyboard_text(storyboards: str):
    if not storyboards.strip():
        raise HTTPException(status_code=400, detail="storyboards is required")
    if len(storyboards) > STORYBOARD_REWRITE_MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail="storyboards is too long")
    required_tokens = ["phase=StoryBoard", "角色", "画面", "中文台词", "英文台词"]
    missing = [token for token in required_tokens if token not in storyboards]
    if not re.search(r"分镜\s*1[：:]", storyboards):
        missing.append("分镜1")
    if missing:
        raise HTTPException(status_code=400, detail=f"invalid storyboard format, missing: {', '.join(missing)}")


def _header_value(headers, name: str) -> str:
    if not headers:
        return ""
    try:
        value = headers.get(name)
    except AttributeError:
        value = None
    if value:
        return str(value)
    lower_name = name.lower()
    if isinstance(headers, dict):
        for key, item in headers.items():
            if str(key).lower() == lower_name:
                return str(item)
    return ""


def _admin_token_from_any_request(request) -> str:
    headers = _headers_from_any_request(request)
    authorization = _header_value(headers, "authorization")
    if authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    cookie = _header_value(headers, "cookie")
    if cookie:
        for part in cookie.split(";"):
            key, _, value = part.strip().partition("=")
            if key == "admin_access_token":
                return value
    return ""


def _headers_from_any_request(request):
    return (
        getattr(request, "headers", None)
        or getattr(request, "Headers", None)
        or getattr(request, "header", None)
        or {}
    )


def _current_admin_user_from_chat_request(request) -> Dict:
    token = _admin_token_from_any_request(request)
    return get_admin_user_from_token(token) or {}


def _current_admin_user_from_fastapi_request(request: Request) -> Dict:
    authorization = request.headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return get_admin_user_from_token(authorization.split(" ", 1)[1].strip()) or {}
    token = request.cookies.get("admin_access_token") or ""
    return get_admin_user_from_token(token) or {}


def _org_context_from_headers(headers, user: Dict, content_options: Dict = None) -> Dict:
    content_options = content_options or {}
    tenant_id = (
        _header_value(headers, "x-tenant-id")
        or content_options.get("tenant_id")
        or ""
    )
    workspace_id = (
        _header_value(headers, "x-workspace-id")
        or content_options.get("workspace_id")
        or ""
    )
    return repository.validate_user_workspace(user or {}, tenant_id, workspace_id)


def _org_context_from_fastapi_request(request: Request, user: Dict, content_options: Dict = None) -> Dict:
    return _org_context_from_headers(request.headers, user, content_options)


def _org_context_from_chat_request(request, user: Dict, content_options: Dict = None) -> Dict:
    return _org_context_from_headers(_headers_from_any_request(request), user, content_options)


def _ensure_project_owner(project_id: str, user: Dict, tenant_id: str = "", workspace_id: str = ""):
    safe_project_id = sanitize_project_id(project_id)
    if not safe_project_id:
        return
    existing_project = repository.get_project_record(safe_project_id)
    storage = AssetStorageService(safe_project_id)
    manifest = storage.manifest()
    project = repository.ensure_project_record(
        safe_project_id,
        project_dir=str(storage.project_dir),
        manifest_path=str(storage.manifest_path),
        created_at=manifest.get("created_at") or "",
        updated_at=manifest.get("updated_at") or "",
        owner=user if user else None,
        created_by=user if user else None,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
    )
    if user and not existing_project and not project.get("owner_user_id"):
        repository.assign_project_owner(safe_project_id, int(user["id"]))


def _normalize_storyboard_output(text: str) -> str:
    output = text.strip()
    if not output.startswith("phase=StoryBoard"):
        phase_index = output.find("phase=StoryBoard")
        if phase_index >= 0:
            output = output[phase_index:].strip()
        else:
            output = f"phase=StoryBoard\n{output}"
    return output


def _build_storyboard_rewrite_messages(payload: Dict) -> list:
    content_options = payload.get("content_options") if isinstance(payload.get("content_options"), dict) else {}
    content_mode = content_options.get("mode")
    style_prompt = build_knowledge_style_prompt(content_options) if content_mode == "history_knowledge" else ""
    system_rules = [
        "# 角色",
        "你是短视频分镜脚本修订助手。你需要根据用户的修改方向，对现有 StoryBoard 做定向修订。",
        "",
        "# 修订要求",
        "- 必须返回完整的新分镜脚本，而不是解释、摘要或差异说明。",
        "- 必须保留 phase=StoryBoard 前缀。",
        "- 必须保持分镜编号连续。",
        "- 每个分镜必须包含：角色、画面、中文台词、英文台词。",
        "- 除非用户明确要求增删分镜，否则尽量保持原分镜数量。",
        "- 尽量保留用户未要求修改的内容，只按修改方向调整画面、台词、节奏或风格。",
        "- 分镜数量不超过%d个。" % MAX_STORY_BOARD_NUMBER,
    ]
    if content_mode == "history_knowledge":
        system_rules.extend([
            "",
            "# 历史/知识类要求",
            "- 保持客观、中立、清晰的知识讲解语气，不要改成儿童故事。",
            "- 角色字段表示画面中实际出现的视觉人物或视觉主体，不表示旁白说话人。",
            "- 如果用户要求减少人物特写或增强背景信息，应在画面描述中体现地图、文献、建筑、时间线、会议、空间纵深等知识视觉元素。",
            "- 中文台词和英文台词都要同步修改，保持准确、简洁、克制。",
        ])
    if style_prompt:
        system_rules.extend(["", style_prompt])

    user_content = "\n\n".join([
        "# 原始文案",
        _clean_text(payload.get("script")).strip() or "未提供",
        "# 当前分镜脚本",
        _clean_text(payload.get("storyboards")).strip(),
        "# 用户修改方向",
        _clean_text(payload.get("instruction")).strip(),
        "# 输出要求",
        "只输出修改后的完整 StoryBoard 文本，不要输出解释。",
    ])
    return [
        ArkMessage(role="system", content="\n".join(system_rules)),
        ArkMessage(role="user", content=user_content),
    ]


async def rewrite_storyboards(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json payload")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid json payload")

    storyboards = _clean_text(payload.get("storyboards")).strip()
    instruction = _clean_text(payload.get("instruction")).strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="instruction is required")
    if len(instruction) > STORYBOARD_REWRITE_MAX_INSTRUCTION_LENGTH:
        raise HTTPException(status_code=400, detail="instruction is too long")

    _validate_storyboard_text(storyboards)
    messages = _build_storyboard_rewrite_messages({
        **payload,
        "storyboards": storyboards,
        "instruction": instruction,
    })

    completion = ""
    content_options = payload.get("content_options") if isinstance(payload.get("content_options"), dict) else {}
    project_id = get_project_id_from_content_options(content_options)
    current_user = _current_admin_user_from_fastapi_request(request)
    org_context = _org_context_from_fastapi_request(request, current_user, content_options)
    _ensure_project_owner(
        project_id,
        current_user,
        org_context.get("tenant_id") or "",
        org_context.get("workspace_id") or "",
    )
    context_token = set_billing_context({
        "tenant_id": org_context.get("tenant_id"),
        "workspace_id": org_context.get("workspace_id"),
        "user_id": current_user.get("id"),
        "username": current_user.get("username") or "",
        "project_id": project_id,
        "task_id": f"{project_id}:storyboard_rewrite" if project_id else "",
        "phase": "storyboard_rewrite",
    })
    client = LLMClient(LLM_ENDPOINT_ID)
    try:
        async for chunk in client.chat_generation(messages):
            if not chunk.choices:
                continue
            completion += chunk.choices[0].delta.content or ""
    except Exception as exc:
        LOGGER.exception("failed to rewrite storyboard script")
        raise HTTPException(status_code=502, detail=f"failed to rewrite storyboards: {exc}")
    finally:
        reset_billing_context(context_token)

    if not completion.strip():
        raise HTTPException(status_code=502, detail="empty rewrite response")

    rewritten = _normalize_storyboard_output(completion)
    try:
        _validate_storyboard_text(rewritten)
    except HTTPException as exc:
        raise HTTPException(status_code=502, detail=f"invalid rewrite response: {exc.detail}")
    return {
        "storyboards": rewritten,
        "char_count": len(rewritten),
        "warnings": [],
    }


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
    content_options = PhaseFinder(request).get_content_options()
    project_id = get_project_id_from_content_options(content_options)
    current_user = _current_admin_user_from_chat_request(request)
    org_context = _org_context_from_chat_request(request, current_user, content_options)
    _ensure_project_owner(
        project_id,
        current_user,
        org_context.get("tenant_id") or "",
        org_context.get("workspace_id") or "",
    )
    tracked_phase = PHASE_TASK_MAP.get(phase.value)
    task = None
    if tracked_phase:
        task = task_tracker.ensure_task(
            project_id,
            tracked_phase,
            task_type="generation_phase",
            status="running",
            progress=0,
            input_summary=(last_user_message.content or "")[:500] if isinstance(last_user_message.content, str) else "",
            creator=current_user,
            metadata={
                "phase": phase.value,
                "mode": mode.value,
                "content_mode": content_options.get("mode", ""),
                "tenant_id": org_context.get("tenant_id"),
                "workspace_id": org_context.get("workspace_id"),
            },
        )

    context_token = set_billing_context({
        "tenant_id": org_context.get("tenant_id"),
        "workspace_id": org_context.get("workspace_id"),
        "user_id": current_user.get("id"),
        "username": current_user.get("username") or "",
        "project_id": project_id,
        "task_id": task.get("task_id") if task else "",
        "phase": tracked_phase or phase.value,
    })
    try:
        async for chunk in generator.generate():
            yield chunk
    except Exception as exc:
        if tracked_phase:
            task_tracker.fail_task(project_id, tracked_phase, str(exc), creator=current_user)
        raise
    else:
        if tracked_phase:
            task_tracker.finish_task(project_id, tracked_phase, "succeeded", creator=current_user)
    finally:
        reset_billing_context(context_token)


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


async def get_project_manifest(request: Request, project_id: str):
    _ensure_project_owner(project_id, _current_admin_user_from_fastapi_request(request))
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

    current_user = _current_admin_user_from_fastapi_request(request)
    _ensure_project_owner(project_id, current_user)
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
        current_user = _current_admin_user_from_fastapi_request(request)
        _ensure_project_owner(project_id, current_user)
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
        if project_id:
            task_tracker.attach_asset(
                project_id,
                "storyboard_videos",
                local_asset,
                creator=_current_admin_user_from_fastapi_request(request),
            )
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
        "/v1/storyboards/rewrite",
        rewrite_storyboards,
        methods=["POST", "OPTIONS"],
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
    register_admin_routes(server.app)
    server.run(app=server.app, port=int(port) if port else 8888)
