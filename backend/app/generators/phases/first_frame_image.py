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
from app.generators.phases.knowledge_style import (
    build_aspect_ratio_prompt,
    build_background_reference_rule_prompt,
    build_knowledge_style_prompt,
    build_user_reference_images_rule_prompt,
    get_background_reference_url,
    get_image_size_for_aspect_ratio,
    get_role_reference_url,
    should_place_background_reference_first,
)
from app.generators.phases.image_generation_limiter import run_limited_image_generation
from app.logger import ERROR, INFO
from app.message_utils import extract_dict_from_message
from app.mode import Mode
from app.models.first_frame_description import FirstFrameDescription
from app.models.first_frame_image import FirstFrameImage
from app.models.role_image import RoleImage
from app.services.asset_storage import AssetStorageService, get_project_id_from_content_options


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


def _get_visual_character_names(
        first_frame_description: FirstFrameDescription,
        role_reference_image_map: Dict[str, str],
) -> List[str]:
    visual_character_names = []

    def append_visual_character(name: str):
        normalized_name = _normalize_role_name(name)
        if not normalized_name or normalized_name == "旁白" or normalized_name in visual_character_names:
            return
        visual_character_names.append(normalized_name)

    for character in first_frame_description.characters:
        append_visual_character(character)

    normalized_description = _normalize_role_name(first_frame_description.description)
    for role_name in role_reference_image_map.keys():
        if role_name and role_name in normalized_description:
            append_visual_character(role_name)

    return visual_character_names


def _get_reference_images(
        first_frame_description: FirstFrameDescription,
        role_reference_image_map: Dict[str, str],
        background_reference_image: Optional[str] = None,
        uploaded_role_reference_image: Optional[str] = None,
        background_reference_first: bool = False,
) -> List[str]:
    reference_images = []

    def append_reference_image(image: Optional[str]):
        if image and image not in reference_images:
            reference_images.append(image)

    def append_role_reference_by_name(name: str):
        character_name = _normalize_role_name(name)
        if not character_name:
            return

        reference_image = role_reference_image_map.get(character_name)
        if not reference_image:
            for role_name, image in role_reference_image_map.items():
                if role_name in character_name or character_name in role_name:
                    reference_image = image
                    break
        append_reference_image(reference_image)

    if background_reference_first:
        append_reference_image(background_reference_image)

    append_reference_image(uploaded_role_reference_image)

    for character in _get_visual_character_names(first_frame_description, role_reference_image_map):
        append_role_reference_by_name(character)

    append_reference_image(background_reference_image)
    return reference_images


