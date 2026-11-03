# 原生直播流实时感知

本地组件使用 StreamGet 获取当前抖音房间的 HTTPS CDN 地址，由 FFmpeg 直接拉取 FLV/HLS，解码为音频和画面，再通过百炼 Omni WebSocket 观察直播。Chrome 只传控制消息和识别文字，不承担音视频采集，不调用麦克风、录屏或标签页共享。

## 一次安装

当前自动安装支持 macOS 和 Linux 的 Google Chrome，需 Node.js 20+、Python 3.11+ 和 FFmpeg。Chrome 扩展使用构建后的 `dist/chrome-extension` 目录；修改代码后先运行 `npm ci` 和 `npm run build`，再在 `chrome://extensions` 重载扩展。

在“AI 设置 → 直播感知”选择“本地原生拉流”，展开“本地组件安装”。复制其中已包含扩展 ID 的命令，在项目根目录运行：

```sh
npm run native:install -- --extension-id=你的扩展ID
```

可指定已有的 Python 和 FFmpeg：

```sh
npm run native:install -- --extension-id=你的扩展ID --python=/opt/homebrew/bin/python3.14 --ffmpeg=/opt/homebrew/bin/ffmpeg
```

安装器创建独立 Python 环境并安装锁定依赖，将宿主注册给该扩展 ID。安装后无需另开终端运行服务。首次升级需重载扩展，以使 `nativeMessaging` 权限生效，再刷新直播页。点击“检查本地组件”可验证宿主通信、依赖版本和 FFmpeg；此检查不获取直播流、不请求模型。

组件保存在 `~/.local/share/douyin-live-assistant/native`。更换扩展 ID、项目修改原生组件后应重新运行安装命令。Windows 和其他浏览器暂不支持自动注册。油猴与演示页可继续选择浏览器直连来源。

## 开始感知

1. 在“连接与模型”选择“Omni 实时感知 + 现有文字模型回复”或“Omni 实时感知 + Omni 回复”。模型可从下拉菜单选择，也支持自定义。
2. 配置百炼地域、业务空间与 API Key，确保账号开通所选实时模型。第一种组合还需配置独立回复模型。
3. 在“直播感知”选择“本地原生拉流”，点击“原生拉流并开始感知”。可以直接使用当前草稿开始识别；需要长期保留时点击“保存设置”。开始感知不会自行启动已暂停的弹幕发送引擎。
4. 状态依次显示地址解析、Omni 配置确认、音画解码与观察。只有两条媒体轨道均接入才显示采集就绪；“近期识别结果”出现最终文字才代表模型已完成观察。
5. 点击“停止识别”释放网络、解码器与原生进程。关闭直播页或退出 Chrome 同样会停止；收起面板不影响感知。原生感知目前不承诺关闭页面后继续运行。

原生来源适配两种 Omni 实时组合。阿里视觉/语音分段组合及自定义分段识别仍使用浏览器来源，不能混用原生实时输入。

## 音画与上下文

FFmpeg 从同一条流输出 16kHz、单声道、16位 PCM，画面约每秒一帧、最长边不超过640像素。先发送音频，再发送 JPEG。每轮约8秒提交一次音画，请求文字观察；采用手动分轮，静音时仍可观察画面。模型响应、网络和启动耗时另计，不能理解为逐帧零延迟。

观察结果标记采集时间、结束时间、模型与原生来源，通过现有媒体会话进入直播上下文，依照有效期提供给回复模型，继续结合弹幕、直播数据、知识库与搜索。原生服务只观察、不发送公屏消息；回复仍遵守原有发送模式、额度和内容治理。

原始流可排除网页 DOM 弹幕层、浏览器工具栏及系统声音；主播编码进视频的水印、字幕和混入的声音仍存在。PK混流不保证分离主播双方。不会保存源音视频文件，也不会下载观众主页视频。

## 恢复、额度和故障

地址解析/媒体解码失败时最多尝试5轮，每轮重新解析地址并轮换候选，等待1/2/4/8秒。鉴权、模型协议、额度错误立即停止。只有已完成且通过去重的模型响应进入上下文；迟到结果、已停止会话和其他房间的结果不接收。

“高级设置”可限制单次启动时长、累计响应 token 和每小时识别次数。同一次启动的重连保留计数，手动停止后再次启动会重置。token 上限依据服务端已完成响应的用量检查，正在进行的调用可能超过剩余额度，不是账户账单硬上限；请同时设置百炼账户预算。

- 未安装：确认扩展 ID、Chrome 注册目录和 Python/FFmpeg，然后重新安装、重载。
- 无法解析：确认房间仍在直播，检查本机网络。平台接口可能调整或要求登录，解析器可读取本地进程环境变量 `DOUYIN_STREAM_COOKIES`；扩展不提取浏览器 Cookie。桌面 Chrome 不一定继承终端环境，当前未提供 Cookie 设置界面；无凭据可用时会明确失败。
- 解码失败：检查 FFmpeg 是否支持该流的编码、网络是否持续可达。不会自动切换到录屏。
- Omni 失败：核对业务空间、地域、API Key、模型权限；服务端原始错误与签名地址不展示在界面，避免泄露凭据。

卸载本组件（不删除扩展设置）：

```sh
npm run native:install -- --uninstall
```

## 开发验证

```sh
npm test
npm run build
npm run check
~/.local/share/douyin-live-assistant/native/.venv/bin/python -m unittest discover -s native -v
```

Python测试包含真实 FFmpeg 合成流解码、静音画面、真实本地 WebSocket 模型事件、重复提交确认和取消回收，不请求付费模型。未安装依赖时相关测试会跳过，不能记作实际链路通过；CI单独安装完整环境执行。

协议依据：[百炼实时音视频](https://help.aliyun.com/zh/model-studio/realtime)、[客户端事件](https://help.aliyun.com/zh/model-studio/client-events)、[服务端事件](https://help.aliyun.com/zh/model-studio/server-events)。原始项目调研见[复用研究](../research/lucky-box-clean-stream-reuse-2026-11-02.zh-CN.md)。
