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

import re
from typing import List

from app.models.first_frame_description import FirstFrameDescription
from app.models.role_description import RoleDescription
from app.models.story_board import StoryBoard
from app.models.tone import Tone
from app.models.video_description import VideoDescription


def parse_storyboards(completions: str) -> List[StoryBoard]:
    characters = re.findall(r"角色[：:](.*)", completions)
    scenes = re.findall(r"画面[：:](.*)", completions)
    lines = re.findall(r"中文台词[：:](.*)", completions)
    lines_en = re.findall(r"英文台词[：:](.*)", completions)

    story_boards = []
    for c, s, l, le in zip(characters, scenes, lines, lines_en):
        story_boards.append(
            StoryBoard(
                characters=c.split("，") if "，" in c else [c],
                scene=s,
                lines=l,
                lines_en=le
            )
        )
    return story_boards


def parse_role_description(completions: str) -> List[RoleDescription]:
    descriptions = re.findall(r"角色描述[：:](.*)", completions)
    role_descriptions = [RoleDescription(description=d) for d in descriptions]
    return role_descriptions


def parse_first_frame_description(completions: str) -> List[FirstFrameDescription]:
    descriptions = re.findall(r"首帧描述[：:](.*)", completions)
    characters = re.findall(r"角色[：:](.*)", completions)
    first_frame_descriptions = [FirstFrameDescription(
        description=d,
        characters=c.split("，") if "，" in c else [c],
    ) for d, c in zip(descriptions, characters)]
    return first_frame_descriptions


def parse_video_description(completions: str) -> List[VideoDescription]:
    descriptions = re.findall(r"描述[：:](.*)", completions)
    characters = re.findall(r"角色[：:](.*)", completions)
    video_descriptions = [VideoDescription(
        description=d,
        characters=c.split("，") if "，" in c else [c],
    ) for d, c in zip(descriptions, characters)]
    return video_descriptions


def parse_tone(completions: str) -> List[Tone]:
    lines = re.findall(r"中文台词[：:](.*)", completions)
    lines_en = re.findall(r"英文台词[：:](.*)", completions)
    tones_text = re.findall(r"音色[：:](.*)", completions)

    tones = []
    for i, (l, le, t) in enumerate(zip(lines, lines_en, tones_text)):
        tones.append(
            Tone(
                index=i,
                line=l,
                line_en=le,
                tone=t,
            )
        )
    return tones
