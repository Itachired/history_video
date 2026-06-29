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

import uuid
from typing import Any, Dict, List, AsyncIterable

from arkitect.core.component.llm import BaseChatLanguageModel
from  arkitect.core.component.llm.model import ArkChatResponse,ArkChatParameters,ArkMessage
from arkitect.utils import AsyncTimedIterable

from app.admin.billing_context import get_billing_context
from app.admin.repository import now_iso, repository


class LLMClient:
    endpoint_id: str

    def __init__(self, endpoint_id: str):
        self.endpoint_id = endpoint_id

    def _as_dict(self, value: Any) -> Dict[str, Any]:
        if not value:
            return {}
        if isinstance(value, dict):
            return value
        if hasattr(value, "model_dump"):
            return value.model_dump(exclude_none=True)
        if hasattr(value, "dict"):
            return value.dict()
        return {
            key: getattr(value, key)
            for key in dir(value)
            if not key.startswith("_") and not callable(getattr(value, key, None))
        }

    def _usage_from_response(self, response: Any) -> Dict[str, Any]:
        usage = getattr(response, "usage", None)
        if not usage and isinstance(response, dict):
            usage = response.get("usage")
        usage_dict = self._as_dict(usage)
        debug_info = getattr(response, "debug_info", None)
        if not debug_info and isinstance(response, dict):
            debug_info = response.get("debug_info")
        debug_dict = self._as_dict(debug_info)
        if not usage_dict and debug_dict:
            usage_dict = debug_dict
        return usage_dict

    def _record_usage(self, usage: Dict[str, Any], started_at: str, finished_at: str, response: Any):
        prompt_tokens = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
        completion_tokens = usage.get("completion_tokens") or usage.get("output_tokens") or 0
        total_tokens = usage.get("total_tokens") or (int(prompt_tokens or 0) + int(completion_tokens or 0))
        if not total_tokens:
            return
        context = get_billing_context()
        response_meta = self._as_dict(getattr(response, "ResponseMetadata", None) or getattr(response, "response_metadata", None))
        request_id = (
            response_meta.get("RequestId")
            or response_meta.get("request_id")
            or getattr(response, "id", "")
            or ""
        )
        repository.record_token_usage({
            "event_id": f"usage:{uuid.uuid4().hex}",
            "tenant_id": context.get("tenant_id") or "",
            "workspace_id": context.get("workspace_id") or "",
            "user_id": context.get("user_id"),
            "username": context.get("username") or "",
            "project_id": context.get("project_id") or "",
            "task_id": context.get("task_id") or "",
            "phase": context.get("phase") or "",
            "provider": "volcengine",
            "model": getattr(response, "model", "") or self.endpoint_id,
            "endpoint_id": self.endpoint_id,
            "request_id": request_id,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cached_tokens": usage.get("cached_tokens") or usage.get("cached_prompt_tokens") or 0,
            "reasoning_tokens": usage.get("reasoning_tokens") or 0,
            "status": "succeeded",
            "raw_usage": usage,
            "raw_response_meta": response_meta,
            "started_at": started_at,
            "finished_at": finished_at,
        })

    async def _metered_stream(self, stream: AsyncIterable[ArkChatResponse]) -> AsyncIterable[ArkChatResponse]:
        started_at = now_iso()
        last_usage: Dict[str, Any] = {}
        last_response: Any = None
        try:
            async for response in stream:
                usage = self._usage_from_response(response)
                if usage:
                    last_usage = usage
                    last_response = response
                yield response
        finally:
            if last_usage:
                self._record_usage(last_usage, started_at, now_iso(), last_response)

    def chat_generation(self, messages: List[ArkMessage]) -> AsyncIterable[ArkChatResponse]:
        messages = list(filter(lambda m: m.role in ["system", "assistant", "user"], messages))

        llm_chat = BaseChatLanguageModel(
            endpoint_id=self.endpoint_id,
            messages=messages,
            parameters=ArkChatParameters(temperature=1.0, top_p=0.7),
        )

        return AsyncTimedIterable(self._metered_stream(llm_chat.astream(extra_body={
            "thinking": {
                "type": "disabled"
            }
        })), timeout=5)
