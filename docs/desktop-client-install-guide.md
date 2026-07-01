# 历史知识视频生成器客户端安装与火山引擎配置指引

本文面向 macOS / Windows 客户端最终用户。客户端启动后会在本机运行视频生成工作流，用户需要使用自己的火山引擎账号、火山方舟模型接入点、TOS 对象存储和可选的豆包语音合成配置。

## 1. 安装客户端

### macOS

1. 下载 macOS 安装包，通常为 `.dmg`。
2. 打开 `.dmg`，把“历史知识视频生成器”拖到“应用程序”目录。
3. 第一次打开时，如果 macOS 提示“无法验证开发者”，可以在“系统设置 > 隐私与安全性”中允许打开，或右键应用图标选择“打开”。
4. 打开客户端后，首次使用会进入“配置火山引擎账号”页面。

### Windows

1. 下载 Windows 安装包，通常为 `.exe` 安装器或便携版压缩包。
2. 如果是安装器，双击安装；如果是便携版，解压后运行主程序。
3. 第一次打开时，如果 Windows SmartScreen 提示风险，请确认安装包来源后选择“仍要运行”。
4. 打开客户端后，首次使用会进入“配置火山引擎账号”页面。

### 用户是否需要安装 Python

正式分发版应内置后端运行时，普通用户不需要自己安装 Python、Node.js、pnpm 或 Poetry。  
如果客户端启动后提示“后端未响应”，请先把日志发给分发方排查，不要让普通用户临时安装开发环境。

## 2. 注册并登录火山引擎

