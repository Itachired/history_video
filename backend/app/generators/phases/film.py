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
import subprocess
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from typing import AsyncIterable, Optional, List, Tuple
from urllib.parse import urlparse

from arkitect.core.component.llm.model import ArkChatRequest, ArkChatResponse, ArkChatCompletionChunk
from arkitect.core.errors import InvalidParameter, InternalServiceError
from arkitect.utils.context import get_reqid, get_resource_id
from moviepy import TextClip, CompositeVideoClip, VideoFileClip, AudioFileClip
from moviepy.video.fx import CrossFadeIn, CrossFadeOut
from moviepy.video.tools.subtitles import SubtitlesClip
from volcenginesdkarkruntime import Ark
from volcenginesdkarkruntime.types.chat.chat_completion_chunk import Choice, ChoiceDelta, ChoiceDeltaToolCall, \
    ChoiceDeltaToolCallFunction

from app.clients.downloader import DownloaderClient
from app.clients.tos import TOSClient
from app.constants import ARTIFACT_TOS_BUCKET, MAX_STORY_BOARD_NUMBER, API_KEY
from app.generators.base import Generator
from app.generators.phase import PhaseFinder, Phase
from app.logger import ERROR, INFO
from app.mode import Mode
from app.models.audio import Audio
from app.models.film import Film
from app.models.tone import Tone
from app.models.video import Video
from app.services.asset_storage import AssetStorageService, get_project_id_from_content_options

_current_dir = os.path.dirname(os.path.abspath(__file__))
_font = os.path.join(_current_dir, "../../../media/DouyinSansBold.otf")

_FADE_IN_DURATION_IN_SECONDS = 0.5
_FADE_OUT_DURATION_IN_SECONDS = 0.5
VOICE_MODE_GENERATED = "generated"
VOICE_MODE_ORIGINAL = "original"


def _available_ffmpeg_encoders() -> str:
    try:
        return subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            check=False,
            text=True,
        ).stdout
    except Exception as e:
        ERROR(f"failed to inspect ffmpeg encoders, error: {e}")
        return ""


def _select_video_codec() -> Tuple[str, List[str]]:
    encoders = _available_ffmpeg_encoders()
    if "libx264" in encoders:
        return "libx264", ["-pix_fmt", "yuv420p"]
    if "h264_videotoolbox" in encoders:
        return "h264_videotoolbox", ["-pix_fmt", "yuv420p"]
    if "mpeg4" in encoders:
        return "mpeg4", ["-pix_fmt", "yuv420p"]
    return "libvpx", []


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


def _split_subtitle_en(input_string: str, max_length: int = 40):
    words = input_string.split()
    result = []
    current_part = []

    for word in words:
        if len(' '.join(current_part + [word])) <= max_length:
            current_part.append(word)
        else:
            result.append(' '.join(current_part))
            current_part = [word]

    if current_part:
        result.append(' '.join(current_part))

    return result


def _split_subtitle_cn(input_string: str, max_length: int = 40):
    result = []
    current_part = []

    for char in input_string:
        current_part.append(char)
        if len(current_part) == max_length:
            result.append(''.join(current_part))
            current_part = []

    if current_part:
        result.append(''.join(current_part))

    return result


def _split_subtitle(line: str, start_time: int, end_time: int, split_fn) -> List:
    total_length = len(line)
    lines = split_fn(line, 40)
    total_duration = end_time - start_time
    start = start_time
    subtitles = []
    for l in lines:
        end = start + total_duration * len(l) / total_length
        subtitles.append(((start, end), l))
        start = end
    return subtitles


