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
import re
import time
from typing import AsyncIterable, Dict, List, Optional

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
from app.models.first_frame_description import FirstFrameDescription
from app.models.first_frame_image import FirstFrameImage
from app.models.role_image import RoleImage


def _get_image_generation_concurrency() -> int:
    try:
        return max(1, int(os.getenv("IMAGE_GENERATION_CONCURRENCY", "3")))
    except ValueError:
        return 3


def _normalize_role_name(name: str) -> str:
    return name.strip().replace(" ", "")


def _parse_role_names(role_descriptions_text: str) -> List[str]:
    names = re.findall(r"角色[：:](.*)", role_descriptions_text)
    return [_normalize_role_name(name) for name in names if _normalize_role_name(name)]


def _build_role_reference_image_map(role_names: List[str], role_images: List[RoleImage]) -> Dict[str, str]:
    role_images_by_index = {role_image.index: role_image for role_image in role_images}
    role_reference_image_map: Dict[str, str] = {}

    for index, role_name in enumerate(role_names):
        role_image = role_images_by_index.get(index)
        if not role_image:
            continue
        reference_image = role_image.get_reference_image()
        if reference_image:
            role_reference_image_map[role_name] = reference_image

    return role_reference_image_map


def _get_reference_images(
        first_frame_description: FirstFrameDescription,
        role_reference_image_map: Dict[str, str]
) -> List[str]:
    reference_images = []
    for character in first_frame_description.characters:
        character_name = _normalize_role_name(character)
        reference_image = role_reference_image_map.get(character_name)
        if not reference_image:
            for role_name, image in role_reference_image_map.items():
                if role_name in character_name or character_name in role_name:
                    reference_image = image
                    break
        if reference_image and reference_image not in reference_images:
            reference_images.append(reference_image)
    return reference_images


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


class FirstFrameImageGenerator(Generator):
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
        _, first_frame_descriptions = self.phase_finder.get_first_frame_descriptions()
        role_descriptions_text = self.phase_finder.get_role_descriptions()
        role_images = self.phase_finder.get_role_images()
        role_reference_image_map = _build_role_reference_image_map(
            _parse_role_names(role_descriptions_text),
            role_images,
        )

        if not first_frame_descriptions:
            ERROR("first frame descriptions not found")
            raise InvalidParameter("messages", "first frame descriptions not found")

        if len(first_frame_descriptions) > MAX_STORY_BOARD_NUMBER:
            ERROR("first frame description count exceed limit")
            raise InvalidParameter("messages", "first frame description count exceed limit")

        # handle case when some assets are already provided, only partial set of assets needs to be generated
        generated_first_frame_images: List[FirstFrameImage] = []
        if self.mode == Mode.REGENERATION:
            dict_content = extract_dict_from_message(self.request.messages[-1].content)
            first_frame_images_json = dict_content.get("first_frame_images", [])
            for ri in first_frame_images_json:
                first_frame_image = FirstFrameImage.model_validate(ri)
                if first_frame_image.images:
                    generated_first_frame_images.append(first_frame_image)

        INFO(f"generated_first_frame_images: {generated_first_frame_images}")

        # Return first
        yield ArkChatCompletionChunk(
            id=get_reqid(),
            choices=[
                Choice(
                    index=0,
                    delta=ChoiceDelta(
                        content=f"phase={Phase.FIRST_FRAME_IMAGE.value}\n\n",
                    ),
                ),
            ],
            created=int(time.time()),
            model=get_resource_id(),
            object="chat.completion.chunk"
        )

        tasks = []
        generated_first_frame_image_indexes = set([ffi.index for ffi in generated_first_frame_images])
        for index, rd in enumerate(first_frame_descriptions):
            if index not in generated_first_frame_image_indexes:
                reference_images = _get_reference_images(rd, role_reference_image_map)
                INFO(f"first frame image index={index}, reference_images_count={len(reference_images)}")
                tasks.append(asyncio.create_task(self._generate_image(index, rd, reference_images)))

        pending = set(tasks)
        content = {
            "first_frame_images": [role_image.model_dump() for role_image in generated_first_frame_images],
        }

        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)

            for task in done:
                first_frame_image_index, first_frame_images = task.result()
                content["first_frame_images"].append(FirstFrameImage(
                    index=first_frame_image_index,
                    images=first_frame_images,
                ).model_dump())

        yield _get_tool_resp(0, json.dumps(content))
        yield _get_tool_resp(1)

    async def _generate_image(
            self,
            index: int,
            first_frame_description: FirstFrameDescription,
            reference_images: List[str],
    ):
        started_at = time.perf_counter()
        try:
            characters = "，".join(first_frame_description.characters)
            reference_instruction = ""
            if reference_images:
                reference_instruction = (
                    f"请严格参考输入参考图中的角色外观、脸型、毛发/发型、服饰、颜色、体型比例和整体画风。"
                    f"当前分镜出现角色：{characters}。"
                    f"不得改变角色身份，不得重新设计角色，不得新增未出现角色。"
                    f"只根据分镜描述调整姿势、表情、场景和构图。"
                )
            prompt = (
                f"{reference_instruction}"
                f"分镜描述：{first_frame_description.description}"
                f"卡通风格插图，幼儿可爱风格，3D渲染。"
            )
            async with self.image_generation_semaphore:
                images = await asyncio.to_thread(
                    self.t2i_client.image_generation,
                    prompt=prompt,
                    model=T2V_ENDPOINT_ID,
                    reference_images=reference_images,
                )
            INFO(
                f"first frame image index={index} finished in {time.perf_counter() - started_at:.2f}s, "
                f"reference_images_count={len(reference_images)}"
            )
        except T2IException as e:
            ERROR(
                f"failed to generate image, index: {index}, code: {e.code}, message: {e}, "
                f"reference_images_count: {len(reference_images)}, elapsed: {time.perf_counter() - started_at:.2f}s"
            )
            return index, [e.message]
        except Exception as e:
            ERROR(
                f"failed to generate image, index: {index}, error: {e}, "
                f"reference_images_count: {len(reference_images)}, elapsed: {time.perf_counter() - started_at:.2f}s"
            )
            return index, ["failed to generate image"]

        return index, images
