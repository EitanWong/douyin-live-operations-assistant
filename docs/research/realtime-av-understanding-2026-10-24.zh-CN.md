# 实时直播音视频理解：可行性、开源方案与接入设计

调研日期：2026-10-24（Asia/Shanghai）。对象：本仓库的抖音直播运营 Chrome 扩展。本文区分官方已提供的能力、当前源码已有能力和待实测的工程目标；没有执行真实直播媒体捕获、模型部署或延迟/识别率基准。

## 1. 结论与选择

可行。建议把“持续感知”和“决定是否回复”分开：持续转写主播所在直播音轨；画面先做本地低成本采样、变化检测和文字提取；必要时才做视觉语义理解；把这些结果连同弹幕、礼物和 PK 事件交给现有回复引擎。

优先路线是 **浏览器原生采集 + 本地中文流式 ASR + 稀疏视觉理解 + 现有文字回复模型**。这是针对当前项目的工程取舍，不是已经证明优于所有全模态模型的实测结论。另设实时全模态 API 为对照组：它可能有很低的首遍输入单价，不能未经核算就断言其一定更贵。

| 使用条件 | 建议组合 | 主要取舍 |
| --- | --- | --- |
| 长时间使用，允许安装一个本地服务 | `tabCapture` + sherpa-onnx 中文 streaming 模型 + 本地 OCR + 按需云端 VLM | 优先验证；语音没有按分钟 API 费，能单独替换模块 |
| 不安装本地服务 | 扩展内 sherpa-onnx WASM Worker；性能不达标时切云端 ASR | 使用方便，但模型下载、内存、CPU 和扩展 CSP 必须验证 |
| 最快做效果对照 | `tabCapture` + 云端流式 ASR + 按需 VLM | 有持续音频费用；便于先获得质量基线 |
| 特别重视语气、笑声、音画关联 | 实时全模态 API；或已有 GPU 上的 MiniCPM-o 4.5 / Qwen3-Omni | 需验证长会话、中文场景、记忆与真实 usage；本地部署资源明显更重 |
| 多房间、无人值守采集 | 独立采集服务 + 合法可访问的流地址 + FFmpeg | 与当前单页扩展分开设计，额外维护流地址和解码链路 |

不要先做连续 25/30 fps 画面上传或每个 ASR partial 都请求大模型。多数场控问答主要需要主播最近说了什么、画面正在展示什么，以及这条弹幕是否已经被主播回答。快速动作分析才需要更密集的多帧输入。

## 2. 当前项目能复用什么

以下来自 2026-10-24 当前工作树，不代表已发布版本。

- `extension/manifest.json` 已是 Manifest V3，最低 Chrome 120，已有工具栏 popup。当前没有 `tabCapture`、`offscreen` 权限，也没有媒体采集入口。
- `extension/page.js` / `src/browser/adapter.js` 观察直播 IM 和页面事件，不读取主播媒体。协议中的 `audio-chat` 只是某类平台消息字段，不能当成连续主播 ASR。
- `src/core/reply-context.js` 的 `liveReplyContext()` 已汇总近期事件、房间统计、游戏和 PK；适合扩展一个带时效的 `media` 分支。
- `src/core/engine.js` 已有回复判定、限流、去重、冷却和 `[SKIP]` 路径；语音/画面先更新上下文，不应直接等价为一条“观众提问”。
- `src/services/ai.js` 当前只支持文字 `/chat/completions`、`stream:false` 和完整 JSON 响应。提示词明确不能假装听到声音/看到画面。增加媒体能力时应按有效来源条件化这一声明，不能直接删掉约束。
- `scripts/build.mjs` 显式列出要复制的扩展文件。新增 offscreen 页面、Worklet、Worker、WASM 和模型资产时必须扩展构建产物清单。

## 3. 如何捕获直播音视频

### 3.1 首选：Chrome 标签页捕获