def _generate_film(
    req_id: str,
    tones: List[Tone],
    videos: List[Video],
    audios: Optional[List[Audio]] = None,
    voice_mode: str = VOICE_MODE_GENERATED,
):
    tones.sort(key=lambda tone: tone.index)
    videos.sort(key=lambda video: video.index)
    if audios is None:
        audios = []
    audios.sort(key=lambda audio: audio.index)
    tones_by_index = {tone.index: tone for tone in tones}
    audios_by_index = {audio.index: audio for audio in audios}

    video_clips = []
    cn_subtitles = []
    en_subtitles = []

    clip_start_time = 0.0
    start = []
    for i, v in enumerate(videos):
        start.append(clip_start_time)

        with tempfile.NamedTemporaryFile(suffix=".mp4") as video_temp:
            video_temp.write(v.video_data)
            video_clip = VideoFileClip(video_temp.name)

        t = tones_by_index.get(v.index)
        if voice_mode == VOICE_MODE_GENERATED:
            a = audios_by_index[v.index]
            with tempfile.NamedTemporaryFile(suffix=".mp3") as audio_temp:
                audio_temp.write(a.audio_data)
                audio_clip = AudioFileClip(audio_temp.name)
                if audio_clip.duration > video_clip.duration:
                    audio_clip = audio_clip.subclipped(0, video_clip.duration)

            video_clip = video_clip.with_audio(audio_clip)

        # Add subtitles
        clip_end_time = clip_start_time + video_clip.duration
        # slice subtitles if the line cannot fit to one row
        if t and t.line:
            cn_subtitles.extend(_split_subtitle(t.line, clip_start_time, clip_end_time, _split_subtitle_cn))
        if t and t.line_en:
            en_subtitles.extend(_split_subtitle(t.line_en, clip_start_time, clip_end_time, _split_subtitle_en))

        # add cross-fade in or out to every clip
        if i != 0:
            video_clip = CrossFadeIn(duration=_FADE_IN_DURATION_IN_SECONDS).apply(video_clip)
        if i != len(videos) - 1:
            video_clip = CrossFadeOut(duration=_FADE_OUT_DURATION_IN_SECONDS).apply(video_clip)
            # to overlap 2 clips, end time must deduct with the fade out duration
            clip_end_time = clip_end_time - _FADE_OUT_DURATION_IN_SECONDS
        video_clips.append(video_clip)
        clip_start_time = clip_end_time

    # Concatenate all clips
    clips = []
    for index, (video_clip, start_time) in enumerate(zip(video_clips, start)):
        video_clip = video_clip.with_start(start_time).with_position("center")
        clips.append(video_clip)

    final_clips = clips
    if cn_subtitles:
        cn_generator = lambda text: TextClip(font=_font, text=text, font_size=24, color="white", stroke_color="#021526",
                                             horizontal_align="center", vertical_align="bottom", size=clips[0].size,
                                             margin=(None, -60, None, None))
        cn_subtitle_clip = SubtitlesClip(cn_subtitles, make_textclip=cn_generator)
        final_clips = final_clips + [cn_subtitle_clip]

    if en_subtitles:
        en_generator = lambda text: TextClip(font=_font, text=text, font_size=24, color="white", stroke_color="#021526",
                                             horizontal_align="center", vertical_align="bottom", size=clips[0].size,
                                             margin=(None, -30, None, None))
        en_subtitle_clip = SubtitlesClip(en_subtitles, make_textclip=en_generator)
        final_clips = final_clips + [en_subtitle_clip]

    final_video = CompositeVideoClip(final_clips)

    # # Add background music
    # background_music_path = os.path.join(_current_dir, "../../../lib/background_music.mp3")
    # background_music = AudioFileClip(background_music_path)
    # background_music = background_music.subclipped(0, final_video.duration)
    # background_music = background_music.with_effects([MultiplyVolume(0.5)])
    # final_audio = CompositeAudioClip([final_video.audio, background_music])
    # final_video = final_video.with_audio(final_audio)

    tos_client = TOSClient()

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_film_file_path = f"{tmp_dir}/{req_id}.mp4"
            video_codec, ffmpeg_params = _select_video_codec()
            INFO(f"writing final video with codec: {video_codec}")
            final_video.write_videofile(tmp_film_file_path, codec=video_codec, audio_codec="aac",
                                        temp_audiofile_path=f"{tmp_dir}/", ffmpeg_params=ffmpeg_params)
            INFO("generated final video")

            tos_bucket_name = ARTIFACT_TOS_BUCKET
            tos_object_key = f"{req_id}/{Phase.FILM.value}.mp4"
            tos_client.put_object_from_file(tos_bucket_name, tos_object_key, tmp_film_file_path)
            INFO("put final video to TOS")

    except Exception as e:
        ERROR(f"failed to generate film, error: {e}")
        raise InternalServiceError("failed to generate film")

    output = tos_client.pre_signed_url(tos_bucket_name, tos_object_key)
    film_presigned_url = output.signed_url

    return film_presigned_url


