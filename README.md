# AI 数字教师课堂监督系统（摄像头第一版）

## 快速在线测试

无需下载或安装，直接打开已经部署好的系统：

### [点击进入 AI 数字教师课堂监督系统](https://asepochs.github.io/ai-digital-teacher/)

使用前请允许浏览器访问摄像头并调高设备媒体音量。手机默认优先使用后置摄像头，电脑会自动使用可用的内置摄像头；检测到异常行为时系统会进行中文语音提醒。

> Render 免费后端长时间无人访问会休眠，首次打开时可能需要等待约一分钟完成唤醒。如果页面暂时提示后端连接失败，请稍等后重试。

一个可在本地或公网运行的课堂监督工作台。用户上传一张教师正面照片作为静态课堂监督员，点击“开启课堂监督”后，浏览器调用手机后置摄像头或电脑内置摄像头。系统约每 3 秒截取一次课堂画面，由豆包多模态模型判断画面中学生的位置与行为；发现交头接耳、玩手机、趴桌等需要关注的行为时，页面圈出对应学生、记录事件并播放中文语音提醒。结束监督后，后端根据本次记录生成逐人课堂行为报告。

本版本不分析 `frontend/public/classroom.mp4`，也不调用 OmniHuman 或即梦生成动态数字人。

## 课堂观察工作区

新版界面包含六个页面，使用侧栏导航，手机端通过左上角菜单切换：

- **工作台**：今日会话、分析次数、异常数量、近七天观察趋势和当前课堂入口。数字来自本机真实课堂记录，不展示模拟全校数据。
- **实时课堂**：摄像头画面、AI 实时观察、监督员照片、异常语音提醒和事件时间轴。切换其他页面时，当前会话保持运行。
- **AI 课堂分析**：当前行为分布、正常记录占比，以及课堂结束后的逐人报告。统计不等同于学生专注度、考勤或教学质量评分。
- **事件中心**：筛选正常/异常行为，按行为或座位标签搜索当前会话记录。
- **历史课堂**：自动保留当前浏览器最近 30 次已结束课堂的报告，支持查看与 JSON 导出。
- **工作区设置**：填写学校、教室、课程和观察员，检查后端连接并查看操作说明。

历史报告和工作区设置保存在当前浏览器中，未接入跨设备同步、学校统一账户或角色权限；清理站点数据后本机历史会丢失，请按需导出。教师行为评价、多教室接入和全校统计目前尚未接入。

## 已实现能力

- React、TypeScript、Vite 中文课堂监督工作台；
- FastAPI 后端与 Provider 化的豆包视觉分析、豆包 TTS；
- 浏览器摄像头权限申请、实时预览、暂停、继续和结束监督；
- 默认每 3 秒截取并压缩一张摄像头画面，不把 API 密钥放到前端；
- 豆包 Seed 多模态模型返回座位标签、归一化位置框、行为和提醒语；
- 根据位置匹配保持学生编号相对稳定；
- 连续相同状态自动合并，持续异常只提醒一次；恢复正常后再次异常可重新提醒；
- 正常学习状态只显示和记录，不语音播报；
- 异常状态圈选学生、写入实时记录、显示字幕并调用豆包 TTS；
- 豆包 TTS 失败时自动使用浏览器中文语音；
- 上传的静态教师照片从开始到结束始终显示；
- 结束后按学生统计行为、累计时间、提醒次数和行为时间轴；
- 网络或单次模型调用失败不会关闭摄像头，下一轮会自动继续；
- 无方舟密钥时仍可打开摄像头和使用静态教师，但页面会明确提示视觉分析不可用，不会伪造识别结果。

## 项目结构

```text
.
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  └─ services/
│  │     ├─ classroom_analysis.py  # 豆包完整视频/摄像头帧理解 Provider
│  │     ├─ live_sessions.py       # 实时会话、座位稳定与连续事件合并
│  │     ├─ tts.py
│  │     └─ reports.py
│  └─ tests/
├─ frontend/src/
├─ .env.example
├─ 启动数字教师系统.bat
├─ start.ps1
└─ verify.ps1
```

## 一键启动

要求：Windows、Python 3.9+、Node.js 20+，建议使用最新版 Chrome 或 Edge。

最简单的方式是双击项目根目录下的 `启动数字教师系统.bat`。启动器会检查运行环境、同时启动前后端，并在服务就绪后自动打开浏览器。运行期间请保持弹出的“AI 数字教师服务”窗口开启。

也可以在项目目录打开 PowerShell 手动启动：

```powershell
.\start.ps1
```

启动地址：

- 工作台：<http://localhost:5173>
- 后端 API：<http://localhost:8000>
- API 文档：<http://localhost:8000/docs>

浏览器摄像头只能在 `localhost` 或 HTTPS 安全环境中使用。首次点击“开启课堂监督”时，浏览器会询问摄像头权限，请选择允许。如果提示设备占用，请关闭正在使用摄像头的视频会议或相机软件后重试。

## GitHub Pages 部署

仓库内置 `.github/workflows/pages.yml`，推送到 `main` 分支后会自动构建并发布前端页面。GitHub Pages 只提供静态网页托管，不能运行本项目的 FastAPI 后端。

后端可以通过仓库根目录的 `render.yaml` 部署到 Render 免费 Web Service：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ASEpochs/ai-digital-teacher)

