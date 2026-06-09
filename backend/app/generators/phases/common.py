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

import time

from arkitect.core.component.llm.model import ArkChatCompletionChunk, ArkMessage
from arkitect.utils.context import get_reqid, get_resource_id
from volcenginesdkarkruntime.types.chat.chat_completion_chunk import Choice, ChoiceDelta

from app.generators.phase import Phase


def get_correction_completion_chunk(message: ArkMessage, phase: Phase) -> ArkChatCompletionChunk:
    prefix = "CORRECTION "
    content = message.content
    if type(message.content) is str and message.content.startswith(prefix):
        content = message.content[len(prefix):]

    return ArkChatCompletionChunk(
        id=get_reqid(),
        choices=[
            Choice(
                index=0,
                delta=ChoiceDelta(
                    content=f"phase={phase.value}\n\n{content}",
                ),
            ),
        ],
        created=int(time.time()),
        model=get_resource_id(),
        object="chat.completion.chunk"
    )
