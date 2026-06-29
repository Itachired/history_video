# 历史/知识类视频生成工作台

本项目基于原 `Chat2Cartoon` 示例扩展为一个面向历史、科普和知识讲解内容的本地视频生成工作台。当前默认工作流是“历史/知识类视频”，同时保留“儿童睡前故事”模式，支持从主题生成文案或上传现成文案，再逐步生成分镜脚本、角色图、分镜画面、分镜视频、配音和最终成片。

项目同时支持浏览器开发模式和 Electron 桌面客户端。前端开发服务运行在 `http://localhost:8080`，后端默认运行在 `http://127.0.0.1:8889`，Electron 壳会复用这套前后端工作流。

## 主要功能

- 内容来源：支持直接输入主题生成文案，也支持上传现成 `.txt`、`.md`、`.text` 文案。
- 视频类型：支持“历史/知识类视频”和“儿童睡前故事”，默认选择历史/知识类视频。
- 科普视觉风格：内置 `纪录片半写实`、`课堂图解`、`博物馆展陈`、`信息图短视频` 四种风格，并在左侧栏提供预览图。
- 自定义风格提示词：可补充画面风格要求，例如“低饱和、纪录片感、使用地图和文献，不要 Q 版人物”。
- 背景参考图：用户上传参考图后，角色图和分镜图都会参考其画风、色彩、光照、时代氛围和镜头质感。
- 角色参考图：用户可额外上传角色参考图，用于约束人物外观、服饰和材质。
- 参考强度：支持普通、强、严格三档参考图约束，默认使用严格参考。
- 画面比例：支持 `16:9` 横屏和 `9:16` 竖屏，图片与分镜视频会沿用同一比例。
- 分镜脚本编辑：分镜脚本生成后可直接打开编辑弹窗修改，保存后同步更新工作流确认数据，并提示后续角色、画面和视频按需重新生成。
- 分镜英文台词：分镜脚本中的英文台词默认隐藏，可通过“英文台词”开关查看，不影响后续原始数据。
- 图片预览：角色图和分镜画面支持点击大图预览；分镜画面预览卡使用横向 `16:9` 大卡片，避免横图被压缩成正方形。
- 配音模式：可选择模型生成分镜配音，也可使用原音频并跳过 TTS 生成。
- 本地素材保存：角色图、分镜图、分镜视频和成片会保存到项目素材目录，并写入 manifest。
- 下载入口：故事角色、分镜画面、分镜视频和成片阶段均支持单个素材下载、阶段打包下载；成片阶段支持全部素材打包下载。
- 分镜视频同步：轮询方舟视频生成任务时会把成功产物同步保存到本地，避免前端进度和本地文件脱节。
- 桌面客户端：Electron 壳提供本地服务状态、后端重启、素材目录打开、日志目录打开和文件下载能力，浏览器前端仍可独立运行。

## 工作流

```text
准备阶段
  ├─ 选择内容来源：输入主题 / 上传文案
  ├─ 选择视频类型：历史/知识类视频 / 儿童睡前故事
  ├─ 选择科普风格和画面比例
  ├─ 可选：上传背景参考图、角色参考图
  └─ 可选：输入自定义风格提示词

生成阶段
  ├─ 文案
  ├─ 分镜脚本（可编辑确认）
  ├─ 故事角色
  ├─ 分镜画面
  ├─ 分镜视频
  ├─ 配音 / 原音频
  └─ 成片
```

## 使用示例

### 示例一：上传法国大革命文案并生成横屏科普视频

1. 在左侧栏“内容来源”选择“上传文案”。
2. 上传 `.md` 或 `.txt` 文案。
3. 视频类型保持默认“历史/知识类视频”。
4. 科普视频风格选择“纪录片半写实”。
5. 画面比例选择 `16:9`。
6. 上传一张时代氛围接近的背景参考图。
7. 在风格提示词中输入：

   ```text
   低饱和、纪录片感、参考历史地图、文献、街景和展陈材料，不要 Q 版人物，不要儿童绘本风。
   ```

8. 按工作流依次生成分镜脚本、角色、分镜画面、分镜视频、配音和成片。
9. 在对应阶段下载单个素材或阶段压缩包，成片阶段可下载全部素材包。

### 示例二：使用原音频，跳过模型配音

1. 正常完成文案、分镜、角色、分镜画面和分镜视频生成。
2. 在配音阶段选择“使用原音频”。
3. 工作流会跳过模型 TTS 配音生成，后续成片使用已有音频路径或已有音频数据。
4. 生成成片后下载最终视频和全部素材。

### 示例三：生成竖屏信息图短视频

