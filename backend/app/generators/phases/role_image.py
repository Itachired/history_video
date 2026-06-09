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

import asyncio
import json
import os
import time
from typing import AsyncIterable, List, Optional

from arkitect.core.component.llm.model import ArkChatRequest, ArkChatResponse, ArkChatCompletionChunk
from arkitect.utils.context import get_reqid, get_resource_id
from arkitect.core.errors import InvalidParameter
from volcenginesdkarkruntime.types.chat.chat_completion_chunk import ChoiceDelta, Choice, ChoiceDeltaToolCall, \
    ChoiceDeltaToolCallFunction

from app.clients.t2i import T2IClient, T2IException
from app.constants import MAX_STORY_BOARD_NUMBER, API_KEY, T2V_ENDPOINT_ID
from app.generators.base import Generator
from app.generators.phase import PhaseFinder, Phase
from app.logger import ERROR, INFO
from app.message_utils import extract_dict_from_message
from app.mode import Mode
from app.models.role_description import RoleDescription
from app.models.role_image import RoleImage
from app.output_parsers import parse_role_description


def _get_image_generation_concurrency() -> int:
    try:
        return max(1, int(os.getenv("IMAGE_GENERATION_CONCURRENCY", "3")))
    except ValueError:
        return 3


def _get_tool_resp(index: int, content: Optional[str] = None) -> ArkChatCompletionChunk:
    return ArkChatCompletionChunk(
        id=get_reqid(),
        choices=[Choice(
            index=index,
            finish_reason=None if content else "stop",
            delta=ChoiceDelta(
                role="tool",
                content=f"{content}\n\n" if content else "",
                tool_calls=[
                    ChoiceDeltaToolCall(
                        index=index,
                        id="tool_call_id",
                        function=ChoiceDeltaToolCallFunction(
                            name="",
                            arguments="",
                        ),
                        type="function",
                    )
                ]
            )
        )],
        created=int(time.time()),
        model=get_resource_id(),
        object="chat.completion.chunk"
    )


class RoleImageGenerator(Generator):
    t2i_client: T2IClient
    request: ArkChatRequest
    phase_finder: PhaseFinder
    mode: Mode
    image_generation_semaphore: asyncio.Semaphore

    def __init__(self, request: ArkChatRequest, mode: Mode.NORMAL):
        super().__init__(request, mode)

        t2i_api_key = API_KEY
        if request.metadata:
            t2i_api_key = request.metadata.get("t2i_api_key", API_KEY)
        self.t2i_client = T2IClient(t2i_api_key)
        self.phase_finder = PhaseFinder(request)
        self.request = request
        self.mode = mode
        self.image_generation_semaphore = asyncio.Semaphore(_get_image_generation_concurrency())

    async def generate(self) -> AsyncIterable[ArkChatResponse]:
        role_description_completion = self.phase_finder.get_role_descriptions()
        role_descriptions = parse_role_description(role_description_completion)

        if not role_descriptions:
            ERROR("role descriptions not found")
            raise InvalidParameter("messages", "role descriptions not found")

        if len(role_descriptions) > MAX_STORY_BOARD_NUMBER:
            ERROR("role description count exceed limit")
            raise InvalidParameter("messages", "role description count exceed limit")

        # handle case when some assets are already provided, only partial set of assets needs to be generated
        generated_role_images: List[RoleImage] = []
        if self.mode == Mode.REGENERATION:
            dict_content = extract_dict_from_message(self.request.messages[-1].content)
            role_images_json = dict_content.get("role_images", [])
            for ri in role_images_json:
                role_image = RoleImage.model_validate(ri)
                if role_image.images:
                    generated_role_images.append(role_image)

        INFO(f"generated_role_images: {generated_role_images}")

        # Return first
        yield ArkChatCompletionChunk(
            id=get_reqid(),
            choices=[
                Choice(
                    index=0,
                    delta=ChoiceDelta(
                        content=f"phase={Phase.ROLE_IMAGE.value}\n\n",
                    ),
                ),
            ],
            created=int(time.time()),
            model=get_resource_id(),
            object="chat.completion.chunk"
        )

        tasks = []
        generated_role_image_indexes = set([ri.index for ri in generated_role_images])
        for index, rd in enumerate(role_descriptions):
            if index not in generated_role_image_indexes:
                tasks.append(asyncio.create_task(self._generate_image(index, role_descriptions)))

        pending = set(tasks)
        content = {
            "role_images": [role_image.model_dump() for role_image in generated_role_images],
        }

        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)

            for task in done:
                role_image_index, role_images = task.result()
                content["role_images"].append(RoleImage(
                    index=role_image_index,
                    images=role_images,
                    reference_image=role_images[0] if role_images else None,
                    locked=True,
                ).model_dump())

        yield _get_tool_resp(0, json.dumps(content))
        yield _get_tool_resp(1)

    async def _generate_image(self, index: int, role_descriptions: List[RoleDescription]):
        started_at = time.perf_counter()
        try:
            prompt = f"{role_descriptions[index].description}卡通风格插图，3D渲染。"
            async with self.image_generation_semaphore:
                images = await asyncio.to_thread(
                    self.t2i_client.image_generation,
                    prompt=prompt,
                    model=T2V_ENDPOINT_ID,
                )
            INFO(f"role image index={index} finished in {time.perf_counter() - started_at:.2f}s")
        except T2IException as e:
            ERROR(f"failed to generate image, index: {index}, code: {e.code}, message: {e}, elapsed: {time.perf_counter() - started_at:.2f}s")
            return index, [e.message]
        except Exception as e:
            ERROR(f"failed to generate image, index: {index}, error: {e}, elapsed: {time.perf_counter() - started_at:.2f}s")
            return index, ["failed to generate image"]

        return index, images
