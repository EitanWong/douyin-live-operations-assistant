# 原始直播流直连感知实施记录

日期：2026-11-02。目的：从当前直播间原始媒体取得音画，不依赖选屏、浏览器标签页共享、站点播放器截图或麦克风。

## 数据流与边界

当前房间 URL → 当前房间 SSR 初始信息 / 同源 `/webcast/room/web/enter/` → 内存中的签名 FLV/HLS 候选 → 独立媒体解码器 → 画面轨道 + Web Audio 音频轨道 → Omni WebRTC 或分段视觉/ASR → 带采集时间、模型和输入来源的稳定观察 → 现有共享直播上下文、RAG、按需搜索 → 当前组合的回复模型。

“直接拉流”指直接获取原始流并解码；解码仍使用扩展所在浏览器的 MSE、HTMLMediaElement 和 Web Audio，不是操作系统原生后台进程。没有新增本地代理、远程播放器或运行时 CDN 脚本。两种识别传输和全部组合复用同一个输入抽象 `{stream, source, stop}`。屏幕共享保留为用户显式选择的独立输入源，默认关闭，不自动降级。

## 解析与生命周期

- 从数字房间 URL 取得 web_rid，与页面数据显式绑定；同源房间接口响应可以省略 web_rid，由请求参数绑定，但明确返回其他房间则拒绝。请求禁止重定向，切房后结果无效。
- 只解析已知房间结构中的 `stream_url`、`flv_pull_url`、`hls_pull_url_map` 和 SDK `stream_data`；保留签名查询参数。仅接受受限平台 CDN 的 HTTPS `.flv` / `.m3u8` 地址，不允许用户信息、其他端口或任意站外地址。
- 优先标清 FLV，控制重复下载和分析成本；SDK 明示 HEVC/AV1 的候选不选。独立解码器不借用网站播放器。mpegts/hls 关闭 worker；缓冲限制与延迟追赶开启，库诊断关闭，避免输出签名。
- 音频上下文在开始点击时唤醒。静音 video 的 captureStream 可能产生静音轨道，因此正式音频来自 createMediaElementSource → MediaStreamDestination，只进入分析，不接扬声器；视频使用独立解码器轨道。
- 获取房间接口限 10 秒，整个解码准备限 30 秒；用户取消及时拒绝，迟到解码器销毁。停止、暂停、切房、改组合及页面退出沿用现有清理；释放音频上下文、轨道、解码器、DOM 和定时器。
- 回复上下文只含识别文本、时效、模型与 `inputSource`，覆盖标签为 `sampled-direct-stream` / `realtime-vad-direct-stream`；原始媒体和签名地址不进入普通文字请求或存储。识别结果仍是不可信线索。

## 官方依据

- [mpegts.js API](https://github.com/xqq/mpegts.js/blob/master/docs/api.md)：MSE、FLV live、跨域、生命周期、延迟与缓冲配置。固定依赖 1.8.2，Apache-2.0。
- [hls.js API](https://github.com/video-dev/hls.js/blob/master/docs/API.md)：HLS 的 MSE 解码、fatal 错误与 destroy。固定依赖 1.7.4，Apache-2.0。
- [HTMLMediaElement.captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream)：元素媒体输出轨道，不是 display capture。
- [createMediaElementSource](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource) 与 [createMediaStreamDestination](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination)：独立解码音频路由与输出。

平台房间接口不是公开稳定 API；当前实现沿用项目已使用的房间接口并兼容常见初始数据形状。无法通过本次无账号环境核验所有在线房间/CDN 的实际响应和跨域策略，不将模拟数据当成真实平台验收。

## 验证与限制

行为测试覆盖房间绑定、签名保留、地址拒绝、解码启动超时、异步取消、无隐式选屏、资源清理、分段与实时接线、来源进入回复上下文及设置切换。先观察对应失败，再实现。

用 ffmpeg 生成 H264/AAC 测试媒体并通过本地 HTTP 连续推送 FLV；另生成 HLS 分片。真实浏览器运行正式 createDirectStreamSource 与打包解码器：两者均取得 320×180 画面、各一条音/视频轨道、音频 RMS 约 0.088，停止后轨道 ended 且独立解码 DOM 数为零。仅在测试适配器内替换为本地媒体地址，生产验证未放开。截图和脚本保存在 output/ai-direct-stream-2026-11-02。

没有使用真实模型密钥、共享真实直播或重载用户扩展。真实抖音接口、签名到期、CDN CORS、页面 CSP、账号权限、长时间断流与识别质量仍待现场验收。没有代理跨域、绕鉴权或自动重连；无可读音频轨道会失败。Omni 仍由 VAD 触发结果，静音画面不承诺定时观察。