Chrome 官方提供 `tabCapture.getMediaStreamId()` → offscreen document → `getUserMedia()` 路径；Chrome 116 起支持由 service worker 获取 stream ID 后交给 offscreen 使用。项目最低版本满足这个基础条件。[Chrome 采集指南](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)、[tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)。

建议的数据路径：

```text
用户点击扩展 popup 的“开启直播感知”
  → service worker：核验目标 tab / room，创建 offscreen，取得 stream ID
  → offscreen：持有音频/视频 MediaStream
      ├─ 音频 → AudioWorklet → 重采样 → 流式 ASR → partial / final
      └─ 视频 → 直播区裁剪 → 帧去重 / OCR → 按需视觉模型
  → MediaContextStore：时间、来源、有效期、版本、缺口
  → liveReplyContext.media
  → 原有 AI 回复判断、冷却、去重、发送调度
```

关键实现边界：

1. **明确的用户启动动作。** 不能后台任意启动捕获。当前存在 `default_popup`，不能只增加 `action.onClicked` 监听就期待它触发；需要 popup 内的真实启动入口并验证该路径。[Chrome 采集指南](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)。
2. **持续处理放 offscreen。** service worker 用于权限和控制，不能承担长期 DOM/音频处理；offscreen 主要使用 Web API，扩展 API 仅有 `chrome.runtime`。使用适合 `getUserMedia` 的 `USER_MEDIA` reason；不能只用会在静音 30 秒后关闭的 `AUDIO_PLAYBACK` reason。[offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)。
3. **恢复本地播放。** 捕获标签页音频后，浏览器默认不再直接播放该音轨，需要将捕获源接回 `AudioContext.destination`。这是听感必须验收的路径。[tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)。
4. **捕获的是标签页混音。** 可能包含主播、PK 对手、连麦者、BGM 和站内提示音；不能把所有转写标成“主播本人说”。TTS 若也在该 tab 播放还会污染分析输入，应单独路由或做来源抑制。
5. **捕获画面包含页面渲染。** 由内容脚本报告直播区坐标，转换为捕获视频实际像素坐标再裁剪；窗口缩放、DPR、滚动、全屏、播放器重建及悬浮面板覆盖都需要更新/排除。不要把整个桌面或扩展面板持续发给视觉模型。
6. **生命周期要独立。** 捕获状态使用 `idle → starting → running → stopping`，串行化创建；stream `ended`、导航换房、扩展重载时显式清理并标记缺口。断流后能否继续使用当前捕获轨或需要再次用户启动，按实际浏览器路径验证。

