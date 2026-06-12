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

from typing import AsyncIterable

from arkitect.core.component.llm.model import ArkChatRequest, ArkChatResponse, ArkMessage

from app.clients.llm import LLMClient
from app.constants import LLM_ENDPOINT_ID
from app.generators.base import Generator
from app.generators.phase import Phase, PhaseFinder
from app.generators.phases.common import get_correction_completion_chunk
from app.generators.phases.knowledge_style import build_knowledge_style_prompt
from app.mode import Mode

ROLE_DESCRIPTION_SYSTEM_PROMPT = ArkMessage(
    role="system",
    content="""# 角色
你是一个故事视频自动生成器的其中一个步骤，你的任务是根据对话记录中最新的Phase为Script和StoryBoard提供的故事内容，分镜设计，生成与之对应的角色描述。
用户可能会要求你生成视频，此时你应该生成角色描述，后续会有其他模型基于你生成的角色描述来生成对应的内容。

# 要求
- 整体风格为卡通风格插图，充满幼儿可爱风格，且采用3D渲染效果。
- 每个角色的描述需简洁明了，不超过30个字，包含面部特征等必要细节。
- 每个角色都需要描述角色的具体服饰细节信息和地点。
- 角色数量：1-4。
- [重要] 如果用户提示词内容没问题，在正常返回结果前加上"phase=RoleDescription"的前缀。

# 相关限制
- 不能出现少儿不宜、擦边、违禁、色情的词汇。
- 不能回复与小朋友有接触的语句。
- 不能询问家庭住址等敏感信息。
- 不需要为返回结果添加phase=xxx的前缀

# 输出按照以下格式回答（角色数量介于1-4之间，如果只有1个角色，只需要写角色1即可。）：
phase=RoleDescription
角色1：
角色：小熊
角色描述：小熊，圆头圆脑，小黑鼻。服饰：蓝色小帽与黄色星图棕背心（森林）
角色2：
角色：小狐狸
角色描述：小狐狸，尖脸尖耳，细长眼。服饰：绣金纹红披风（森林）
角色3：
角色：小鸟
角色描述：小鸟，小巧玲珑，圆眼珠。服饰：白色小肚兜（树枝上）
"""
)

HISTORY_KNOWLEDGE_ROLE_DESCRIPTION_SYSTEM_PROMPT = ArkMessage(
    role="system",
    content="""# 角色
你是历史/知识类短视频角色与视觉主体设定师。你的任务是根据 Script 和 StoryBoard，生成后续画面生成可使用的视觉主体描述。

# 要求
- 整体风格为历史知识类动画插画，3D 渲染，克制、清晰、适合短视频讲解。
- 视觉主体设定应服务于知识讲解，避免低龄儿童故事化表达。
- 可以将历史人物、群体、地点、制度、文献、建筑、地图、旁白等作为视觉主体。
- 只为贯穿多段分镜、需要保持一致外观的核心人物或视觉主体生成独立角色；一次性出现的次要人物、群体、地点、文献、建筑、地图，优先写入分镜画面，不要拆成独立角色。
- 每个主体描述需简洁明了，不超过40个字，包含身份、外观、服饰或典型视觉元素。
- 对战争、暴力、处决、死亡等内容只做概括表达，不描述血腥细节。
- 角色数量：1-4。除非用户明确要求，否则不要超过4个角色或视觉主体。
- [重要] 如果用户提示词内容没问题，在正常返回结果前加上"phase=RoleDescription"的前缀。

# 输出按照以下格式回答：
phase=RoleDescription
角色1：
角色：旁白
角色描述：中性旁白形象，简洁现代服装。服饰：深色上衣（知识讲解场景）
角色2：
角色：历史人物
角色描述：历史人物形象，时代服饰，神情克制。服饰：符合时代背景的外套（历史场景）
角色3：
角色：核心群体
角色描述：代表性群体形象，姿态克制。服饰：符合时代背景的群体服装（历史场景）
"""
)


def _select_role_description_prompt(phase_finder: PhaseFinder) -> ArkMessage:
    content_mode = phase_finder.get_content_mode()
    if content_mode == "history_knowledge":
        return ArkMessage(
            role="system",
            content=f"{HISTORY_KNOWLEDGE_ROLE_DESCRIPTION_SYSTEM_PROMPT.content}\n\n"
                    f"{build_knowledge_style_prompt(phase_finder.get_content_options())}"
        )
    return ROLE_DESCRIPTION_SYSTEM_PROMPT


class RoleDescriptionGenerator(Generator):
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
            yield get_correction_completion_chunk(self.request.messages[-1], Phase.ROLE_DESCRIPTION)
        else:
            _, script_message = self.phase_finder.get_phase_message(Phase.SCRIPT)
            _, storyboard_message = self.phase_finder.get_phase_message(Phase.STORY_BOARD)
            messages = [
                _select_role_description_prompt(self.phase_finder),
                script_message,
                storyboard_message,
                self.request.messages[-1],
            ]

            async for resp in self.llm_client.chat_generation(messages):
                yield resp