1. 视频类型选择“历史/知识类视频”。
2. 科普视频风格选择“信息图短视频”。
3. 画面比例选择 `9:16`。
4. 风格提示词可输入：

   ```text
   适合竖屏短视频，标题区清晰，使用时间线、图标和地图元素，信息层级明确。
   ```

5. 继续生成后，角色图、分镜图和分镜视频都会使用竖屏比例。

## 素材存储

生成素材保存在仓库根目录下的 `assets/generated/{project_id}`。`project_id` 由前端在新项目开始时生成，并随工作流传给后端。

典型目录结构如下：

```text
assets/generated/{project_id}/
├── manifest.json
├── source/
├── role_images/
├── storyboard_images/
├── storyboard_videos/
├── film/
└── archives/
```

`manifest.json` 会记录每个素材的阶段、索引、文件名、本地相对路径、下载地址、状态和来源任务信息。分镜视频任务在方舟后台成功后，会通过同步逻辑下载到 `storyboard_videos/`，并更新 manifest。

> 注意：`assets/generated/*` 已被 `.gitignore` 忽略，避免把本地生成素材提交到 Git。需要保留素材时，请直接保留该目录或导出压缩包。

## 下载与素材接口

后端提供以下本地素材接口：

| 接口 | 说明 |
| --- | --- |
| `POST /v1/assets/upload-reference-image` | 上传背景参考图或角色参考图到 TOS，并返回可用于模型参考的 URL |
| `GET /v1/assets/projects/{project_id}/manifest` | 获取项目素材清单 |
| `GET /v1/assets/projects/{project_id}/files/{asset_id}` | 下载或预览单个本地素材 |
| `GET /v1/assets/projects/{project_id}/archive/{phase}` | 下载某个阶段的素材压缩包，支持 `role_images`、`storyboard_images`、`storyboard_videos`、`film` |
| `GET /v1/assets/projects/{project_id}/archive-all` | 下载全部可用素材压缩包 |
| `GET /v1/assets/projects/{project_id}/storyboard-videos/{index}/{task_id}` | 按任务 ID 取回并保存单个分镜视频 |
| `GET/POST /v1/assets/projects/{project_id}/storyboard-videos/sync` | 同步项目内所有分镜视频任务状态和本地文件 |
| `GET /v1/video-tasks/{task_id}?project_id={project_id}&index={index}` | 查询方舟视频任务；成功后会同步保存本地视频并返回本地播放地址 |
| `GET /v1/desktop/status` | Electron 和前端状态面板使用的本地后端状态接口 |

## 模型与服务

模型端点通过 `.env` 配置，不在代码中固定具体账号资源。当前工作流涉及：

- 语言模型：生成文案、分镜脚本、角色描述、首帧描述、视频描述、音色建议等。
- 图像生成模型：生成角色图和分镜首帧图，支持参考图和指定画幅。
- 视频生成模型：根据首帧图和视频提示词生成分镜视频。
- 语音合成服务：在“模型生成配音”模式下生成中文/英文配音片段。
- 视觉理解和语音识别：保留原项目“边看边聊”相关能力时使用。
- FFmpeg / MoviePy：合成最终成片。

常用环境变量：

```bash
API_KEY=
LLM_ENDPOINT_ID=
T2V_ENDPOINT_ID=
CGT_ENDPOINT_ID=
VLM_ENDPOINT_ID=
TOS_ACCESSKEY=
TOS_SECRETKEY=
TOS_BUCKET=
TTS_APP_KEY=
TTS_ACCESS_KEY=
TTS_API_RESOURCE_ID=volc.service_type.10029
TTS_BASE_URL=wss://openspeech.bytedance.com/api/v3/tts/bidirection
TTS_NAMESPACE=BidirectionalTTS
TTS_SPEAKER=zh_female_xiaohe_uranus_bigtts
IMAGE_GENERATION_CONCURRENCY=3
_FAAS_RUNTIME_PORT=8889
```

`IMAGE_GENERATION_CONCURRENCY` 用于限制角色图和分镜图的并发生成数量，避免一次性提交过多图片任务导致排队时间过长或前端等待异常。

## 本地启动

### 环境要求

- Python `>=3.9,<3.12`
- Poetry `1.6.1` 或兼容版本
- Node.js `>=16.18.1`
- pnpm
- 可用的火山方舟 API Key、模型端点、TOS 桶和语音合成配置

### 后端

```bash
cd backend
poetry install
_FAAS_RUNTIME_PORT=8889 poetry run python index.py
```

如果使用本机已有 Conda 环境，也可以用对应 Python 直接启动：