`getDisplayMedia()` 适合用户选择 OBS、直播伴侣或桌面窗口，属于另一个采集入口；系统音频可用性依 OS 和共享目标而异，不能保证跨平台一致。[Screen Capture 规范](https://www.w3.org/TR/screen-capture/)。

### 3.2 可选优化：页面 `<video>` / `captureStream()`

若播放器的 `<video>` 可访问且 origin-clean，可以直接采集元素或画布抽帧，减少页面覆盖物干扰。但 MSE/Blob URL 不代表媒体与页面同源，跨源媒体的 `captureStream` / Canvas 读取受限制；元素还可能被播放器替换。因此只在现场探测通过后作为优化，不作为唯一基础能力。[媒体元素捕获规范](https://www.w3.org/TR/mediacapture-fromelement/)。

### 3.3 独立拉流：适合后续服务化

[DouyinLiveRecorder](https://github.com/ihmily/DouyinLiveRecorder) 是现成的抖音等多平台采集/录制参考，基于 FFmpeg，仓库代码 MIT；[Streamlink](https://github.com/streamlink/streamlink) 也有抖音插件。但它们解决的是流获取/播放/录制，不自动提供上下文融合和 AI 回复。

本项目第一版不必承担独立拉流所需的签名 URL、Cookie、URL 过期重连、容器解析和播放器外第二次拉流。直接拉流是否更低延迟，取决于实际分发协议、CDN 与解码缓冲；HLS/FLV/WebRTC 的名称不能单独证明延迟。若集成打包 FFmpeg，需单独核对具体二进制构建的 LGPL/GPL 及编解码组件，不能把上层 MIT 许可套到所有依赖。[FFmpeg 许可](https://ffmpeg.org/legal.html)。

## 4. 开源语音识别方案

| 方案 | 已核对的能力 | 本项目判断 |
| --- | --- | --- |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0；本地运行、WebSocket、WASM；有中文/中英 streaming Paraformer 与 Zipformer | **本地低成本首选候选**，分别评估本地服务和扩展 WASM |
| [FunASR](https://github.com/modelscope/FunASR) | 当前仓库代码 MIT；有 `Paraformer-zh-streaming` 和流式 runtime | 中文对照组；需要单独核对使用的模型权重条款 |
| [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) | Apache-2.0；0.6B / 1.7B，中文及方言；官方支持 streaming | 方言/BGM/歌唱场景候选；官方 streaming 当前仅 vLLM，不能直接等同纯浏览器方案 |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT；量化、CPU、Apple Metal；有 `stream` 示例 | 多语种/Apple 本地备选，须测中文实体名和延迟 |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) + [WhisperLive](https://github.com/collabora/WhisperLive) | MIT；已有 WebSocket 与浏览器采集参考 | 接近现成的端到端转写骨架，但 Whisper 是靠窗口策略实现近实时 |
| [Silero VAD](https://github.com/snakers4/silero-vad) | MIT；ONNX，可判断语音活动 | 辅助切句和过滤，不做 ASR，也不能可靠区分主播、嘉宾与人声歌曲 |

模型能力证据另见 [sherpa 中文在线 Paraformer](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/index.html)、[sherpa WASM 示例](https://github.com/k2-fsa/sherpa-onnx/tree/master/wasm)、[FunASR runtime](https://github.com/modelscope/FunASR/tree/main/runtime)。

需要特别区分：

- **流式识别与文件识别。** 选择 streaming checkpoint 并保留每房间的 decoder cache；不能把录音文件 API 每秒重传一遍当作真正低延迟流式。
- **首字与最终句子。** streaming partial 会改写；partial 可展示、可预判话题，自动回复原则上用 final 或稳定前缀并保留修订关系。
- **两遍识别。** 可以先用 streaming 结果更新语境，句末再用较强模型修正；不要让慢速第二遍阻塞所有场控回复，也不要把修正重复发一次。
- **Whisper 系列。** 滑动窗口和重叠重识别存在额外计算/确认等待。`faster` 是吞吐优化，不等于所有场景首字更快。旧 [Whisper-Streaming](https://github.com/ufal/whisper_streaming) 已指向 SimulStreaming，选型时不把旧示例当最新推荐。
- **SenseVoice。** [官方仓库](https://github.com/FunAudioLLM/SenseVoice) 提供转写及语音事件/情感标签；原模型的短音频快速推理不能直接当作原生逐字流式。适合句段后处理或经过验证的 chunk 包装。

ASR 热词可以用主播名、常见礼物名、正在展示的商品/歌曲名，但不同模型的热词能力不同；不能把模型不支持的功能写成公共保证。优先比较真实直播的实体准确率和漏词，而不只看厂商通用榜单。

### 音频链路的建议初值（待测）

- 保留捕获原轨；识别分支按模型要求重采样，例如 16 kHz 单声道。不要通过直接丢采样点代替有抗混叠的重采样。
- AudioWorklet 负责持续读取；20–40 ms 作为传输包初值，**不代表模型每 20 ms 能出字**；模型自己的 chunk/lookahead 另行设置。
- Silero 使用其支持的采样率和固定输入窗，靠缓冲拼接；不把任意长度的 20 ms 包直接视为合法推理窗。[Silero 输入约定](https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py)。
- 切句可先试 400–800 ms 尾静音，并保留 200–300 ms 前卷；连续讲话另设最长句段。只是实验参数，仍需按模型/直播类型调整。
- 媒体二进制由 offscreen 直连 Worker / WebSocket，不把每包 Float32/PCM 经 MAIN 页面桥、JSON 和持久事件日志反复转发。runtime message 只传控制和小型结果。
- 默认不做强降噪或 AEC。当前拿到的是已经混合编码的远端节目音轨；没有原始多麦克风轨和独立参考音，不能靠 AEC/定向拾音还原“仅主播”。

本机相邻的 EasyMic APM 仓库是 WebRTC 音频前处理 SDK，并非 ASR。其 README 要求定向拾音使用同步物理麦克风，并规定 AEC 需要参考信号；因此不宜为这个远端混音采集任务先引入其空间处理链路。

## 5. 画面理解与实时全模态

### 5.1 便宜的视觉感知分层

建议先按以下顺序实验，而不是固定每秒调用一次 VLM：

1. **直接复用结构化事件和 DOM 文字**：PK 比分、礼物、商品标题等已有可信来源时，不重复用 OCR 猜测。
2. **本地采样与过滤**：直播区低分辨率预览 0.5–1 fps；画面差异、直方图或感知哈希仅判断“是否值得分析”。遮掉弹幕/礼物动效，避免这些动画制造持续变化。
3. **本地 OCR**：字幕、商品卡、标题的 ROI 用 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)；官方有 PP-OCRv5 浏览器 SDK，也已有 PP-OCRv6 本地模型。v6 的发布不能自动推断浏览器 SDK 已支持它，应按具体后端选型。[浏览器 SDK](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js)、[OCR 模型文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md)。
4. **稀疏 VLM**：有明显场景变化、商品切换、观众问“这个是什么”，或刷新超时再发当前裁剪帧；普通聊天可先试每 15–30 秒最多一次，并设独立小时预算。
5. **动作问题升级多帧**：“刚才做了什么”需要带时间的短帧序列。单张图不能证明动作过程；低频采样会漏掉短暂动作和一闪而过的商品信息。

画面输出限定为短的结构化观察，如 `visible_text`、`objects`、`activity`、`uncertain`，附采样时间与引用帧；避免长篇描述和心理/身份猜测。OCR 文本不自动成为已核实价格或承诺，商品事实仍要与结构化数据对照。

### 5.2 可用的开源视觉/全模态项目

| 项目 | 可以解决什么 | 部署判断 |
| --- | --- | --- |
| [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL) | Apache-2.0；图像、OCR 和视频理解；有 2B / 4B 等模型 | 本地小 VLM 的候选；不是音频识别器。量化后实际内存还含视觉编码器/KV cache，需实测 |
| [MiniCPM-o 4.5](https://github.com/OpenBMB/MiniCPM-V/blob/main/docs/minicpm_o4dot5_en.md) + [官方 Demo](https://github.com/OpenBMB/MiniCPM-o-Demo) | 实时音视频、全双工输入输出；[4.5 权重卡](https://huggingface.co/openbmb/MiniCPM-o-4_5)标注 Apache-2.0 | **最值得试的较完整开源全模态对照组**；官方 Demo 资源表记录每 Worker 初始化后约 21.5 GB 显存；量化/Apple 路径须另外验证 |
| [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) | Apache-2.0；原生音视频联合理解与流式输出 | 有现成 cookbooks；属于更重的模型部署，不能用 MoE 激活参数量推算总内存 |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | BSD-2-Clause；VAD、ASR、LLM、视频帧等流式管线的编排 | 若未来做独立实时服务值得借鉴；它不是识别模型，也不是开箱即用抖音扩展 |
| [LiveKit Agents](https://github.com/livekit/agents) | Apache-2.0；WebRTC 媒体运输与 agent 接线 | 多端/多人房间适用；当前单 tab 本地分析无需先部署 SFU/TURN |

截至本次核对，存在这些模块和参考实现，但没有核验到一个能直接替代本项目、同时保证抖音采集、中文低延迟、低成本和自动回复质量的完整开源产品。上述选择仍需目标机器与真实直播对照测试。

MiniCPM-o 的模型下载表列出原模型约 19 GB、GGUF 约 10 GB、AWQ 约 11 GB；其完整 Demo 又列出每 Worker 约 21.5 GB。两者统计范围不同，不能把权重/单模型表值当成应用运行显存保证；Demo 的 A100 单元延迟也不能当普通个人电脑的端到端延迟。[模型表与限制](https://github.com/OpenBMB/MiniCPM-V/blob/main/docs/minicpm_o4dot5_en.md)、[完整 Demo 资源表](https://github.com/OpenBMB/MiniCPM-o-Demo#resource-consumption)。

## 6. 成本：按持续运行核算

### 6.1 已核对的云端单价

以下为 2026-10-24 官方价格页中**华北2（北京）按量原价**，不计限时免费额度、活动折扣和缓存优惠。地域、上下文档位、快照和接口必须匹配，不能用文件转写价格估算实时识别。[百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)。

| 项目 | 单价 | 本文用途 |
| --- | --- | --- |
| `qwen3-asr-flash-realtime` | 0.00033 元/输入音频秒 | 实时 ASR 计费参照；连续 1 小时输入为 1.188 元 |
| `fun-asr-realtime` | 0.00033 元/输入音频秒 | 同类实时备选，非 0.00022 元/秒的文件接口 |
| `paraformer-realtime-v2` | 0.00024 元/输入音频秒 | 更便宜的实时 ASR 对照，连续输入为 0.864 元/小时 |
| `qwen-audio-3.1-asr-flash-streaming` | 输入 6、输出 4.5 元/百万 Token | 当前另有 Token 计费的流式型号；需核对该服务音频换算与真实 usage 后比较 |
| `qwen3-vl-plus`，单次输入 ≤32K | 输入 1 元/百万 Token，输出 10 元/百万 Token | 低频视觉请求的预算参照；不是宣称市场最低价 |
| `qwen3.8-omni-flash-realtime` | 文本/图像/视频输入 1.5、音频输入 6、文本输出 4.5 元/百万 Token | 实时全模态对照；本文不需要音频输出 |

### 6.2 可比较的计算例子

以下请求频率和 Token 数是**显式预算假设，未实测**：每小时 120 次视觉请求，每次包含图片、系统提示与上下文的输入合计 2,000 Token，输出 100 Token。则视觉费用为：

```text
120 × (2,000 × 1 / 1,000,000 + 100 × 10 / 1,000,000)
= 0.36 元/小时
```

| 组合 | 上述假设下的媒体分析 API 费/小时 | 每天8小时、30天 |
| --- | --- | --- |
| 本地 ASR + 本地 OCR + 低频云视觉 | 0.36 元 | 86.40 元 |
| 云 ASR 持续输入 + 低频云视觉 | 1.188 + 0.36 = 1.548 元 | 371.52 元 |
| 较便宜的 Paraformer 云 ASR + 低频云视觉 | 0.864 + 0.36 = 1.224 元 | 293.76 元 |
| ASR、OCR、VLM 均本地 | 无按调用 API 费 | 电力、硬件、安装和维护成本另计 |

这些组合均**不含现有文字回复模型费用、本地算力、电费和网络成本**；把新增转写/视觉摘要加入文字回复输入也会增加 Token。实际完整预算应为：

```text
总成本 = ASR输入计费 + 视觉请求输入/输出 + 文字回复输入/输出
       + 本地/服务器算力、电力与运维
```

把视觉调用从每 30 秒改成每 5 秒，在相同单次 Token 假设下仅视觉部分即变为 2.16 元/小时。优先减少无用调用、限定图像尺寸/ROI 与上下文长度；不能只调低模型单价。

### 6.3 实时全模态不一定更贵，但必须实测多轮账单

按当前官方换算，Qwen3.8-Omni-Realtime 普通输入音频约 7 Token/秒，图片按 32×32 像素计 Token；历史内容仍在上下文时，会在后续响应中再次计入输入。[实时模型计费规则](https://help.aliyun.com/zh/model-studio/realtime#计费规则)。

只算**每份音画首次参与推理**，使用官方估算示例的每 2 秒一帧，假设图像为 640×384（240 Token），则理论音画输入费为：

```text
音频：3,600 × 7 × 6 / 1,000,000 = 0.1512 元/小时
图像：1,800 × 240 × 1.5 / 1,000,000 = 0.648 元/小时
合计：0.7992 元/小时
```

这不是持续对话账单预测，也不是推荐帧率的实测结果。它未包括文本提示、模型输出、历史重计、音画预处理差异和重试。若等量新增输入连续响应 10 轮、历史始终留在窗口且未被裁剪，累计输入相对仅算新增量是 `1+2+…+10` 除以 `10`，即 5.5 倍。

实验时记录每次 `response.done` 的真实 usage；使用短窗口、摘要替代过期媒体、按需创建响应、关闭不需要的语音输出。若其在真实中文直播上的质量和 usage 好于分层方案，应选择它；不能只因“全模态”就排除。上述云模型是商业服务，不能与同系列开源权重部署视为同一种成本或能力保证。

VAD 也不自动等于云账单减半：取决于实际发送和计费秒数、前后卷及持续 BGM。不能不发静音却丢失时序/切断关键词；需按所选服务的会话约定实现并对照账单。

### 6.4 数据量与本地资源

自行推导：16 kHz、单声道、16-bit PCM 为 `16,000×2=32,000 bytes/s`，约 115.2 MB/小时；这还不含 WebSocket/TLS 或 JSON/base64 开销。PCM 走二进制 WebSocket 更直接，供应商若要求 base64 则按其协议。

若每张压缩图片假设 40 KB、5 秒一张，约 28.8 MB/小时；真实字节数取决于内容、质量和分辨率。图像 API 的 Token 不必与 JPEG 文件大小成正比，降低编码质量不能保证等比例降低推理费用。

本地成本不是零：应记录扩展页/Worker RSS、CPU、GPU 占用、播放器掉帧和电池影响。尤其本地 ASR 与 VLM 并跑时，不得只用一次离线推理耗时当作八小时稳定性证明。

## 7. 延迟目标与效果边界

以下是建议的**原型验收目标，不是本机实测值、厂商 SLA 或跨机器保证**：

| 指标 | 起止定义 | 建议目标 |
| --- | --- | --- |
| 首段可见转写 | 本地捕获到有效语音开始 → 第一段有用 partial | 约 0.5–1.2 秒，分别报告 P50/P95 |
| 稳定语境更新 | 本地捕获到句末最后语音 → final 进入上下文 | 约 0.5–1.5 秒 |
| 正常短回复就绪 | 本地捕获到句末/需要回复的弹幕到达 → 完整可发送文本 | 先争取 2–4 秒；另报告发送队列和平台回显延迟 |
| 视觉请求耗时 | 选定帧进入模型请求 → 结构化观察可用 | 先争取 1–4 秒 |
| 画面事实新鲜度 | 画面变化实际发生 → 有相应语境 | 单独统计采样间隔、触发判断、排队与推理；不能直接等同上一行 |

特别注意：若每 30 秒才做一次完整视觉刷新，且变化检测没触发，事实就可能延迟接近 30 秒再加推理时间，不能把它宣传成“1秒看懂画面”。观众问“现在手里拿的是什么”应按需抓新帧；快速动作则升级短序列。

总体验延迟还包含主播推流、平台分发和浏览器播放器缓冲。浏览器方案只能降低**收到媒体之后**的处理等待，无法消除主播到观看端的既有延迟。单独把转写首字、句末确认、模型首 Token、完整回复、发送回显记录下来，避免拿一个较快指标代表整个链路。

效果方面，必须接受并显式处理四种限制：

- BGM、唱歌、方言、多人重叠和稀有昵称会影响转写；VAD 不是可靠的声源分离或说话人身份识别。
- 匿名 speaker diarization 只代表不同声音，不能直接证明谁是主播；视频 PK 分屏也不能保证音画归属。
- ASR + 静态图会损失语气和短暂动作。需要语调、笑声/掌声、打断关系时，加入专门事件检测或实时全模态对照，而不是从转写臆测。
- 好的场控不仅要“识别对”，还要知道主播是否已经回答、是否在讲完整句话，以及此时该不该接话。最终以回复是否合时宜衡量，不只比较 CER/WER。

## 8. 接入现有扩展的具体设计

### 8.1 建议新增边界

以下路径是建议，**本次没有新增运行代码**：

```text
extension/media-offscreen.html / .js      持有捕获轨、音画管线与连接
extension/audio-capture-worklet.js       持续音频读取与轻量缓冲
src/media/capture-controller.js          会话状态、启停、目标tab校验
src/media/asr-provider.js                统一本地/WASM/云端结果
src/media/vision-sampler.js              ROI、采样、变化检测、限频
src/media/context-store.js               语句修订、时效、摘要和缺口
src/media/provider-capabilities.js       流式、视觉、格式/鉴权能力
```

第一轮只需最小捕获、ASR、context-store 三个边界，其余按能力推进，不为原型先搭通用大框架。`extension/background.js` 管理权限、启动与目标校验；修改 `manifest`、popup、build 清单；`src/app.js` 接线；`reply-context.js` 只输出有效媒体信息。

### 8.2 上下文契约

建议每条语音/画面事实至少包含：

| 字段 | 用途 |
| --- | --- |
| `roomId / tabId / captureSessionId` | 换房或重连隔离，禁止串房间语境 |
| `id / revision / isFinal` | partial 替换而非重复追加；慢请求结果不能覆盖更新的版本 |
| `mediaStart / mediaEnd / capturedAt / receivedAt` | 对齐本地音视频，区分录入时间、内容时间和推理完成时间 |
| `source / model / speaker` | 标注 ASR/OCR/VLM；说话人不确定时为 `unknown` |
| `text / evidenceIds / expiresAt` | 短事实、出处和有效期，便于检查“当前”还是“刚才” |
| `quality / gaps / droppedFrames` | 缺口或低质量降级；不支持校准置信度的模型不能随便填概率 |

时间轴由本地捕获样本/视频帧时钟映射到会话统一时钟；平台 IM 到达和媒体播放有不同延迟，不能只按相同 wall clock 就认定是同一瞬间。模型不提供字级时间戳时，用采集片段区间并标为近似；例如 Qwen3-ASR 官方 streaming 当前不返回 timestamps。[Qwen3-ASR 限制](https://github.com/QwenLM/Qwen3-ASR#streaming-inference)。

上下文初值可用最近 30–90 秒、最多 8–12 条稳定语句与一份短摘要；长期事实另存可编辑知识，不让长直播原始转写无限增长。视觉事实默认短期有效，价格/倒计时等快速变化事实要更短 TTL 或强制新采样。数据失效、断线或来源未知时保持未知。

将新增内容放入 `live_context.media`，保留原有事件数据。改造 AI 提示词时明确“只有有效语音/视觉证据才可引用”。新语音可以抑制重复答复，但不能仅凭时间接近就认定它回答了某条观众问题；要结合内容匹配和修订状态。

### 8.3 连接、模型与生命周期

- 浏览器原生 `WebSocket` 构造器不能任意添加 `Authorization` 头。需要供应商支持的浏览器协议，或本地/服务端网关；不能把服务端 SDK 连接示例直接复制进 offscreen。Qwen 当前提供 WebRTC SDP 交换及 AOQ 服务端换临时令牌的路径，按该模型/地域文档接入。[Token 鉴权](https://help.aliyun.com/zh/model-studio/realtime-token-authentication)。
- 本地 ASR 服务绑定 loopback，验证扩展来源和会话令牌；它不需要任意网站都能访问。已有 localhost 可选主机范围仍需用户授予，且要在目标 Chrome 版本验证本地网络访问行为。
- WASM/Worker 随扩展打包，启用需要的 `wasm-unsafe-eval` CSP；不从 CDN 动态拉取可执行 JS/WASM。模型权重作为数据缓存，限制容量并提供清理。[扩展 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)、[远程代码政策](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)。
- ASR 不堆无限队列。识别追不上实时音频时展示延迟、限制缓冲、明确记录缺口并降级；视觉优先保留最新待分析帧，过时的积压帧丢弃。
- 媒体推理失败不能阻塞礼物入账与原有弹幕。默认只保留有界内存片段，不把 PCM/连续截图塞进原协议日志；是否保存原始媒体、云端发送和文本保留时长由单独开关说明。
- 页面媒体、OCR、转写全部是不可信现场内容，不得因为识别到一句“禁言某人”就当工具指令执行；先只供语境与回复建议。

## 9. 实施顺序与验收

### 阶段A：只验证听得到、分得清新旧

使用一个明确的授权按钮开启单房间音频捕获，展示 partial/final、音量、断流、识别落后秒数；本地 sherpa-onnx streaming 与云 ASR 同一音频做对照。只给 AI 注入稳定转写，先观察回复建议。

验收重点：原声仍可播放；句首不丢；静音不编字；中文实体可读；结束/换房不串语境；手动停止后媒体轨和请求确实停止；重载后的缺口可见。

### 阶段B：用稀疏视觉补足“这个/刚才”

加入直播区裁剪、本地帧差、OCR、每小时独立预算和按问题补帧。分别记录静态长镜头、游戏/跳舞、带货文字场景的命中与漏检。只有多帧才回答动作过程，显示语境最近更新时间。

### 阶段C：同样素材比较全模态

对照 MiniCPM-o 4.5 和当前实时全模态 API，比较 BGM、多说话人、笑声/语气、音画指代和整段会话账单。若主要收益只在少量片段，则按需升级；若持续方案质量、实际费用和维护均更优，则改为主路线。

### 可重复测试集

先取有权用于测试的 20–30 分钟代表性片段，覆盖普通话聊天、方言/口音、音乐、PK/连麦重叠、无人说话、快速切画面和商品小字；固定相同输入逐方案回放。人工标注关键实体、有效问答、谁在说话未知的区间、重要画面变化，以及主播已回应的观众问题。

| 测试维度 | 记录内容 |
| --- | --- |
| 识别 | 中文 CER、礼物/主播/商品名等实体准确率；漏词、无声幻觉、final 修订次数 |
| 延迟 | 采样→partial / 句末→final / 弹幕→完整回复 / 回复→回显，P50与P95分开 |
| 语境 | 过期事实引用、串房间、错把嘉宾当主播、重复回答、没必要接话的比例 |
| 视觉 | 重要变化召回、OCR 关键字、短动作漏检、页面覆盖物误识别 |
| 费用 | ASR 实际计费秒数、逐请求 Token、全模态每轮 usage；包含失败/重试 |
| 长跑 | 至少2小时稳定性，再做8小时待机/后台/播放器暂停恢复；CPU、RSS、掉帧、队列最长积压 |

选择门槛建议先看“显著减少无依据/重复回复，且不打断原采集和播放”，再在合格方案中比较完整成本与 P95 延迟。当前调研只证明有合理的实现路线和可复用模块，尚不能承诺某个模型在本机或真实抖音直播上的识别率、稳定性或响应时间。

## 10. 本次调研产出

已完成官方能力、开源项目、价格、当前源码接入点与验收方法核对；没有开启用户直播捕获、上传媒体、安装模型或改变扩展权限/运行逻辑。下一步最小工程范围是阶段A：单房间、显式启停、中文流式 ASR、稳定语境注入和延迟/缺口展示。
