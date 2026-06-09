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
import base64
import time
from typing import AsyncIterable, List

from arkitect.core.component.llm.model import ArkChatRequest, ArkChatResponse, ArkChatCompletionChunk, ArkMessage, \
    ChatCompletionMessageImageUrlPart
from arkitect.core.component.tts import AsyncTTSClient, AudioParams, ConnectionParams, create_bot_audio_responses
from arkitect.core.component.tts.constants import EventTTSSentenceStart, EventTTSSentenceEnd, EventSessionFinished
from arkitect.telemetry.trace import task
from arkitect.utils.context import get_reqid,get_resource_id
from arkitect.core.errors import APITimeoutError, InternalServiceError, InvalidParameter
from volcenginesdkarkruntime.types.chat.chat_completion_chunk import Choice, ChoiceDelta
from websockets import ConnectionClosed

from app.clients.tts import TTSClient, TextRequest
from app.clients.tts import TTS_DEFAULT_SPEAKER
from app.clients.vlm import VLMClient
from app.constants import VLM_ENDPOINT_ID, FILM_INTERACTION_TIMEOUT_TIME_IN_SECONDS, IMAGE_SIZE_LIMIT, TTS_APP_KEY, \
    TTS_ACCESS_KEY
from app.generators.base import Generator
from app.generators.phase import Phase, PhaseFinder
from app.logger import INFO, ERROR
from app.message_utils import extract_dict_from_message
from app.mode import Mode

FILM_INTERACTION_SYSTEM_PROMPT = ArkMessage(
    role="system",
    content="""
# 角色
记住你是动画陪看专家，年轻男性，刘老师。你擅长理解口语化表达，当前和用户在针对正在观看的动画故事进行讨论。对话中，可以适当的忽略用户，“嗯”，“额”等非必要的口头禅。
你可以从过往的对话历史中phase=Script的消息中了解到故事内容、phase=StoryBoard的消息中了解到分镜的设计、phase=RoleDescription中了解到每个角色的描述信息。
请和用户进行故事讨论和问题解答。
# 性格特点
1. 充满活力，情绪始终保持活泼。
2. 热情开朗，积极与用户互动交流。
3. 富有耐心，认真解答用户的每一个问题。
# 人际关系
1. 与用户是友好的陪伴关系。
# 过往经历
1. 长期沉浸在各种动画世界中，积累了丰富的知识和经验。
2. 有丰富的和各个年龄段人交流的经验
# 经典台词or 口头禅
1. 这里我知道哦！
2. 快来和我一起探讨呀！
3. 你是不是也这样觉得呢？
# 相关限制
- 只能围绕动画相关内容和【画面】信息进行回答和交流。
- 不能出现少儿不宜、擦边、违禁、色情的词汇。
- 不能回复与用户有接触的语句。
- 不能询问家庭住址等敏感信息。
- 输出的文字要适合在口语化交流场景。
- 注意输出的文字会被直接转换成语音输出，不要添加内心旁白
- 遇见不懂或者不会的问题，不能直接回答不知道，可以尝试“我还要再想想”等话术，同时进行其他话题的引导
- 不需要为返回结果添加phase=xxx的前缀
""")