1. 打开火山引擎控制台：[https://console.volcengine.com/](https://console.volcengine.com/)
2. 注册或登录账号。
3. 根据火山引擎要求完成实名认证、开通服务和余额/计费配置。
4. 本客户端至少需要开通：
   - 火山方舟：用于文案、分镜、图片和视频模型。
   - TOS 对象存储：用于上传参考图、中间素材和部分模型输入输出。
   - 豆包语音 / 语音合成：用于模型生成配音，可选；如果只使用原音频，可以稍后配置。

## 3. 客户端配置项总览

客户端首次启动时需要填写以下字段。

| 客户端字段 | 是否必填 | 火山服务 | 用途 |
| --- | --- | --- | --- |
| 火山方舟 API Key | 必填 | 火山方舟 | 调用语言、图片和视频模型 |
| 文案/分镜模型 Endpoint ID | 必填 | 火山方舟 | 生成文案、分镜脚本、角色描述、镜头提示词 |
| 图片生成模型 Endpoint ID | 必填 | 火山方舟 | 生成角色图和分镜首帧图 |
| 视频生成模型 Endpoint ID | 必填 | 火山方舟 | 根据首帧图和提示词生成分镜视频 |
| TOS Access Key | 必填 | 访问控制 / TOS | 上传、读取对象存储素材 |
| TOS Secret Key | 必填 | 访问控制 / TOS | 与 Access Key 配套使用 |
| TOS Bucket | 必填 | TOS | 保存参考图和生成素材的存储桶名称 |
| TTS Access Key | 可选 | 豆包语音 / 语音合成 | 生成配音 |
| TTS App Key | 可选 | 豆包语音 / 语音合成 | 生成配音 |
| 默认音色 | 可选 | 豆包语音 / 语音合成 | 配音默认 speaker / voice id |
| 本地素材目录 | 建议填写 | 本机目录 | 保存角色图、分镜图、分镜视频、成片和素材清单 |

## 4. 获取火山方舟 API Key

用途：填写客户端的“火山方舟 API Key”。

1. 打开火山方舟 API Key 页面：  
   [https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)
2. 如果没有 API Key，点击创建。
3. 复制 API Key，填入客户端“火山方舟 API Key”。

相关入口：

- 火山方舟控制台：[https://console.volcengine.com/ark/region:ark+cn-beijing/](https://console.volcengine.com/ark/region:ark+cn-beijing/)
- 火山方舟文档首页：[https://www.volcengine.com/docs/82379](https://www.volcengine.com/docs/82379)

注意：

- API Key 是敏感密钥，不要发给他人。
- 客户端会把配置保存在本机用户目录，不会提交到项目代码。

## 5. 创建文案/分镜模型 Endpoint ID

用途：填写客户端的“文案/分镜模型 Endpoint ID”。

建议模型类型：火山方舟中的文本生成 / 对话模型，例如豆包大语言模型系列。这个模型会承担文案扩写、分镜脚本、角色描述、镜头描述、配音建议等文字生成任务。

1. 打开火山方舟模型或接入点页面：
   - 模型广场 / 模型列表：  
     [https://console.volcengine.com/ark/region:ark+cn-beijing/model](https://console.volcengine.com/ark/region:ark+cn-beijing/model)
   - 推理接入点：  
     [https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint)
2. 选择一个支持文本对话的模型。
3. 按控制台指引创建或开通推理接入点。
4. 在接入点列表中复制 Endpoint ID。
5. 填入客户端“文案/分镜模型 Endpoint ID”。

校验方式：

- Endpoint ID 通常是一个接入点标识，不是模型展示名称。
- 如果填成模型名称或模型版本名，后端调用时可能报 `model not found`、`endpoint not found` 或鉴权错误。

## 6. 创建图片生成模型 Endpoint ID

用途：填写客户端的“图片生成模型 Endpoint ID”。

建议模型类型：火山方舟中的图片生成模型，例如 Seedream / 豆包图像生成类模型。这个模型会生成两类图片：

- 角色图片。
- 分镜首帧 / 分镜画面。

1. 打开火山方舟模型或接入点页面：
   - 模型广场 / 模型列表：  
     [https://console.volcengine.com/ark/region:ark+cn-beijing/model](https://console.volcengine.com/ark/region:ark+cn-beijing/model)
   - 推理接入点：  
     [https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint)
2. 选择支持图片生成的模型。
3. 创建或开通推理接入点。
4. 复制该图片生成接入点的 Endpoint ID。
5. 填入客户端“图片生成模型 Endpoint ID”。

注意：

- 这个接入点需要支持参考图、指定比例或尺寸等图片生成能力。
- 客户端的 `16:9` / `9:16` 画面比例会传给后端图片生成逻辑，所选模型需要支持对应能力。

## 7. 创建视频生成模型 Endpoint ID

用途：填写客户端的“视频生成模型 Endpoint ID”。

建议模型类型：火山方舟中的视频生成模型，例如 Seedance / 豆包视频生成类模型。这个模型会根据分镜首帧图和视频提示词生成每个分镜片段。

1. 打开火山方舟模型或接入点页面：
   - 模型广场 / 模型列表：  
     [https://console.volcengine.com/ark/region:ark+cn-beijing/model](https://console.volcengine.com/ark/region:ark+cn-beijing/model)
   - 推理接入点：  
     [https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint)
2. 选择支持图生视频 / 首帧生视频的视频生成模型。
3. 创建或开通推理接入点。
4. 复制该视频生成接入点的 Endpoint ID。
5. 填入客户端“视频生成模型 Endpoint ID”。

注意：

- 视频生成通常耗时明显长于图片生成。
- 如果资产库中长时间没有视频文件，请先检查该视频接入点是否支持当前输入方式和画面比例。

## 8. 创建 TOS Bucket

用途：填写客户端的“TOS Bucket”，并配合 Access Key / Secret Key 使用。

1. 打开 TOS 存储桶页面：  
   [https://console.volcengine.com/tos/bucket](https://console.volcengine.com/tos/bucket)
2. 创建存储桶。
3. 建议选择与模型服务接近的地域，例如 `cn-beijing`，减少跨地域访问问题。
4. 记录存储桶名称，填入客户端“TOS Bucket”。

相关入口：

- TOS 控制台：[https://console.volcengine.com/tos](https://console.volcengine.com/tos)
- TOS 文档首页：[https://www.volcengine.com/docs/6349](https://www.volcengine.com/docs/6349)

注意：

- Bucket 名称不是访问域名，也不是路径。
- 如果用户已有 Bucket，可以复用，但需要确保当前 Access Key 有读写权限。

## 9. 获取 TOS Access Key 和 Secret Key

用途：填写客户端的“TOS Access Key”和“TOS Secret Key”。

1. 打开访问控制 Access Key 管理页面：  
   [https://console.volcengine.com/iam/keymanage/](https://console.volcengine.com/iam/keymanage/)
2. 创建或查看 Access Key。
3. 复制 Access Key ID，填入客户端“TOS Access Key”。
4. 复制 Secret Access Key，填入客户端“TOS Secret Key”。
5. 确保该密钥拥有目标 TOS Bucket 的读写权限。

相关入口：

- 访问控制 IAM 控制台：[https://console.volcengine.com/iam](https://console.volcengine.com/iam)
- 访问控制文档首页：[https://www.volcengine.com/docs/6257](https://www.volcengine.com/docs/6257)

安全建议：

- 不建议使用主账号长期密钥分发给多人。
- 更推荐为每个使用者或每台机器创建独立子用户 / 独立密钥，并只授予必要的 TOS Bucket 权限。
- 如果怀疑密钥泄露，立即在控制台禁用或删除密钥。

## 10. 配置豆包语音 / TTS

用途：填写客户端的“TTS Access Key”“TTS App Key”和“默认音色”。这部分用于“模型生成配音”模式；如果只使用原音频，可以先跳过。

1. 打开语音服务控制台：  
   [https://console.volcengine.com/speech](https://console.volcengine.com/speech)
2. 开通语音合成 / 豆包语音相关服务。
3. 在控制台创建应用或服务资源。
4. 找到并复制：
   - Access Key / Access Token：填入客户端“TTS Access Key”。
   - App Key / App ID：填入客户端“TTS App Key”。
   - Speaker / Voice ID：填入客户端“默认音色”。
5. 默认音色可以先使用客户端默认值：  
   `zh_female_xiaohe_uranus_bigtts`

相关入口：

- 语音服务控制台：[https://console.volcengine.com/speech](https://console.volcengine.com/speech)
- 语音技术文档首页：[https://www.volcengine.com/docs/6561](https://www.volcengine.com/docs/6561)

客户端内置的可用音色示例：

```text
zh_female_xiaohe_uranus_bigtts
zh_female_vv_uranus_bigtts
zh_male_m191_uranus_bigtts
zh_male_taocheng_uranus_bigtts
en_female_dacey_uranus_bigtts
en_male_tim_uranus_bigtts
en_female_stokie_uranus_bigtts
```

## 11. 回到客户端保存配置

1. 回到客户端“配置火山引擎账号”页面。
2. 填写火山方舟、TOS、本地素材目录和可选 TTS 配置。
3. 点击“检查必填项”。
4. 如果检查通过，点击“保存配置并重启后端”。
5. 后端重启后，配置页会关闭，进入本地管理员登录页或工作台页面。

客户端保存位置：

```text
macOS:   ~/Library/Application Support/chat2cartoon-desktop/config.json
Windows: %APPDATA%/chat2cartoon-desktop/config.json
```

配置保存后，客户端会把这些值注入给本机后端：

```text
API_KEY / ARK_API_KEY
LLM_ENDPOINT_ID
T2V_ENDPOINT_ID
CGT_ENDPOINT_ID
TOS_ACCESSKEY
TOS_SECRETKEY
TOS_BUCKET
TTS_ACCESS_KEY
TTS_APP_KEY
TTS_API_RESOURCE_ID
TTS_BASE_URL
TTS_NAMESPACE
TTS_SPEAKER
ASSET_ROOT
```

## 12. 登录工作台

火山引擎配置不是客户端工作台账号。配置通过后，客户端还会检查本地管理员登录状态。

默认开发环境的初始化账号通常是：

```text
用户名：admin
密码：admin123456
```

正式分发时建议：

1. 首次启动后要求用户修改默认密码。
2. 或者在打包时提供初始化账号创建流程。
3. 不要把默认密码作为长期正式密码使用。

## 13. 常见问题

### 配置页一直提示缺少字段

检查必填项是否都已填写：

- 火山方舟 API Key
- 文案/分镜模型 Endpoint ID
- 图片生成模型 Endpoint ID
- 视频生成模型 Endpoint ID
- TOS Access Key
- TOS Secret Key
- TOS Bucket

### 后端显示正常，但生成时报模型错误

优先检查：

- Endpoint ID 是否复制错。
- Endpoint ID 对应模型能力是否正确，例如把图片模型填到了视频模型字段。
- API Key 是否属于同一个火山账号或有权限访问该接入点。
- 模型接入点是否已开通、可用、余额充足。

### 图片能生成，视频一直生成中

优先检查：

- 视频模型 Endpoint ID 是否是视频生成模型。
- 视频模型是否支持首帧图生视频。
- TOS Bucket 和 AK/SK 是否可读写。
- 火山方舟控制台中视频任务是否失败或排队。

### 配音失败，但成片或素材里有视频

优先检查：

- 是否选择了“模型生成配音”。
- TTS Access Key / App Key 是否填写。
- 默认音色是否可用。
- 如果暂时不用模型配音，可以选择“使用原音频”。

### 想迁移到另一台机器

建议不要直接复制包含密钥的配置文件。更安全的做法是在新机器上重新打开客户端，重新填写或粘贴配置。素材可以通过客户端的素材目录或导出的压缩包迁移。
