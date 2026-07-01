# Windows 客户端编译打包交接指引

本文用于把当前 macOS 开发机上的项目交接到另一台 Windows 机器，在 Windows 上继续编译和打包 Electron 客户端。目标是：Windows 机器不依赖 macOS 产物，重新构建前端、重新生成 Windows 后端 runtime，并输出 Windows 安装包。

## 1. 总体策略

推荐做法：

```text
源码通过 Git 传输。
不要传 macOS 本机生成产物。
不要传 .env、火山密钥、本地素材、管理数据库。
Windows 上重新安装依赖、重新构建 frontend/dist。
Windows 上重新生成 chat2cartoon-backend.exe。
Windows 上用 electron-builder 打包 Windows 客户端。
```

不要直接把整个 mac 工作目录复制到 Windows。以下内容要排除：

```text
.env
.env.local
.env.*.local
node_modules/
frontend/node_modules/
desktop/node_modules/
frontend/dist/
desktop/dist/
backend-runtime/dist/
.pyinstaller-build/
.codex-runtime/
assets/generated/
backend/data/
logs/
*.log
trace_*.log
```

这些目录或文件要么平台不兼容，要么包含本机缓存、密钥、素材或用户数据。

## 2. 项目传输方式

### 方式一：私有 Git 仓库，推荐

macOS 上先提交当前改动：

```bash
cd /Users/tangyuanhao/Documents/Codex/历史视频/ai-app-lab/demohouse/chat2cartoon
git status
git add .
git commit -m "feat: add desktop packaging runtime setup"
git push
```

Windows 上 clone：

```powershell
cd C:\Projects
git clone <你的私有仓库地址> chat2cartoon
cd chat2cartoon
```

优点：

```text
保留 Git 历史。
后续 macOS / Windows 双端可以持续同步。
Codex 在 Windows 上可以基于明确 commit 继续工作。
```

### 方式二：git bundle，适合没有远程仓库

macOS 上生成 bundle：

```bash
cd /Users/tangyuanhao/Documents/Codex/历史视频/ai-app-lab/demohouse/chat2cartoon
git bundle create chat2cartoon-20260701.bundle --all
```

把 `chat2cartoon-20260701.bundle` 通过 U 盘、NAS、局域网共享或可信网盘传到 Windows。

Windows 上 clone：

```powershell
cd C:\Projects
git clone C:\Users\<你的用户名>\Downloads\chat2cartoon-20260701.bundle chat2cartoon
cd chat2cartoon
```

### 方式三：源码压缩包，临时方案

只适合一次性临时测试。压缩包必须排除本地缓存、构建产物、密钥和用户数据。长期维护不建议使用这种方式，因为没有 Git 历史，后续排查版本会更困难。

## 3. Windows 项目路径建议

推荐路径：

```text
C:\Projects\chat2cartoon
```

不推荐：

```text
C:\Users\<你>\Desktop\历史视频\chat2cartoon
C:\Users\<你>\OneDrive\项目\chat2cartoon
C:\Users\<你>\Documents\My Projects\chat2cartoon
```

原因：

```text
Windows 下 PyInstaller、Electron Builder、FFmpeg、部分 Python 包更容易受中文路径、空格路径、OneDrive 同步目录影响。
短英文路径可以减少路径长度和编码问题。
```

建议开启 Git 长路径：

```powershell
git config --global core.longpaths true
```

如有条件，也建议启用 Windows 长路径支持：

```text
组策略：
Local Computer Policy > Computer Configuration > Administrative Templates > System > Filesystem > Enable Win32 long paths
```

或设置注册表：

```text
LongPathsEnabled = 1
```

## 4. Windows 机器需要安装的软件

最小构建环境：

```text
Git
Node.js LTS
pnpm
Python 3.9 - 3.11，64 位
PyInstaller
Visual C++ Redistributable
Visual Studio Build Tools，建议安装
Codex
```

建议版本：

```text
Node.js: 20 LTS 或 22 LTS
pnpm: 8.x 或项目兼容版本
Python: 3.10 x64 或 3.11 x64
PyInstaller: 6.x
```

安装后检查：

```powershell
git --version
node --version
pnpm --version
python --version
pip --version
```

如果 Windows 同时有多个 Python，优先使用 Python Launcher：

```powershell
py -3.10 --version
```

## 5. Windows 上不要传真实密钥

打包本身不应该依赖真实火山密钥。不要把 macOS 的 `.env` 或 Electron 本地 `config.json` 作为项目文件传到 Windows。