创建 Blueprint 时只需填写未同步的 `ARK_API_KEY`。该值保存在 Render 环境变量中，不会写入 GitHub。部署完成后，将 Render 提供的 HTTPS 服务地址配置为 GitHub Actions 变量 `VITE_API_BASE_URL`，再重新运行 Pages 工作流。

要让 Pages 页面具备教师照片上传、豆包课堂画面分析、语音提醒和报告能力，还需要：

1. 将 `backend` 部署到一个支持 Python/FastAPI 的 HTTPS 服务；
2. 在后端设置 `FRONTEND_ORIGIN=https://<用户名>.github.io` 与正确的 `PUBLIC_BASE_URL`；
3. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 中创建 `VITE_API_BASE_URL`，值为公网后端地址（例如 `https://api.example.com`）；
4. 重新运行 Pages 工作流。

不要把 `.env` 或任何 API Key 提交到 GitHub。当前 `.gitignore` 已排除本地凭据、依赖、测试上传内容和生成媒体。

## 使用顺序

1. 打开[在线工作台](https://asepochs.github.io/ai-digital-teacher/)或本地 <http://localhost:5173>，在「工作区设置」填写课堂信息；
2. 进入「实时课堂」，上传 JPG、PNG 或 WebP 教师正面照片；
3. 可先点击“测试语音提醒”检查音色；
4. 点击“开启课堂监督”并允许浏览器使用摄像头；
5. 系统持续显示摄像头画面并按间隔分析学生行为；
6. 可暂停或继续监督；
7. 点击“结束并生成报告”并确认，摄像头会关闭，自动进入「AI 课堂分析」并保存报告至本机「历史课堂」。

## 环境变量

复制 `.env.example` 为 `.env`，只在本机填写真实凭证。`.env` 已被忽略，不要把密钥发给他人或提交到代码仓库。

### 豆包摄像头画面理解

```dotenv
CLASSROOM_ANALYSIS_PROVIDER=doubao
ARK_API_KEY=填写火山方舟APIKey
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=doubao-seed-2-0-lite-260215
LIVE_ANALYSIS_INTERVAL_SECONDS=3
LIVE_ANALYSIS_TIMEOUT_SECONDS=45
LIVE_FRAME_MAX_SIZE_MB=3
```

- `ARK_API_KEY` 是火山方舟 API Key，不是账号 AK/SK，也不是豆包语音 Token；
- `ARK_VIDEO_MODEL` 使用方舟控制台中已开通、支持图片理解的模型调用 ID；
- `LIVE_ANALYSIS_INTERVAL_SECONDS` 是两次分析之间的等待时间。建议保持 3～5 秒；设置过小会增加费用、限流和误报；
- 每张画面在浏览器压缩为最长边不超过 960 像素的 JPEG，再通过后端发送给方舟 Responses API；
- 课堂画面不会由前端直接调用方舟，API Key 始终只在后端读取。

### 豆包语音

```dotenv
TTS_PROVIDER=doubao
DOUBAO_TTS_APP_ID=填写豆包语音AppID
DOUBAO_TTS_ACCESS_TOKEN=填写豆包语音AccessToken
DOUBAO_TTS_CLUSTER=填写控制台显示的Cluster
DOUBAO_TTS_VOICE=填写音色ID
```

语音服务失败时系统自动改用浏览器中文语音，课堂监督和报告不会中断。

### 静态教师照片

当前页面始终以 `mode=static` 上传教师照片，因此不会调用以下旧版能力：

- OmniHuman 口型视频；
- 即梦待机视频；
- 为数字人素材上传 TOS。

相关 Provider 代码和环境变量仍保留，方便以后恢复动态数字人对比，但不会被摄像头第一版页面触发。

## 实时分析说明

本版本是“几秒级准实时分析”，不是对摄像头 15～30 帧/秒逐帧调用大模型。每次分析独立处理一张课堂截图，并把已建立的座位表传给下一次请求。后端还会根据学生位置做二次匹配，减少模型在连续画面中改变学生编号的情况。

大模型判断存在概率误差。为了获得较稳定的演示效果：

- 摄像头应固定，不要频繁移动；
- 让学生上半身和桌面行为清晰可见；
- 避免强逆光、过暗和学生严重遮挡；
- 正式使用前应告知被拍摄人员并取得必要授权；
- 本系统只做课堂行为辅助观察，不做人脸识别，也不应作为惩罚学生的唯一依据。

## 接口

- `POST /api/live-sessions`：创建一次摄像头监督会话；
- `POST /api/live-sessions/{session_id}/frames`：提交当前摄像头截图和监督时间；
- `POST /api/live-sessions/{session_id}/finish`：结束监督并生成报告；
- `POST /api/teacher`：上传静态教师照片；
- `POST /api/tts`：合成异常提醒语音；
- `GET /api/health`：查看后端和 Provider 状态。

旧的完整视频分析接口仍留在后端用于兼容已有测试和后续对比，但当前前端不会调用。

## 验证

```powershell
.\verify.ps1
```

或：

```powershell
npm test
npm run build
```

自动化测试覆盖摄像头会话降级、学生位置稳定、连续行为合并、异常重新建事件、报告、TTS、图片校验和原有时间同步工具。真实摄像头权限需要在浏览器中人工允许，因此自动化测试使用图片模拟摄像头帧。
