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

import json
import time
from typing import AsyncIterable

from arkitect.core.component.llm.model import ArkChatRequest, ArkChatResponse, ArkMessage, ArkChatCompletionChunk
from arkitect.utils.context import get_reqid, get_resource_id
from volcenginesdkarkruntime.types.chat.chat_completion_chunk import Choice, ChoiceDelta

from app.clients.llm import LLMClient
from app.constants import LLM_ENDPOINT_ID
from app.generators.base import Generator
from app.generators.phase import Phase, PhaseFinder
from app.generators.phases.common import get_correction_completion_chunk
from app.logger import INFO
from app.mode import Mode
from app.output_parsers import parse_tone

TONE_SYSTEM_PROMPT = ArkMessage(
    role="system",
    content="""
# 角色
你是音色选择专家，你将根据用户提供的角色信息，从给定的音色列表中为每个角色选择最合适的音色以及对应的情绪用于儿童故事分镜视频的配音。
# 性格特点
认真负责、专业细致。
# 人际关系
与用户进行交流合作。
# 过往经历
有丰富的音色选择经验，成功为许多儿童故事角色选择过合适的音色。
# 相关限制
1. 需根据角色性别、特点和场景进行合理选择，不能随意搭配。
2. 按照每个分镜输出该场景有台词的角色及其音色。
3. 同一个角色必须使用相同的音色。
4. 无需回答原因等其他额外描述
5. 音色只需输出音色ID
# 候选音色列表，请对提供的台词选择一个最适合的音色ID：
zh_female_xiaohe_uranus_bigtts        温柔女声，适合旁白、妈妈、儿童故事
zh_female_vv_uranus_bigtts        活泼女声，适合女孩、可爱角色
zh_male_m191_uranus_bigtts        稳重男声，适合旁白、爸爸、长者
zh_male_taocheng_uranus_bigtts        清朗男声，适合男孩、少年角色
en_female_dacey_uranus_bigtts        英文女声
en_male_tim_uranus_bigtts        英文男声
en_female_stokie_uranus_bigtts        英文活泼女声

# 示例输入
分镜1：
角色：小熊
画面：森林里，一只毛茸茸、耳朵小小的、眼睛黑亮黑亮的小熊戴着蓝色小帽子，穿着带有黄色星星图案的棕色背心，快乐地出发。
中文台词：“去找蜂蜜喽。”
英文台词："Go to find honey."

分镜2：
角色：小狐狸
画面：森林里，尖耳朵、眼神狡黠的小狐狸穿着红色披风（有金色花纹），悄悄盯着小熊。
中文台词：“那只小熊真傻。”
英文台词："That little bear is so silly."

分镜3：
角色：小熊
画面：小熊来到一棵大树下，看到树上的蜂窝，眼睛放光。
中文台词：“好多蜂蜜呀。”
英文台词："So much honey."

# 示例输出，请按照以下格式返回
分镜1：
中文台词：“去找蜂蜜喽。”
英文台词："Go to find honey."
音色：zh_male_taocheng_uranus_bigtts

分镜2：
中文台词：“那只小熊真傻。”
英文台词："That little bear is so silly."
音色：zh_female_vv_uranus_bigtts

分镜3：
中文台词：“好多蜂蜜呀。”
英文台词："So much honey."
音色：zh_male_taocheng_uranus_bigtts
"""
)

HISTORY_KNOWLEDGE_TONE_SYSTEM_PROMPT = ArkMessage(
    role="system",
    content="""
# 角色
你是历史/知识类短视频配音音色选择专家。你将根据用户提供的分镜台词，为每个分镜选择最适合的解说音色。

# 要求
1. 台词风格为客观、中立、清晰的知识解说。
2. 优先选择稳重、清朗、适合旁白的音色。
3. 按照每个分镜输出中文台词、英文台词及音色。
4. 无需回答原因等其他额外描述。
5. 音色只需输出音色ID。

# 候选音色列表：
zh_female_xiaohe_uranus_bigtts        温柔女声，适合旁白
zh_female_vv_uranus_bigtts        活泼女声
zh_male_m191_uranus_bigtts        稳重男声，适合旁白、历史讲解
zh_male_taocheng_uranus_bigtts        清朗男声，适合知识讲解
en_female_dacey_uranus_bigtts        英文女声
en_male_tim_uranus_bigtts        英文男声
en_female_stokie_uranus_bigtts        英文活泼女声

# 输出格式：
分镜1：
中文台词：“一句中文旁白。”
英文台词："An English narration."
音色：zh_male_m191_uranus_bigtts
"""
)


def _select_tone_prompt(content_mode: str) -> ArkMessage:
    if content_mode == "history_knowledge":
        return HISTORY_KNOWLEDGE_TONE_SYSTEM_PROMPT
    return TONE_SYSTEM_PROMPT


class ToneGenerator(Generator):
    llm_client: LLMClient
    request: ArkChatRequest
    mode: Mode
    phase_finder: PhaseFinder

    def __init__(self, request: ArkChatRequest, mode: Mode.NORMAL):
        super().__init__(request, mode)

        chat_endpoint_id = LLM_ENDPOINT_ID
        if request.metadata:
            chat_endpoint_id = request.metadata.get("chat_endpoint_id", LLM_ENDPOINT_ID)

        self.llm_client = LLMClient(chat_endpoint_id)
        self.request = request
        self.mode = mode
        self.phase_finder = PhaseFinder(request)

    async def generate(self) -> AsyncIterable[ArkChatResponse]:
        if self.mode == Mode.CORRECTION:
            yield get_correction_completion_chunk(self.request.messages[-1], Phase.TONE)
        else:
            storyboard, _ = self.phase_finder.get_storyboards()
            messages = [
                _select_tone_prompt(self.phase_finder.get_content_mode()),
                ArkMessage(role="user", content=storyboard),
            ]
            INFO(f"storyboard num: {len(storyboard)}")

            completion = ""
            async for chunk in self.llm_client.chat_generation(messages):
                if not chunk.choices:
                    continue
                completion += chunk.choices[0].delta.content

            tones = parse_tone(completion)
            tones_json = {
                "tones": [t.model_dump() for t in tones]
            }

            yield ArkChatCompletionChunk(
                id=get_reqid(),
                choices=[
                    Choice(
                        index=0,
                        delta=ChoiceDelta(
                            role="assistant",
                            content=f"phase={Phase.TONE.value}\n\n{json.dumps(tones_json)}",
                        ),
                    ),
                ],
                created=int(time.time()),
                model=get_resource_id(),
                object="chat.completion.chunk"
            )

            yield ArkChatCompletionChunk(
                id=get_reqid(),
                choices=[Choice(
                    index=1,
                    finish_reason="stop",
                    delta=ChoiceDelta(
                        role="assistant",
                        content="",
                    )
                )],
                created=int(time.time()),
                model=get_resource_id(),
                object="chat.completion.chunk"
            )
