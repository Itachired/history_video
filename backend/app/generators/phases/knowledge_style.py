from typing import Any, Dict, List


DEFAULT_KNOWLEDGE_STYLE = "documentary"
DEFAULT_ASPECT_RATIO = "16:9"
DEFAULT_BACKGROUND_REFERENCE_SCOPE = "role_and_scene"
DEFAULT_BACKGROUND_REFERENCE_STRENGTH = "strict"
STYLE_PROMPT_MAX_LENGTH = 500

BACKGROUND_REFERENCE_SCENE_ONLY = "scene_only"
BACKGROUND_REFERENCE_ROLE_AND_SCENE = "role_and_scene"
BACKGROUND_REFERENCE_NORMAL = "normal"
BACKGROUND_REFERENCE_STRONG = "strong"
BACKGROUND_REFERENCE_STRICT = "strict"

ASPECT_RATIOS = {
    "16:9",
    "9:16",
}

ASPECT_RATIO_IMAGE_SIZES = {
    "16:9": "2560x1440",
    "9:16": "1440x2560",
}

ASPECT_RATIO_PROMPTS = {
    "16:9": "画面比例：16:9 横屏构图，适合纪录片、课堂讲解、地图和时间线展示。主体与信息元素应横向展开，不要生成竖屏或方图。",
    "9:16": "画面比例：9:16 竖屏构图，适合短视频平台。主体应清晰居中，上下保留信息层级，不要生成横屏或方图。",
}

BACKGROUND_REFERENCE_SCOPES = {
    BACKGROUND_REFERENCE_SCENE_ONLY,
    BACKGROUND_REFERENCE_ROLE_AND_SCENE,
}

BACKGROUND_REFERENCE_STRENGTHS = {
    BACKGROUND_REFERENCE_NORMAL,
    BACKGROUND_REFERENCE_STRONG,
    BACKGROUND_REFERENCE_STRICT,
}

KNOWLEDGE_STYLE_PROMPTS = {
    "documentary": """视觉风格：纪录片式半写实知识动画。
- 画面低饱和、克制、时代感明确，优先使用地图、文献档案、历史建筑、会议场景、人群剪影、时代服饰人物。
- 镜头语言平稳，避免夸张表演。
- 禁止儿童绘本、Q版、大头小身、玩具质感、糖果色、动物拟人、童话化、低龄可爱风。""",
    "classroom_diagram": """视觉风格：课堂图解式知识动画。
- 优先使用时间线、结构图、箭头、关键词标签、黑板或白板、简洁地图和分层图示。
- 画面清楚、解释性强，减少复杂人物表演。
- 禁止儿童绘本、Q版、大头小身、玩具质感、糖果色、动物拟人、童话化。""",
    "museum_exhibit": """视觉风格：博物馆展陈式历史科普。
- 优先使用展厅、展柜、档案、手稿、旧报纸、说明牌、历史照片感构图、柔和展陈灯光。
- 画面沉稳、质感真实、信息有层次。
- 禁止儿童绘本、Q版、大头小身、玩具质感、糖果色、动物拟人、童话化。""",
    "infographic": """视觉风格：信息图短视频。
- 优先使用标题卡、地图标记、时间轴、阶段编号、图标、数据对比、简洁扁平图形。
- 画面节奏清晰、现代、适合短视频平台。
- 禁止儿童绘本、Q版、大头小身、玩具质感、糖果色、动物拟人、童话化。""",
}


