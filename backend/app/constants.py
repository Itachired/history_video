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

import os
from pathlib import Path

from dotenv import load_dotenv

_constants_file = Path(__file__).resolve()
load_dotenv(_constants_file.parents[2] / ".env")
load_dotenv(_constants_file.parents[1] / ".env", override=True)


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name, "")
    if not value or value.startswith("<your-"):
        return default
    return value

REGION = "cn-beijing"
ARK_SERVICE_NAME = os.getenv("ARK_SERVICE_NAME", "ark_stg")
ARK_API_VERSION = "2024-01-01"
ARK_HOST = "open.volcengineapi.com"
ARK_ACCESS_KEY = os.getenv("TOS_ACCESSKEY")
ARK_SECRET_KEY = os.getenv("TOS_SECRETKEY")

ARTIFACT_TOS_BUCKET = os.getenv("TOS_BUCKET", "ark-bot-child-story-demo-stg")

FILM_INTERACTION_TIMEOUT_TIME_IN_SECONDS = 60

LLM_ENDPOINT_ID = os.getenv("LLM_ENDPOINT_ID", "")
VLM_ENDPOINT_ID = os.getenv("VLM_ENDPOINT_ID", "")
T2V_ENDPOINT_ID = os.getenv("T2V_ENDPOINT_ID", "")
CGT_ENDPOINT_ID = os.getenv("CGT_ENDPOINT_ID", "")

API_KEY = os.getenv("API_KEY", "")

TTS_NAMESPACE = _env("TTS_NAMESPACE", "BidirectionalTTS")
TTS_DEFAULT_SPEAKER = _env("TTS_SPEAKER", "zh_female_xiaohe_uranus_bigtts")
TTS_API_RESOURCE_ID = _env("TTS_API_RESOURCE_ID", "volc.service_type.10029")
TTS_APP_KEY = _env("TTS_APP_KEY") or _env("TTS_APP_ID")
TTS_ACCESS_KEY = _env("TTS_ACCESS_KEY") or _env("TTS_ACCESS_TOKEN")
TTS_BASE_URL = _env("TTS_BASE_URL", "wss://openspeech.bytedance.com/api/v3/tts/bidirection")
TTS_INT_SIZE = 4

ONE_DAY_IN_SECONDS = 60 * 60 * 24
IMAGE_SIZE_LIMIT = 10 * 1024 * 1024  # 10MB
MAX_STORY_BOARD_NUMBER = 15

DEFAULT_AUDIO_TONE = "zh_female_xiaohe_uranus_bigtts"
VALID_TONES = [
    "zh_female_xiaohe_uranus_bigtts",
    "zh_female_vv_uranus_bigtts",
    "zh_male_m191_uranus_bigtts",
    "zh_male_taocheng_uranus_bigtts",
    "en_female_dacey_uranus_bigtts",
    "en_male_tim_uranus_bigtts",
    "en_female_stokie_uranus_bigtts",
]
