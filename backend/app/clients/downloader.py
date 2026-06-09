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

import io
from typing import Tuple

import requests
from arkitect.core.errors import InvalidParameter

from app.logger import INFO, ERROR, WARN


def _get_image_extension_from_response(response):
    # Extract Content-Type header
    content_type = response.headers.get('Content-Type')

    if content_type:
        # Map MIME type to file extension
        extension_map = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/tiff': 'tiff',
            # Add more mappings if needed
        }
        return extension_map.get(content_type, None)
    return None


class DownloaderClient:
    def __init__(self):
        self.chunk_size = 1024
        self.max_file_size = 20 * 1024 * 1024  # 20 MB

    def download_to_memory(self, url: str) -> Tuple[io.BytesIO, str]:
        response = requests.get(url, stream=True)
        response.raise_for_status()

        file_extension = _get_image_extension_from_response(response)
        if file_extension is None:
            WARN("file extension is not determined")

        file_buffer = io.BytesIO()
        total_size = 0

        for chunk in response.iter_content(chunk_size=self.chunk_size):
            if chunk:
                total_size += len(chunk)
                if total_size > self.max_file_size:
                    ERROR("file size exceeds 20 MB. Download stopped.")
                    raise InvalidParameter("messages", "image file size exceed limit")
                file_buffer.write(chunk)

        file_buffer.seek(0)
        INFO(f"downloaded file to memory, size: {total_size / (1024 * 1024):.2f} MB")
        return file_buffer, file_extension
