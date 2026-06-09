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

from typing import List, Optional

from pydantic import BaseModel


class RoleImage(BaseModel):
    index: int
    images: List[str]
    reference_image: Optional[str] = None
    locked: Optional[bool] = True

    def get_reference_image(self) -> Optional[str]:
        if self.locked is False:
            return None
        if self.reference_image:
            return self.reference_image
        if self.images:
            return self.images[0]
        return None