def _normalize_text(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return text.strip()[:STYLE_PROMPT_MAX_LENGTH]


def get_aspect_ratio(content_options: Dict[str, Any]) -> str:
    aspect_ratio = content_options.get("aspect_ratio", DEFAULT_ASPECT_RATIO)
    if aspect_ratio in ASPECT_RATIOS:
        return aspect_ratio
    return DEFAULT_ASPECT_RATIO


def get_image_size_for_aspect_ratio(content_options: Dict[str, Any]) -> str:
    aspect_ratio = get_aspect_ratio(content_options)
    return ASPECT_RATIO_IMAGE_SIZES.get(aspect_ratio, ASPECT_RATIO_IMAGE_SIZES[DEFAULT_ASPECT_RATIO])


def get_video_ratio_for_aspect_ratio(content_options: Dict[str, Any]) -> str:
    return get_aspect_ratio(content_options)


def build_aspect_ratio_prompt(content_options: Dict[str, Any]) -> str:
    aspect_ratio = get_aspect_ratio(content_options)
    return "\n".join([
        "# 画面比例规则",
        f"- {ASPECT_RATIO_PROMPTS.get(aspect_ratio, ASPECT_RATIO_PROMPTS[DEFAULT_ASPECT_RATIO])}",
        f"- 最终图片和视频都必须保持 {aspect_ratio}，不要拉伸、裁切主体或改变画幅方向。",
    ])


def get_background_reference(content_options: Dict[str, Any]) -> Dict[str, Any]:
    background_reference = content_options.get("background_reference", {})
    if isinstance(background_reference, dict):
        return background_reference
    return {}


def get_background_reference_url(content_options: Dict[str, Any]) -> str:
    background_reference = get_background_reference(content_options)
    url = background_reference.get("url")
    return url if isinstance(url, str) else ""


def get_role_reference(content_options: Dict[str, Any]) -> Dict[str, Any]:
    role_reference = content_options.get("role_reference", {})
    if isinstance(role_reference, dict):
        return role_reference
    return {}


def get_role_reference_url(content_options: Dict[str, Any]) -> str:
    role_reference = get_role_reference(content_options)
    url = role_reference.get("url")
    return url if isinstance(url, str) else ""


def get_user_reference_image_urls(content_options: Dict[str, Any]) -> List[str]:
    reference_images: List[str] = []

    def append_reference_image(url: str):
        if url and url not in reference_images:
            reference_images.append(url)

    append_reference_image(get_role_reference_url(content_options))
    append_reference_image(get_background_reference_url(content_options))
    return reference_images


def get_background_reference_scope(content_options: Dict[str, Any]) -> str:
    scope = content_options.get("background_reference_scope", DEFAULT_BACKGROUND_REFERENCE_SCOPE)
    if scope in BACKGROUND_REFERENCE_SCOPES:
        return scope
    return DEFAULT_BACKGROUND_REFERENCE_SCOPE


def get_background_reference_strength(content_options: Dict[str, Any]) -> str:
    strength = content_options.get("background_reference_strength", DEFAULT_BACKGROUND_REFERENCE_STRENGTH)
    if strength in BACKGROUND_REFERENCE_STRENGTHS:
        return strength
    return DEFAULT_BACKGROUND_REFERENCE_STRENGTH


def should_reference_background_for_role(content_options: Dict[str, Any]) -> bool:
    return bool(get_background_reference_url(content_options))


def should_place_background_reference_first(content_options: Dict[str, Any]) -> bool:
    return bool(get_background_reference_url(content_options)) and (
        get_background_reference_strength(content_options) == BACKGROUND_REFERENCE_STRICT
    )


def build_background_reference_rule_prompt(content_options: Dict[str, Any], target: str) -> str:
    background_url = get_background_reference_url(content_options)
    if not background_url:
        return ""

    strength = get_background_reference_strength(content_options)
    priority_rule = "背景参考图优先级高于用户补充风格和预设风格；如果要求冲突，以背景参考图为准。"
    shared_rule = (
        "严格继承背景参考图的整体视觉体系，包括构图倾向、色彩、光照、材质、空间层次、镜头质感和时代氛围。"
        "不要逐像素复制参考图，不要照搬无关文字、标识或人物，不要生成血腥暴力细节。"
    )

    if strength == BACKGROUND_REFERENCE_NORMAL:
        shared_rule = (
            "参考背景图的整体色调、材质、时代氛围和镜头质感，允许根据当前内容做较大画面变化。"
            "不要逐像素复制参考图，不要照搬无关文字、标识或人物，不要生成血腥暴力细节。"
        )
    elif strength == BACKGROUND_REFERENCE_STRONG:
        shared_rule = (
            "强参考背景图的整体视觉体系，包括色彩、光照、材质、空间层次、镜头质感和时代氛围。"
            "可以根据分镜内容改变构图和主体动作，但画面必须像同一套视觉设计。"
            "不要逐像素复制参考图，不要照搬无关文字、标识或人物，不要生成血腥暴力细节。"
        )

    target_rule = ""
    if target == "role":
        target_rule = (
            "角色或视觉主体必须像属于背景图世界中的人物或物件。"
            "即使用户只上传了背景参考图，也要把它作为角色图的画风、色彩、光照、材质、时代氛围和真实/半写实程度约束。"
            "不要把背景中的建筑、地图、文献、展柜或文字画到角色身体、脸部或服装上。"
        )
    elif target == "scene":
        target_rule = (
            "分镜首帧必须优先围绕背景参考图建立场景视觉，"
            "角色参考图只用于保持人物身份和外观一致。"
        )
    elif target == "description":
        target_rule = (
            "文字描述阶段就要继承背景图视觉体系，避免写成儿童绘本、Q版或童话化画面。"
        )

    return "\n".join([
        "# 背景参考图规则",
        f"- 背景参考图：{background_url}",
        "- 作用范围：同时约束角色图和分镜画面。",
        f"- 参考强度：{strength}",
        f"- {priority_rule}",
        f"- {shared_rule}",
        f"- {target_rule}",
    ])


def build_role_reference_rule_prompt(content_options: Dict[str, Any]) -> str:
    role_url = get_role_reference_url(content_options)
    if not role_url:
        return ""

    return "\n".join([
        "# 角色参考图规则",
        f"- 角色参考图：{role_url}",
        "- 角色参考图优先用于角色外观、服饰轮廓、人物比例、材质和整体人物质感。",
        "- 生成角色或视觉主体时必须明显参考角色参考图，但不要逐像素复制，不要照搬无关文字、标识或背景。",
        "- 如果角色参考图与背景参考图冲突：角色外观以角色参考图为准，色调、光照、时代氛围以背景参考图为准。",
    ])


def build_user_reference_images_rule_prompt(content_options: Dict[str, Any], target: str) -> str:
    reference_images = get_user_reference_image_urls(content_options)
    if not reference_images:
        return ""

    reference_lines = [f"{index + 1}. {url}" for index, url in enumerate(reference_images)]
    if target == "role":
        target_rule = (
            "生成角色或视觉主体时，必须把所有用户上传参考图作为同一套视觉约束。"
            "如果只上传了背景参考图，也要严格继承其画风、色彩、光照、材质、镜头质感、时代氛围和真实/半写实程度，"
            "让角色像属于该背景图世界中的人物或物件。"
            "不要把背景中的建筑、地图、展柜、文字或无关人物复制到角色身上。"
        )
    elif target == "scene":
        target_rule = (
            "生成分镜画面时，必须把所有用户上传参考图作为同一套视觉约束。"
            "如果只上传了角色参考图，也要让场景的画风、色调、光照、材质和镜头质感与角色参考图匹配；"
            "如果只上传了背景参考图，则分镜必须明显属于背景图同一套视觉设计。"
        )
    else:
        target_rule = (
            "文字描述阶段就要继承用户上传参考图的整体视觉体系，后续角色图和分镜图都必须保持同一视觉风格。"
        )

    return "\n".join([
        "# 用户上传参考图统一规则",
        "- 用户上传的任意参考图都同时约束角色图和分镜画面，不因上传入口不同而只作用于单一阶段。",
        "- 参考图优先级高于预设风格和用户补充风格；如果要求冲突，以用户上传参考图为准。",
        "- 严格参考参考图的整体视觉体系，包括画风、色彩、光照、材质、空间层次、镜头质感、时代氛围和真实/半写实程度。",
        "- 不要逐像素复制参考图，不要照搬无关文字、标识或人物，不要生成血腥暴力细节。",
        "- 参考图列表：",
        *[f"  - {line}" for line in reference_lines],
        f"- {target_rule}",
    ])


def build_knowledge_style_prompt(content_options: Dict[str, Any]) -> str:
    style = content_options.get("style", DEFAULT_KNOWLEDGE_STYLE)
    style_prompt = _normalize_text(content_options.get("style_prompt", ""))
    style_text = KNOWLEDGE_STYLE_PROMPTS.get(style, KNOWLEDGE_STYLE_PROMPTS[DEFAULT_KNOWLEDGE_STYLE])

    prompt_parts = [
        "# 历史/知识类视觉风格",
        style_text,
    ]

    if style_prompt:
        prompt_parts.extend([
            "",
            "# 用户补充风格要求",
            f"- {style_prompt}",
            "- 用户补充风格只用于视觉表现，不得改变历史知识类视频定位和安全表达要求。",
            "- 如果用户补充风格与背景参考图冲突，以背景参考图为准。",
        ])

    user_reference_rule = build_user_reference_images_rule_prompt(content_options, "description")
    if user_reference_rule:
        prompt_parts.extend(["", user_reference_rule])

    background_rule = build_background_reference_rule_prompt(content_options, "description")
    if background_rule:
        prompt_parts.extend(["", background_rule])

    role_rule = build_role_reference_rule_prompt(content_options)
    if role_rule:
        prompt_parts.extend(["", role_rule])

    return "\n".join(prompt_parts)
