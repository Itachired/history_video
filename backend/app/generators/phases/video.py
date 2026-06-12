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
from typing import AsyncIterable, Tuple, List, Optional

import requests
import tos
from arkitect.core.component.llm.model import ArkChatRequest, ArkChatResponse, ArkChatCompletionChunk
from arkitect.utils.context import get_reqid, get_resource_id
from arkitect.core.errors import InvalidParameter
from volcenginesdkarkruntime.types.chat.chat_completion_chunk import ChoiceDelta, Choice, ChoiceDeltaToolCall, \
    ChoiceDeltaToolCallFunction
from volcenginesdkarkruntime import Ark

from app.clients.ark_console import ArkConsoleClient, CreateVideoGenTaskRequest, TosLocation, TosConfig
from app.clients.downloader import DownloaderClient
from app.clients.tos import TOSClient
from app.constants import ARTIFACT_TOS_BUCKET, MAX_STORY_BOARD_NUMBER, API_KEY, CGT_ENDPOINT_ID
from app.generators.base import Generator
from app.generators.phase import Phase, PhaseFinder
from app.generators.phases.knowledge_style import build_aspect_ratio_prompt, get_video_ratio_for_aspect_ratio
from app.logger import ERROR, INFO
from app.message_utils import extract_dict_from_message
from app.mode import Mode
from app.models.first_frame_image import FirstFrameImage
from app.models.video import Video
from app.models.video_description import VideoDescription
from app.services.asset_storage import AssetStorageService, get_project_id_from_content_options

VIDEO_TASK_SUBMIT_CONCURRENCY = 4
STORYBOARD_VIDEO_PHASE = "storyboard_videos"


def _merge_video_descriptions_and_first_frame_images(video_descriptions: List[VideoDescription],
                                                     first_frame_images: List[FirstFrameImage]) -> List[
    Tuple[int, VideoDescription, FirstFrameImage]]:
    video_descriptions_by_index = {i: s for i, s in enumerate(video_descriptions)}
    first_frame_images_by_index = {ffi.index: ffi for ffi in first_frame_images}

    # Merge dictionaries with the same index
    merged = []
    all_indices = set(video_descriptions_by_index.keys()) | set(first_frame_images_by_index.keys())

    for index in all_indices:
        if index not in video_descriptions_by_index:
            ERROR(f"failed to find index {index} in video_descriptions_by_index")
            raise InvalidParameter("messages", f"failed to find index {index} in videos")
        if index not in first_frame_images_by_index:
            ERROR(f"failed to find index {index} in first_frame_images_by_index")
            raise InvalidParameter("messages", f"failed to find index {index} in first_frame_images")

        merged.append((index, video_descriptions_by_index[index], first_frame_images_by_index[index]))

    return merged


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