```bash
cd backend
_FAAS_RUNTIME_PORT=8889 /opt/anaconda3/envs/video-gen1/bin/python index.py
```

健康检查：

```bash
curl http://127.0.0.1:8889/v1/ping
```

### 前端

```bash
cd frontend
pnpm install
pnpm dev
```

访问：

```text
http://localhost:8080
```

### Electron 桌面客户端

开发阶段先保持后端和前端运行，再启动 Electron：

```bash
cd desktop
pnpm install
pnpm dev
```

默认情况下，Electron 加载 `http://localhost:8080`，连接 `http://127.0.0.1:8889`。如果后端没有运行，桌面壳会尝试启动 `backend/index.py`。

常用覆盖参数：

```bash
CHAT2CARTOON_RENDERER_URL=http://localhost:8080 pnpm dev
CHAT2CARTOON_BACKEND_PORT=8889 pnpm dev
CHAT2CARTOON_BACKEND_PYTHON=/opt/anaconda3/envs/video-gen1/bin/python pnpm dev
CHAT2CARTOON_ASSET_ROOT=/Users/me/Movies/chat2cartoon/generated pnpm dev
```

打包命令：

```bash
cd desktop
pnpm pack   # 生成未压缩应用目录，便于本机检查
pnpm dist   # 使用 electron-builder 生成分发包
```

> 当前桌面壳会打包前端构建产物和后端源码，但 Python 运行时/模型依赖的完整内置分发仍需后续完善。面向没有 Python 环境的 macOS/Windows 用户分发前，需要补齐 Python runtime、后端依赖和平台签名/公证流程。

## 目录结构

```text
.
├── README.md
├── .env.example
├── assets/
│   ├── generated/                 # 本地生成素材，默认不提交 Git
│   └── state_diagram.jpg
├── backend/
│   ├── index.py                   # 后端入口、素材接口、视频任务同步接口
│   ├── app/
│   │   ├── clients/               # LLM、T2I、TOS、TTS、VLM 等客户端
│   │   ├── generators/            # 工作流阶段生成逻辑
│   │   │   └── phases/
│   │   ├── models/                # 阶段数据模型
│   │   └── services/
│   │       └── asset_storage.py   # 本地素材存储、manifest、压缩包
│   ├── pyproject.toml
│   └── poetry.lock
├── desktop/
│   ├── package.json               # Electron 壳、打包配置
│   ├── src/main/index.cjs         # 主进程、后端启动、素材/日志打开、下载
│   └── src/preload/index.cjs      # 暴露给前端的 desktopAPI
├── frontend/
│   ├── src/module/VideoGenerator/ # 视频生成器 UI、状态和媒体卡片
│   ├── package.json
│   └── pnpm-lock.yaml
└── logs/                          # 本地运行日志，默认不提交 Git
```

## 清理中间文件

以下命令只清理缓存、构建产物和运行日志，不会删除 `assets/generated` 中的项目素材：

```bash
find . -name '.DS_Store' -delete
find backend -type d -name '__pycache__' -prune -exec rm -rf {} +
find backend -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
find backend -maxdepth 1 -type f -name 'trace_*.log' -delete
rm -rf frontend/dist
: > logs/backend-8889.log
: > logs/frontend-8080.log
```

如需清空生成素材，请先确认没有需要保留的项目，再手动处理 `assets/generated`。

## 开发备注

- 左侧栏中的文案、参考图和风格选择支持任意顺序设置；当角色图、分镜图、分镜视频或成片已经生成后，视觉相关配置会锁定，避免后续素材风格不一致。
- 上传的任意参考图都会同时影响角色图和分镜图；角色参考图会额外加强人物外观和服饰一致性。
- 历史/知识类分镜默认强调背景、建筑、文献、地图和空间信息，角色图用于保持人物一致性，不代表最终画面中人物必须占据主体比例。
- 分镜脚本编辑只更新当前脚本文本和确认数据，不会自动删除已生成素材；如果脚本内容变化较大，需要按需从角色、首帧描述、分镜画面或视频阶段重新生成。
- 分镜视频任务是异步任务，前端查询任务状态时会携带 `project_id` 和 `index`，后端成功取回视频后返回本地播放 URL。
- 视频文件接口对 `.mp4` 等格式使用 `inline` 响应头，支持浏览器内预览播放。
- Electron 相关能力通过可选的 `window.desktopAPI` 暴露，浏览器前端不会依赖 Electron API，因此 `frontend/pnpm dev` 仍可独立运行。
- `.gitignore` 已忽略 `.env`、日志、trace、Python 缓存、前端构建产物和本地生成素材。
