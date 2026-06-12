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
from app.generators.phases.knowledge_style import (
    build_aspect_ratio_prompt,
    build_background_reference_rule_prompt,
    build_knowledge_style_prompt,
    build_role_reference_rule_prompt,
    build_user_reference_images_rule_prompt,
    get_background_reference_url,
    get_image_size_for_aspect_ratio,
    get_role_reference_url,
    get_user_reference_image_urls,
)
from app.generators.phases.image_generation_limiter import run_limited_image_generation
from app.logger import ERROR, INFO
from app.message_utils import extract_dict_from_message
from app.mode import Mode
from app.models.role_description import RoleDescription
from app.models.role_image import RoleImage
from app.output_parsers import parse_role_description
from app.services.asset_storage import AssetStorageService, get_project_id_from_content_options


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

    def __init__(self, request: ArkChatRequest, mode: Mode.NORMAL):
        super().__init__(request, mode)

        t2i_api_key = API_KEY
        if request.metadata:
            t2i_api_key = request.metadata.get("t2i_api_key", API_KEY)
        self.t2i_client = T2IClient(t2i_api_key)
        self.phase_finder = PhaseFinder(request)
        self.request = request
        self.mode = mode

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
        content_options = self.phase_finder.get_content_options()
        project_id = get_project_id_from_content_options(content_options)
        archive_url = f"/v1/assets/projects/{project_id}/archive/role_images"
        role_reference_images = get_user_reference_image_urls(content_options)
        role_reference_image = get_role_reference_url(content_options)
        background_reference_image = get_background_reference_url(content_options)
        for index, rd in enumerate(role_descriptions):
            if index not in generated_role_image_indexes:
                INFO(
                    f"role image index={index}, "
                    f"background_reference_strength={self.phase_finder.get_background_reference_strength()}, "
                    f"background_reference_used={bool(background_reference_image)}, "
                    f"role_reference_used={bool(role_reference_image)}, "
                    f"reference_images_count={len(role_reference_images)}"
                )
                tasks.append(asyncio.create_task(
                    self._generate_image(index, role_descriptions, content_options, role_reference_images)
                ))

        pending = set(tasks)
        content = {
            "role_images": [
                {**role_image.model_dump(), "archive_url": role_image.archive_url or archive_url}
                for role_image in generated_role_images
            ],
        }

        try:
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)

                for task in done:
                    role_image_index, role_images, local_assets = task.result()
                    content["role_images"].append(RoleImage(
                        index=role_image_index,
                        images=role_images,
                        reference_image=role_images[0] if role_images else None,
                        local_assets=local_assets,
                        archive_url=archive_url,
                        locked=True,
                    ).model_dump())
        except asyncio.CancelledError:
            INFO(f"role image generation canceled, cancel pending tasks count={len(pending)}")
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            raise

        yield _get_tool_resp(0, json.dumps(content))
        yield _get_tool_resp(1)

    async def _generate_image(
            self,
            index: int,
            role_descriptions: List[RoleDescription],
            content_options: dict,
            reference_images: List[str],
    ):
        started_at = time.perf_counter()
        local_assets = []
        try:
            if self.phase_finder.get_content_mode() == "history_knowledge":
                prompt = (
                    f"{build_knowledge_style_prompt(content_options)}\n"
                    f"{build_aspect_ratio_prompt(content_options)}\n"
                    f"{build_user_reference_images_rule_prompt(content_options, 'role')}\n"
                    f"{build_background_reference_rule_prompt(content_options, 'role')}\n"
                    f"{build_role_reference_rule_prompt(content_options)}\n"
                    f"视觉主体描述：{role_descriptions[index].description}\n"
                    "生成历史/知识类短视频使用的视觉主体图。"
                    "人物或主体应严格匹配参考图提供的人物质感、时代氛围、色调、光照、材质和镜头质感。"
                    "主体形象应半写实、克制、清晰，禁止Q版、大头小身、玩具质感、儿童绘本风。"
                )
            else:
                prompt = (
                    f"{build_aspect_ratio_prompt(content_options)}\n"
                    f"{role_descriptions[index].description}卡通风格插图，3D渲染。"
                )
            image_size = get_image_size_for_aspect_ratio(content_options)
            images = await run_limited_image_generation(
                self.t2i_client.image_generation,
                prompt=prompt,
                model=T2V_ENDPOINT_ID,
                reference_images=reference_images,
                size=image_size,
            )
            INFO(
                f"role image index={index} finished in {time.perf_counter() - started_at:.2f}s, "
                f"background_reference_strength={self.phase_finder.get_background_reference_strength()}, "
                f"background_reference_used={bool(reference_images)}, "
                f"reference_images_count={len(reference_images)}, "
                f"image_size={image_size}"
            )
            try:
                storage = AssetStorageService(get_project_id_from_content_options(content_options))
                local_assets = [
                    storage.store_url_asset(
                        "role_images",
                        index,
                        image_url,
                        f"role_{index + 1:02d}",
                        "png",
                        metadata={"role_description": role_descriptions[index].description},
                    )
                    for image_url in images
                ]
                local_assets = [asset for asset in local_assets if asset]
            except Exception as e:
                ERROR(f"failed to archive role image, index: {index}, error: {e}")
        except T2IException as e:
            ERROR(
                f"failed to generate image, index: {index}, code: {e.code}, message: {e}, "
                f"reference_images_count: {len(reference_images)}, elapsed: {time.perf_counter() - started_at:.2f}s"
            )
            return index, [e.message], []
        except Exception as e:
            ERROR(
                f"failed to generate image, index: {index}, error: {e}, "
                f"reference_images_count: {len(reference_images)}, elapsed: {time.perf_counter() - started_at:.2f}s"
            )
            return index, ["failed to generate image"], []

        return index, images, local_assets
