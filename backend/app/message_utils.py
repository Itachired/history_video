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
from typing import List, Dict, Any

from arkitect.core.component.llm.model import ArkMessage
from arkitect.core.errors import InvalidParameter

from app.logger import ERROR


def get_last_message(messages: List[ArkMessage], role: str):
    for message in reversed(messages):
        if message.role == role:
            return message
    return None


def extract_dict_from_message(text: str) -> Dict[str, Any]:
    try:
        json_start_index = text.find("{")
        if json_start_index == -1:
            raise InvalidParameter("messages", "invalid json text in message")
        json_part = text[json_start_index:]
        parsed_json = json.loads(json_part)

        return parsed_json
    except json.JSONDecodeError:
        ERROR(f"unable to extract json, message: {text}")
        raise InvalidParameter("messages", "unable to extract json in message")
    except Exception as e:
        ERROR(f"unable to extract json, message: {text}, error: {e}")
        raise InvalidParameter("messages", "unable to extract json in message")