class FilmGenerator(Generator):
    phase_finder: PhaseFinder
    request: ArkChatRequest
    tos_client: TOSClient
    content_generation_client: Ark
    downloader_client: DownloaderClient
    mode: Mode

    def __init__(self, request: ArkChatRequest, mode: Mode.NORMAL):
        super().__init__(request, mode)
        self.tos_client = TOSClient()
        self.content_generation_client = Ark(api_key=API_KEY)
        self.downloader_client = DownloaderClient()
        self.phase_finder = PhaseFinder(request)
        self.request = request
        self.mode = mode

    async def generate(self) -> AsyncIterable[ArkChatResponse]:
        tones = self.phase_finder.get_tones()
        videos = self.phase_finder.get_videos()
        audios = self.phase_finder.get_audios()
        dict_content = self.phase_finder.get_dict_from_message()
        content_options = self.phase_finder.get_content_options()
        project_id = get_project_id_from_content_options(content_options)
        voice_options = dict_content.get("voice_options", {})
        voice_mode = voice_options.get("mode", VOICE_MODE_GENERATED)
        if voice_mode not in (VOICE_MODE_GENERATED, VOICE_MODE_ORIGINAL):
            voice_mode = VOICE_MODE_GENERATED

        if not videos:
            ERROR("videos not found")
            raise InvalidParameter("messages", "videos not found")

        if voice_mode == VOICE_MODE_GENERATED:
            if not tones:
                ERROR("tones not found")
                raise InvalidParameter("messages", "tones not found")

            if not audios:
                ERROR("audios not found")
                raise InvalidParameter("messages", "audios not found")

            tones, videos, audios = self._align_assets_by_video_index(tones, videos, audios)
        else:
            videos.sort(key=lambda video: video.index)

        if len(tones) > MAX_STORY_BOARD_NUMBER:
            ERROR(f"tones count: {len(tones)} exceed limit")
            raise InvalidParameter("messages", "tones count exceed limit")

        INFO(
            f"voice_mode = {voice_mode}, len(tones) = {len(tones)}, "
            f"len(videos) = {len(videos)}, len(audios) = {len(audios)}"
        )

        # Return first
        yield ArkChatCompletionChunk(
            id=get_reqid(),
            choices=[
                Choice(
                    index=0,
                    delta=ChoiceDelta(
                        content=f"phase={Phase.FILM.value}\n\n",
                    ),
                ),
            ],
            created=int(time.time()),
            model=get_resource_id(),
            object="chat.completion.chunk"
        )

        video_download_tasks = [asyncio.create_task(self._download_video(v)) for v in videos]
        audio_download_tasks = (
            [asyncio.create_task(self._download_audio(a)) for a in audios]
            if voice_mode == VOICE_MODE_GENERATED
            else []
        )
        tasks = video_download_tasks + audio_download_tasks
        await asyncio.gather(*tasks)

        storage = AssetStorageService(project_id)
        storyboard_video_assets = []
        for video in videos:
            if not video.video_data:
                continue
            try:
                asset = storage.store_bytes_asset(
                    "storyboard_videos",
                    video.index,
                    video.video_data,
                    f"shot_{video.index + 1:02d}.mp4",
                    source_url=video.video_url,
                    metadata={"video_gen_task_id": video.video_gen_task_id},
                )
                video.local_assets = [asset]
                video.download_url = asset.get("download_url")
                video.archive_url = f"/v1/assets/projects/{project_id}/archive/storyboard_videos"
                storyboard_video_assets.append(asset)
            except Exception as e:
                ERROR(f"failed to archive storyboard video, index: {video.index}, error: {e}")

        # generate film by movie py. since moviepy has potential memory leak problem, a new process is created to run
        # so that memory is automatically released after the process is terminated
        loop = asyncio.get_event_loop()
        film_presiend_url = await loop.run_in_executor(ProcessPoolExecutor(), _generate_film,
                                                       get_reqid(), tones, videos, audios, voice_mode)

        film_assets = []
        try:
            film_asset = storage.store_url_asset(
                "film",
                0,
                film_presiend_url,
                "final",
                "mp4",
                metadata={"voice_mode": voice_mode},
            )
            if film_asset:
                film_assets.append(film_asset)
        except Exception as e:
            ERROR(f"failed to archive final film, error: {e}")

        content = {
            "videos": [video.model_dump(exclude={"video_data"}) for video in videos],
            "film": Film(
                url=film_presiend_url,
                local_assets=film_assets,
                download_url=film_assets[0].get("download_url") if film_assets else None,
                archive_url=f"/v1/assets/projects/{project_id}/archive/film",
                all_assets_archive_url=f"/v1/assets/projects/{project_id}/archive-all",
            ).model_dump(),
        }
        yield _get_tool_resp(0, json.dumps(content))
        yield _get_tool_resp(1)

    async def _download_video(self, v: Video):
        video_gen_task = self.content_generation_client.content_generation.tasks.get(task_id=v.video_gen_task_id)
        if video_gen_task.status != "succeeded":
            ERROR(f"video is not ready, index: {v.index}")
            raise InvalidParameter("messages", "video is not ready")

        # https://ark-content-generation-cn-beijing-stg.tos-cn-beijing.volces.com/doubao-seedance-1-0-pro/
        # 02175266550778400000000000000000000ffffc0a8a6e75de67d.mp4?
        video_url = video_gen_task.content.video_url
        if video_url is None:
            ERROR(f"video_url is empty, index: {v.index}")
            raise InvalidParameter("messages", "video_url is empty")

        v.video_url = video_url
        video_data, _ = self.downloader_client.download_to_memory(video_url)
        v.video_data = video_data.read()
        INFO(f"downloaded video, index: {v.index}")

    async def _download_audio(self, a: Audio):
        if not a.url.startswith("http"):
            raise InvalidParameter("message", "invalid audio url")
        audio_data, _ = self.downloader_client.download_to_memory(a.url)
        a.audio_data = audio_data.read()
        INFO(f"downloaded audio, index: {a.index}")

    def _parse_tos_url(self, url: str) -> Tuple[str, str]:
        """
        解析 TOS 对象存储 URL，提取 bucket name 和 object key。

        示例：
        https://my-bucket.tos-ap-cn-beijing.volces.com/path/to/file.jpg?query=...
        → bucket: my-bucket
          object_key: path/to/file.jpg
        """
        parsed = urlparse(url)

        # 验证并解析 host
        suffix = ".tos-cn-beijing.volces.com"
        host = parsed.netloc
        if not host.endswith(suffix):
            raise ValueError(f"Invalid host: {host}, must end with {suffix}")
        bucket_name = host[: -len(suffix)]

        # 提取 object key（路径部分，去掉开头的 `/`）
        object_key = parsed.path.lstrip("/")

        return bucket_name, object_key

    def _align_assets_by_video_index(
        self,
        tones: List[Tone],
        videos: List[Video],
        audios: List[Audio],
    ) -> Tuple[List[Tone], List[Video], List[Audio]]:
        tones_by_index = {tone.index: tone for tone in tones}
        videos_by_index = {video.index: video for video in videos}
        audios_by_index = {audio.index: audio for audio in audios}

        video_indexes = sorted(videos_by_index.keys())
        missing_tone_indexes = [index for index in video_indexes if index not in tones_by_index]
        missing_audio_indexes = [index for index in video_indexes if index not in audios_by_index]

        if missing_tone_indexes or missing_audio_indexes:
            ERROR(
                f"film asset indexes do not match, video_indexes: {video_indexes}, "
                f"tone_indexes: {sorted(tones_by_index.keys())}, audio_indexes: {sorted(audios_by_index.keys())}, "
                f"missing_tones: {missing_tone_indexes}, missing_audios: {missing_audio_indexes}"
            )
            raise InvalidParameter("messages", "missing tones or audios for video indexes")

        extra_tone_indexes = sorted(set(tones_by_index.keys()) - set(video_indexes))
        extra_audio_indexes = sorted(set(audios_by_index.keys()) - set(video_indexes))
        if extra_tone_indexes or extra_audio_indexes:
            INFO(
                f"ignore extra film assets, extra_tones: {extra_tone_indexes}, "
                f"extra_audios: {extra_audio_indexes}, video_indexes: {video_indexes}"
            )

        return (
            [tones_by_index[index] for index in video_indexes],
            [videos_by_index[index] for index in video_indexes],
            [audios_by_index[index] for index in video_indexes],
        )