def _build_history_knowledge_image_prompt(
        first_frame_description: FirstFrameDescription,
        reference_images: List[str],
        has_background_reference: bool,
        content_options: Dict,
        visual_character_names: Optional[List[str]] = None,
) -> str:
    characters = "，".join(visual_character_names or [])
    reference_instruction = ""
    if reference_images:
        reference_instruction = (
            "参考图使用规则：用户上传的任意参考图和已生成角色图都必须共同约束分镜画面。"
            "角色图用于保持人物外观一致；用户上传参考图用于建立统一画风、色调、光照、材质、镜头质感、场景结构和时代氛围。"
            "角色参考图只决定人物外观、服饰和身份气质，不代表最终画面中人物的大小、位置或构图比例。"
            "不得逐像素复制参考图，不得照搬参考图中的无关文字或人物。"
        )
    if characters:
        reference_instruction += (
            f"当前分镜必须出现的视觉角色：{characters}。"
            "这些视觉角色必须以清晰可辨认的人物或主体形象出现在画面中，"
            "必须保持参考图中的脸型、五官、服饰颜色、头冠、体型比例和身份气质。"
            "不得用普通官员、群像人物、剪影或半透明符号替代这些已生成角色图中的人物。"
            "但除非分镜描述明确要求人物特写，角色不要占据画面主体，不要生成大头照、半身肖像或居中海报式人物。"
        )
    if has_background_reference:
        reference_instruction += (
            "当前分镜必须看起来属于背景图同一套视觉设计。"
            "背景参考图应主导整体构图、时代氛围、色调、空间纵深和场景信息。"
            "可以根据剧情改变镜头位置和主体动作，但不要让每个分镜机械复刻同一背景。"
        )
    reference_instruction += (
        "历史知识类分镜默认以背景、建筑、文献、地图、道具和空间关系承载信息。"
        "默认使用远景、中远景或中景；背景/场景/信息元素占画面约60%-80%，角色占画面约15%-35%。"
        "纯地图、文献、时间线或建筑说明画面中，角色可以不出现或只占0%-15%。"
        "角色应融入场景，可位于侧边、中景或远景位置，清晰但不压过背景与知识信息。"
    )

    return (
        f"{reference_instruction}"
        f"{build_knowledge_style_prompt(content_options)}\n"
        f"{build_aspect_ratio_prompt(content_options)}\n"
        f"{build_user_reference_images_rule_prompt(content_options, 'scene')}\n"
        f"{build_background_reference_rule_prompt(content_options, 'scene')}\n"
        f"分镜描述：{first_frame_description.description}\n"
        "生成历史/知识类短视频首帧画面，画面克制、清晰、信息明确。"
    )


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
        _, first_frame_descriptions = self.phase_finder.get_first_frame_descriptions()
        role_descriptions_text = self.phase_finder.get_role_descriptions()
        role_images = self.phase_finder.get_role_images()
        role_reference_image_map = _build_role_reference_image_map(
            _parse_role_names(role_descriptions_text),
            role_images,
        )
        content_mode = self.phase_finder.get_content_mode()
        content_options = self.phase_finder.get_content_options()
        background_reference_image = (
            get_background_reference_url(content_options)
            if content_mode == "history_knowledge"
            else None
        )
        uploaded_role_reference_image = (
            get_role_reference_url(content_options)
            if content_mode == "history_knowledge"
            else None
        )
        project_id = get_project_id_from_content_options(content_options)
        archive_url = f"/v1/assets/projects/{project_id}/archive/storyboard_images"
        background_reference_first = should_place_background_reference_first(content_options)

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
                visual_character_names = _get_visual_character_names(rd, role_reference_image_map)
                reference_images = _get_reference_images(
                    rd,
                    role_reference_image_map,
                    background_reference_image,
                    uploaded_role_reference_image,
                    background_reference_first,
                )
                INFO(
                    f"first frame image index={index}, "
                    f"background_reference_strength={self.phase_finder.get_background_reference_strength()}, "
                    f"background_reference_used={bool(background_reference_image)}, "
                    f"reference_images_count={len(reference_images)}"
                )
                tasks.append(asyncio.create_task(self._generate_image(
                    index,
                    rd,
                    reference_images,
                    content_options,
                    visual_character_names,
                )))

        pending = set(tasks)
        content = {
            "first_frame_images": [
                {**role_image.model_dump(), "archive_url": role_image.archive_url or archive_url}
                for role_image in generated_first_frame_images
            ],
        }

        try:
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)

                for task in done:
                    first_frame_image_index, first_frame_images, local_assets = task.result()
                    content["first_frame_images"].append(FirstFrameImage(
                        index=first_frame_image_index,
                        images=first_frame_images,
                        local_assets=local_assets,
                        archive_url=archive_url,
                    ).model_dump())
        except asyncio.CancelledError:
            INFO(f"first frame image generation canceled, cancel pending tasks count={len(pending)}")
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            raise

        yield _get_tool_resp(0, json.dumps(content))
        yield _get_tool_resp(1)

    async def _generate_image(
            self,
            index: int,
            first_frame_description: FirstFrameDescription,
            reference_images: List[str],
            content_options: Dict,
            visual_character_names: Optional[List[str]] = None,
    ):
        started_at = time.perf_counter()
        local_assets = []
        try:
            characters = "，".join(first_frame_description.characters)
            if self.phase_finder.get_content_mode() == "history_knowledge":
                prompt = _build_history_knowledge_image_prompt(
                    first_frame_description,
                    reference_images,
                    bool(self.phase_finder.get_background_reference().get("url")),
                    content_options,
                    visual_character_names,
                )
            else:
                reference_instruction = ""
                if reference_images:
                    reference_instruction = (
                        f"请严格参考输入参考图中的角色外观、脸型、毛发/发型、服饰、颜色、体型比例和整体画风。"
                        f"当前分镜出现角色：{characters}。"
                        f"不得改变角色身份，不得重新设计角色，不得新增未出现角色。"
                        f"只根据分镜描述调整姿势、表情、场景和构图。"
                    )
                prompt = (
                    f"{build_aspect_ratio_prompt(content_options)}\n"
                    f"{reference_instruction}"
                    f"分镜描述：{first_frame_description.description}"
                    f"卡通风格插图，幼儿可爱风格，3D渲染。"
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
                f"first frame image index={index} finished in {time.perf_counter() - started_at:.2f}s, "
                f"background_reference_strength={self.phase_finder.get_background_reference_strength()}, "
                f"background_reference_used={bool(get_background_reference_url(content_options))}, "
                f"reference_images_count={len(reference_images)}, "
                f"image_size={image_size}"
            )
            try:
                storage = AssetStorageService(get_project_id_from_content_options(content_options))
                local_assets = [
                    storage.store_url_asset(
                        "storyboard_images",
                        index,
                        image_url,
                        f"shot_{index + 1:02d}",
                        "png",
                        metadata={"first_frame_description": first_frame_description.description},
                    )
                    for image_url in images
                ]
                local_assets = [asset for asset in local_assets if asset]
            except Exception as e:
                ERROR(f"failed to archive first frame image, index: {index}, error: {e}")
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
