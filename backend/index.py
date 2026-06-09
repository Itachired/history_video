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
import logging
import os
import uuid
from io import BytesIO
from pathlib import Path
from typing import AsyncIterable, Union

from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env", override=True)

from app.clients.tos import TOSClient
from app.constants import ARTIFACT_TOS_BUCKET
from app.generators.factory import GeneratorFactory
from app.generators.phase import PhaseFinder, get_phase_from_message
from app.message_utils import get_last_message
from app.mode import Mode

from fastapi import HTTPException, Request
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
    server.run(app=server.app, port=int(port) if port else 8888)