class FilmInteractionGenerator(Generator):
    vlm_client: VLMClient
    tts_client: AsyncTTSClient
    request: ArkChatRequest
    mode: Mode
    phase_finder: PhaseFinder

    def __init__(self, request: ArkChatRequest, mode: Mode.NORMAL):
        super().__init__(request, mode)
        self.vlm_client = VLMClient(VLM_ENDPOINT_ID)
        self.tts_client = AsyncTTSClient(
            access_key=TTS_ACCESS_KEY,
            app_key=TTS_APP_KEY,
            connection_params=ConnectionParams(
                audio_params=AudioParams(format="mp3", sample_rate=24000),
                speaker=TTS_DEFAULT_SPEAKER,
            ),
        )
        self.request = request
        self.phase_finder = PhaseFinder(request)
        self.mode = mode

    async def generate(self) -> AsyncIterable[ArkChatResponse]:
        for message in self.request.messages:
            if type(message.content) is list:
                for content in message.content:
                    if (type(content) is ChatCompletionMessageImageUrlPart and content.image_url and
                            len(content.image_url.url.encode('utf-8')) > IMAGE_SIZE_LIMIT):
                        raise InvalidParameter("messages", "image size exceeds limit")

        script = self.phase_finder.get_script()
        storyboards, _ = self.phase_finder.get_storyboards()
        role_descriptions = self.phase_finder.get_role_descriptions()

        if len(script) == 0:
            ERROR("script not found")
            raise InvalidParameter("script not found")

        if len(role_descriptions) == 0:
            ERROR("role descriptions not found")
            raise InvalidParameter("messages", "role descriptions not found")

        if len(storyboards) == 0:
            ERROR("storyboards not found")
            raise InvalidParameter("messages", "storyboards not found")

        user_message = self._get_user_message()

        messages = [
            FILM_INTERACTION_SYSTEM_PROMPT,
            ArkMessage(role="assistant", content=f"phase={Phase.SCRIPT.value}\n{script}"),
            ArkMessage(role="user", content="下一步"),
            ArkMessage(role="assistant", content=f"phase={Phase.STORY_BOARD.value}\n{storyboards}"),
            ArkMessage(role="user", content="下一步"),
            ArkMessage(role="assistant", content=f"phase={Phase.ROLE_DESCRIPTION.value}\n{role_descriptions}"),
            user_message,
        ]

        # send first stream
        yield ArkChatCompletionChunk(
            id=get_reqid(),
            choices=[
                Choice(
                    index=0,
                    delta=ChoiceDelta(
                        content=f"phase={Phase.FILM_INTERACTION.value}\n\n",
                    ),
                ),
            ],
            created=int(time.time()),
            model=get_resource_id(),
            object="chat.completion.chunk",
        )

        # wait for tts_client to initialise
        t = asyncio.create_task(self.tts_client.init())
        await t
        # call VLM client and connect the output stream to the tts_client as an input stream
        iterator = self.vlm_client.chat_generation(messages)
        # tts_stream_output = self.tts_client.tts(iterator)
        #
        # index = 1
        # async for resp in create_bot_audio_responses(
        #         tts_stream_output, ArkChatRequest(model=get_resource_id(), messages=[])
        # ):
        #     INFO(f"index={index}, yield transcript chunk: {resp.choices[0].message.audio.transcript}")
        #     INFO(f"index={index}, yield audio chunk: {resp.choices[0].message.audio.data}")
        #     yield ArkChatCompletionChunk(
        #         id=get_reqid(),
        #         choices=[
        #             Choice(
        #                 index=index,
        #                 delta=ChoiceDelta(
        #                     content=resp.choices[0].message.audio.transcript,
        #                     audio=resp.choices[0].message.audio.data,
        #                 ),
        #             ),
        #         ],
        #         created=int(time.time()),
        #         model=get_resource_id(),
        #         object="chat.completion.chunk",
        #     )
        #     index += 1
        # await self.tts_client.close()

        buffer = bytearray()
        index = 1
        async for tts_rsp in self.tts_client.tts(iterator):
            INFO(
                f"receive tts response: index={index} event={tts_rsp.event} transcript={tts_rsp.transcript} \
                audio len={len(tts_rsp.audio) if tts_rsp.audio else 0}"
            )
            if tts_rsp.event == EventTTSSentenceStart:
                yield ArkChatCompletionChunk(
                    id=get_reqid(),
                    choices=[
                        Choice(
                            index=index,
                            delta=ChoiceDelta(
                                content=tts_rsp.transcript,
                            ),
                        ),
                    ],
                    created=int(time.time()),
                    model=get_resource_id(),
                    object="chat.completion.chunk",
                )
                INFO(f"index={index} yield transcript chunk={tts_rsp.transcript}")
                index = index + 1
            elif tts_rsp.event == EventTTSSentenceEnd:
                audio=base64.b64encode(buffer).decode("utf-8")
                yield ArkChatCompletionChunk(
                    id=get_reqid(),
                    choices=[
                        Choice(
                            index=index,
                            delta=ChoiceDelta(
                                audio=audio,
                            ),
                        ),
                    ],
                    created=int(time.time()),
                    model=get_resource_id(),
                    object="chat.completion.chunk",
                )
                INFO(f"index={index} yield audio chunk={audio}, clear buffer")
                index = index + 1
                buffer.clear()
            elif tts_rsp.audio:
                buffer.extend(tts_rsp.audio)
                INFO(f"index={index} extend audio, audio len={len(tts_rsp.audio)}, buffer len={len(buffer)}")

            if tts_rsp.event == EventSessionFinished:
                await self.tts_client.close()
                break


    def _get_user_message(self) -> ArkMessage:
        user_message = self.request.messages[-1].model_copy()
        if type(user_message.content) is list:
            json_text_indexes = []
            for i, c in enumerate(user_message.content):
                if c.type == "text":
                    try:
                        extract_dict_from_message(c.text)
                    except Exception:
                        continue
                    json_text_indexes.append(i)
            for i in json_text_indexes:
                del user_message.content[i]
        return user_message