Windows 正式客户端配置保存位置：

```text
%APPDATA%\chat2cartoon-desktop\config.json
```

如果要在 Windows 上完整测试生成链路，建议打开 Windows 客户端后手动填写火山配置。

只有在个人可信环境中，才可以临时从 macOS 拷贝配置文件用于测试。该配置文件包含敏感信息：

```text
火山方舟 API Key
TOS Access Key
TOS Secret Key
TTS Access Key
TTS App Key
```

不要通过聊天、邮件或公共网盘传这些密钥。

## 6. 当前项目已有的 macOS 打包基础

当前项目已经具备：

```text
Electron packaged 模式加载 frontend-dist。
Electron packaged 模式优先启动 backend-runtime。
macOS 后端 runtime 构建脚本 scripts/build-backend-runtime-mac.sh。
PyInstaller spec: backend/pyinstaller/chat2cartoon-backend.spec。
火山配置保存到 Electron userData。
素材目录支持用户本地选择。
本地管理数据库在 packaged 模式下保存到 Electron userData/admin.db。
```

macOS 内测包已经验证过：

```text
frontend/dist 能被打入 .app。
backend-runtime/dist/chat2cartoon-backend/chat2cartoon-backend 能被打入 .app。
.app 打开后会启动包内 backend runtime，而不是回退到本机 Python。
/v1/desktop/status 正常。
```

## 7. Windows 版还需要补齐的内容

Windows 端主要缺口：

```text
Windows 后端 runtime 构建脚本。
Windows PyInstaller 产物验证。
electron-builder Windows target 配置。
Windows 图标 desktop/build/icon.ico。
NSIS 安装器配置。
Windows 安装/升级/卸载测试清单。
```

建议新增：

```text
scripts/build-backend-runtime-win.ps1
```

目标产物建议是：

```text
backend-runtime\dist\chat2cartoon-backend\chat2cartoon-backend.exe
```

为了兼容 Electron 查找逻辑，也可以同时复制一份到：

```text
backend-runtime\chat2cartoon-backend.exe
```

## 8. Windows 构建推荐流程

从干净 clone 后开始：

```powershell
cd C:\Projects\chat2cartoon
```

### 8.1 安装前端依赖并构建

```powershell
cd frontend
pnpm install
pnpm build
```

### 8.2 安装 desktop 依赖

```powershell
cd ..\desktop
pnpm install
```

### 8.3 准备后端 Python 环境

```powershell
cd ..\backend
py -3.10 -m venv .venv
.\.venv\Scripts\activate
python -m pip install -U pip
pip install -r requirements.txt
pip install "pyinstaller>=6.10,<7"
```

如果 `requirements.txt` 不完整，再根据报错补齐依赖。初期建议优先使用 `requirements.txt + pip`，比 Poetry 更直观。

### 8.4 生成 Windows 后端 runtime

后续建议用脚本：

```powershell
cd ..
.\scripts\build-backend-runtime-win.ps1
```

如果脚本暂时还没有，可以先手工尝试：

```powershell
cd C:\Projects\chat2cartoon\backend
.\.venv\Scripts\activate
python -m PyInstaller --noconfirm --clean --distpath ..\backend-runtime\dist pyinstaller\chat2cartoon-backend.spec
```

注意：macOS 的 spec 已经可用作起点，但 Windows 上可能需要按实际缺失模块和资源路径调整。

### 8.5 打包 Windows 客户端

```powershell
cd C:\Projects\chat2cartoon\desktop
pnpm run pack
pnpm run dist
```

产物预期在：

```text
desktop\dist\
```

例如：

```text
历史知识视频生成器 Setup 0.1.0.exe
```

## 9. Windows electron-builder 配置建议

后续可在 `desktop/package.json` 中补：

```json
{
  "build": {
    "win": {
      "target": ["nsis"],
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "perMachine": false,
      "deleteAppDataOnUninstall": false
    }
  }
}
```

重点：

```text
deleteAppDataOnUninstall: false
```

用户配置、管理数据库和部分运行数据位于：

```text
%APPDATA%\chat2cartoon-desktop
```

卸载时不要默认删除，除非用户明确选择清理用户数据。

## 10. Windows 必测清单

不能只看安装包生成成功，必须完整运行客户端。

基础启动：

