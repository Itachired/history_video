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
from json import JSONDecodeError
from typing import Optional, List

from pydantic import BaseModel
from volcengine.visual.VisualService import VisualService
from volcenginesdkarkruntime import Ark

from app.constants import ARK_ACCESS_KEY, ARK_SECRET_KEY
from app.logger import INFO, ERROR

_DEFAULT_REQ_KEY = "high_aes_general_v20_L"
_DEFAULT_MODEL_VERSION = "general_v2.0_L"

POST_IMG_RISK_NOT_PASS_ERROR_CODE = 50511
POST_IMG_RISK_NOT_PASS_MESSAGE = "Post Img Risk Not Pass"
TEXT_RISK_NOT_PASS_ERROR_CODE = 50412
TEXT_RISK_NOT_PASS_MESSAGE = "Text Risk Not Pass"


class T2IException(Exception):
    def __init__(self, code, message):
        super().__init__(message)  # Pass the message to the base class
        self.code = code  # Additional attribute for error code
        self.message = message

    def __str__(self):
        return f"{self.args[0]} (Error Code: {self.code})"


class T2IClient:
    t2i_client: Ark

    def __init__(self, t2i_api_key: str) -> None:
        self.t2i_client = Ark(api_key=t2i_api_key, region="cn-beijing")

    def image_generation(self, prompt: str, model: str, reference_images: Optional[List[str]] = None) -> List[str]:
        """
        API Docs: https://www.volcengine.com/docs/82379/1541523
        """
        extra_body = None
        if reference_images:
            extra_body = {
                "image": reference_images,
            }

        images = self.t2i_client.images.generate(
            model=model,
            prompt=prompt,
            extra_body=extra_body,
        )
        return [item.url for item in images.data]


class LogoInfo(BaseModel):
    add_logo: Optional[bool] = None
    position: Optional[int] = None
    language: Optional[int] = None
    opacity: Optional[float] = None


class T2ICreateTextToImageRequest(BaseModel):
    req_key: str
    prompt: str
    model_version: str
    seed: Optional[int] = None
    scale: Optional[float] = None
    ddim_steps: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    use_rephraser: Optional[bool] = None
    use_sr: Optional[bool] = None
    sr_seed: Optional[int] = None
    double_sr_strength: Optional[bool] = None
    double_sr_scale: Optional[float] = None
    i32_sr_steps: Optional[int] = None
    is_only_sr: Optional[bool] = None
    return_url: Optional[bool] = None
    logo_info: Optional[LogoInfo] = None


class T2ICreateTextToImageResponse(BaseModel):
    binary_data_base64: Optional[List[str]]
    image_urls: Optional[List[str]]