class VideoGenerator(Generator):
    content_generation_client: Ark
    tos_client: TOSClient
    downloader_client: DownloaderClient
    phase_finder: PhaseFinder
    request: ArkChatRequest
    mode: Mode

    def __init__(self, request: ArkChatRequest, mode: Mode.NORMAL):
        super().__init__(request, mode)
        self.content_generation_client = Ark(api_key=API_KEY, region="cn-beijing")
        self.tos_client = TOSClient()
        self.downloader_client = DownloaderClient()
        self.phase_finder = PhaseFinder(request)
        self.request = request
        self.mode = mode

    async def generate(self) -> AsyncIterable[ArkChatResponse]:
        first_frame_images = self.phase_finder.get_first_frame_images()
        video_descriptions = self.phase_finder.get_video_descriptions()

        if not first_frame_images:
            ERROR("first frame images not found")
            raise InvalidParameter("messages", "first frame images not found")

        if not video_descriptions:
            ERROR("video descriptions not found")
            raise InvalidParameter("messages", "video descriptions not found")

        if len(first_frame_images) != len(video_descriptions):
            ERROR(
                f"first frame images or video description counts are incorrect, len(first_frame_images)={len(first_frame_images)}, len(video_descriptions)={len(video_descriptions)}")
            raise InvalidParameter("messages", "first frame images or video description counts are incorrect")

        if len(first_frame_images) > MAX_STORY_BOARD_NUMBER:
            ERROR("first frame image count exceed limit")
            raise InvalidParameter("messages", "first frame image count exceed limit")

        # handle case when some assets are already provided, only partial set of assets needs to be generated
        generated_videos: List[Video] = []
        force_regenerate_indexes = set()
        if self.mode == Mode.REGENERATION:
            dict_content = extract_dict_from_message(self.request.messages[-1].content)
            videos_json = dict_content.get("videos", [])
            for v in videos_json:
                video = Video.model_validate(v)
                if video.video_gen_task_id:
                    generated_videos.append(video)
                else:
                    force_regenerate_indexes.add(video.index)

        INFO(f"generated_videos: {generated_videos}")

        merged = _merge_video_descriptions_and_first_frame_images(video_descriptions, first_frame_images)
        content_options = self.phase_finder.get_content_options()
        project_id = get_project_id_from_content_options(content_options)
        storage = AssetStorageService(project_id)
        archive_url = f"/v1/assets/projects/{project_id}/archive/storyboard_videos"
        video_ratio = get_video_ratio_for_aspect_ratio(content_options)

        # Return first
        yield ArkChatCompletionChunk(
            id=get_reqid(),
            choices=[
                Choice(
                    index=0,
                    delta=ChoiceDelta(
                        content=f"phase={Phase.VIDEO.value}\n\n",
                    ),
                ),
            ],
            created=int(time.time()),
            model=get_resource_id(),
            object="chat.completion.chunk"
        )

        submit_semaphore = asyncio.Semaphore(VIDEO_TASK_SUBMIT_CONCURRENCY)
        tasks = []
        generated_video_indexes = set([v.index for v in generated_videos])
        for index, video_descriptions, first_frame_image in merged:
            if index in generated_video_indexes:
                continue

            existing_video = self._video_from_existing_asset(storage, index, archive_url)
            if existing_video and index not in force_regenerate_indexes:
                generated_videos.append(existing_video)
                generated_video_indexes.add(index)
                continue

            if index not in generated_video_indexes:
                tasks.append(asyncio.create_task(
                    self._process_image(
                        index,
                        video_descriptions.description,
                        first_frame_image.images[0],
                        content_options,
                        video_ratio,
                        submit_semaphore,
                        storage,
                        archive_url,
                    )
                ))

        pending = set(tasks)
        content = {
            "videos": [
                {
                    **video.model_dump(exclude={"video_data"}),
                    "download_url": video.download_url
                    or f"/v1/assets/projects/{project_id}/storyboard-videos/{video.index}/{video.video_gen_task_id}",
                    "archive_url": video.archive_url or archive_url,
                }
                for video in generated_videos
            ],
        }

        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)

            for task in done:
                video = task.result()
                content["videos"].append(video.model_dump())

        content["videos"] = sorted(content["videos"], key=lambda item: item.get("index", 0))

        yield _get_tool_resp(0, json.dumps(content))
        yield _get_tool_resp(1)

    def _create_video_task(self, video_prompt: str, image_url: str, video_ratio: str):
        return self.content_generation_client.content_generation.tasks.create(
            model=CGT_ENDPOINT_ID,
            content=[
                {
                    "type": "text",
                    "text": video_prompt,
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_url,
                    },
                },
            ],
            extra_body={
                "ratio": video_ratio,
            },
        )

    def _video_from_existing_asset(
            self,
            storage: AssetStorageService,
            index: int,
            archive_url: str,
    ) -> Optional[Video]:
        asset = storage.find_phase_asset(STORYBOARD_VIDEO_PHASE, index)
        if not asset:
            return None

        task_id = asset.get("video_gen_task_id") or asset.get("metadata", {}).get("video_gen_task_id")
        if not task_id:
            return None

        return Video(
            index=index,
            video_gen_task_id=task_id,
            local_assets=[asset],
            download_url=asset.get("download_url") or storage.local_download_url(asset.get("asset_id")),
            archive_url=archive_url,
        )

    def _build_video_safety_prompt(self, content_options: dict) -> str:
        if content_options.get("content_mode") != "history_knowledge":
            return ""
        return (
            "# 历史科普视频安全表达\n"
            "- 将起义、镇压、战争、武器、伤亡等内容转化为地图推进、时间线、文献翻页、远景人群剪影、会议厅、城市街景或符号化图解。\n"
            "- 不生成血腥、受伤、攻击、处决、尸体、近距离武器挥舞、恐怖表情或煽动性冲突画面。\n"
            "- 人群运动保持克制，可表现为远景聚集、缓慢移动、旗帜或文字标记变化，整体风格客观中立。"
        )

    async def _process_image(
            self,
            index: int,
            prompt: str,
            image_url: str,
            content_options: dict,
            video_ratio: str,
            submit_semaphore: asyncio.Semaphore,
            storage: AssetStorageService,
            archive_url: str,
    ) -> Video:
        try:
            video_prompt = (
                f"{prompt}\n"
                f"{build_aspect_ratio_prompt(content_options)}\n"
                f"{self._build_video_safety_prompt(content_options)}\n"
                f"视频必须保持输入首帧的 {video_ratio} 画幅，不要拉伸、裁切主体或改变画幅方向。"
            )
            async with submit_semaphore:
                resp = await asyncio.to_thread(
                    self._create_video_task,
                    video_prompt,
                    image_url,
                    video_ratio,
                )
            video_gen_task_id = resp.id
            asset = storage.register_video_task_asset(
                STORYBOARD_VIDEO_PHASE,
                index,
                video_gen_task_id,
                status="submitted",
                metadata={
                    "prompt": prompt,
                    "image_url": image_url,
                    "ratio": video_ratio,
                },
            )
            INFO(f"created video generation task, index={index}, ratio={video_ratio}, task_id={video_gen_task_id}")

        except Exception as e:
            ERROR(
                f"fail to generate video, err: {e}, prompt: {prompt}, image_url: {image_url}, "
                f"model: {CGT_ENDPOINT_ID}, ratio: {video_ratio}"
            )
            asset = storage.register_video_task_asset(
                STORYBOARD_VIDEO_PHASE,
                index,
                "failed to generate video",
                status="failed",
                message=str(e),
                metadata={
                    "prompt": prompt,
                    "image_url": image_url,
                    "ratio": video_ratio,
                },
            )
            return Video(
                index=index,
                video_gen_task_id="failed to generate video",
                local_assets=[asset],
                download_url=asset.get("download_url"),
                archive_url=archive_url,
            )

        return Video(
            index=index,
            video_gen_task_id=video_gen_task_id,
            local_assets=[asset],
            download_url=asset.get("download_url"),
            archive_url=archive_url,
        )