```text
1. 双击客户端能打开。
2. 首次配置火山引擎账号页面正常。
3. 保存配置并重启后端正常。
4. /v1/desktop/status 显示后端来自 chat2cartoon-backend.exe。
5. 退出客户端后后端 exe 会退出。
6. 重新打开后配置仍保留。
```

生成链路：

```text
1. 上传文案正常。
2. 上传参考图正常。
3. 生成分镜脚本正常。
4. 生成角色图正常。
5. 生成分镜画面正常。
6. 生成分镜视频正常。
7. 配音正常。
8. 成片合成正常。
9. 打开素材目录正常。
10. 下载单个素材和阶段压缩包正常。
```

Windows 特殊场景：

```text
1. Windows 用户名路径含中文。
2. 素材目录含中文。
3. 素材目录含空格。
4. 安装路径含空格。
5. Windows Defender 是否拦截 chat2cartoon-backend.exe。
6. 首次启动是否弹防火墙提示。
7. 普通用户权限能否运行。
8. 覆盖安装是否保留 %APPDATA% 配置。
9. 卸载是否保留用户数据。
```

建议使用一个干净 Windows 用户做测试，更接近真实用户环境。

## 11. Windows Codex 接续建议

在 Windows 机器安装 Codex 后，用项目目录作为 workspace：

```text
C:\Projects\chat2cartoon
```

可以先让 Windows 端 Codex 做环境检查：

```text
阅读项目，目标是在 Windows 上打包 Electron 客户端。先检查环境和现有打包配置，给出缺口，不要编码。
```

确认后再开始编码：

```text
补 Windows 后端 runtime 构建脚本和 electron-builder Windows 配置，开始编码。
```

建议 Windows 端 Codex 优先完成：

```text
1. 新增 scripts/build-backend-runtime-win.ps1。
2. 验证 PyInstaller 生成 chat2cartoon-backend.exe。
3. 补 desktop/package.json 的 win/nsis 配置。
4. 生成 Windows pack/dist。
5. 打开 Windows 客户端验证 /v1/desktop/status。
```

## 12. 常见问题与判断

### 12.1 Windows 能不能复用 macOS backend-runtime？

不能。macOS 产物是 Mach-O 可执行文件，Windows 需要 `.exe`。

### 12.2 Windows 能不能复用 macOS frontend/dist？

理论上前端静态产物跨平台可用，但不建议传。Windows 上应重新执行：

```powershell
cd frontend
pnpm build
```

这样保证产物对应 Windows 机器上的当前源码。

### 12.3 Windows 能不能复用 macOS node_modules？

不能。`node_modules` 中有平台相关二进制依赖，必须在 Windows 上重新安装。

### 12.4 Windows 能不能复用 macOS .env？

不建议。`.env` 包含敏感密钥，而且正式客户端应该让用户在配置页填写自己的火山引擎账号。

### 12.5 Windows 打包成功是否等于客户端可用？

不等于。必须确认：

```text
Electron 能打开。
后端 exe 能启动。
配置能注入后端。
生成链路至少完整跑一轮。
退出时后端进程能关闭。
```

## 13. 当前 macOS 侧交付状态

当前 macOS 侧已经完成：

```text
macOS PyInstaller runtime 构建脚本。
macOS backend-runtime onedir 产物验证。
Electron packaged 模式启动包内 runtime 验证。
macOS arm64 dmg/zip 内测包生成。
客户端安装与火山配置文档。
```

当前 macOS 内测产物位置：

```text
desktop/dist/历史知识视频生成器-0.1.0-arm64.dmg
desktop/dist/历史知识视频生成器-0.1.0-arm64-mac.zip
```

注意：这些是 macOS arm64 内测产物，不能用于 Windows。

## 14. Windows 下一步优先级

优先级从高到低：

```text
1. 把项目通过 Git 或 git bundle 放到 C:\Projects\chat2cartoon。
2. 安装 Windows 构建环境。
3. 安装前端、desktop、后端依赖。
4. 新增并运行 build-backend-runtime-win.ps1。
5. 验证 chat2cartoon-backend.exe 的 /v1/desktop/status。
6. 补 electron-builder win/nsis 配置。
7. pnpm run pack / pnpm run dist。
8. 安装并完整测试 Windows 客户端。
9. 后续再考虑 Windows 代码签名和自动更新。
```

短期目标是先生成可内部测试的 Windows 包。正式分发还需要：

```text
Windows 图标 icon.ico
代码签名证书
Windows Defender / SmartScreen 体验验证
安装器品牌信息
升级策略
```
