# AI 规则与多模态接入依据

核对时间：2026-11-01，北京时间。以下是公开资料核对和实现边界，不代表平台全部现行规则或特定账号拥有相应模型权限。

## 官方公开来源

- [抖音直播行为规范，页面标注更新于 2024-08-14](https://lf26-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/webcast_union_doc/45f1ccff-f8ef-4651-8dd5-e5d3e79ae115.html)：已读取全文。覆盖基本内容规范、直播行为和处罚，不当诱导消费、拉踩引战、连麦恶俗互动及危险行为均有约束。内置数据是短摘要，不复制全文，不由此推导统一 PK 换分或任务条件。
- [抖音用户服务协议，页面标注更新于 2026-02-13](https://www.douyin.com/draft/douyin_agreement/douyin_agreement_user.html?id=6773906068725565448)：已读取；平台可修订规则，用户内容需要合法、真实并保护他人隐私。它不提供统一 PK 计分公式。
- [OpenAI 音频指南](https://developers.openai.com/api/docs/guides/audio)及[Chat Completions 音频输入示例](https://developers.openai.com/api/docs/guides/audio-chat-completions)：已读取。音频输入使用 `input_audio` 与 WAV 数据，和普通文本模型的输入能力不同；本实现保留用户显式填写模型。

## PK 规则的适用边界

公开规范确定行为底线，不能代替局内活动或赛季规则。已有项目调查还区分局内加成任务与每日段位任务；目标场数、首胜、有效胜场、跨日归属都不能从本机观测总场数推导。

因此规则资料分为 `official` 和 `assistant-boundary`。前者保留公开来源、发布日期和核对日，后者只说明本助手无法推断的事实，不冒充官方条款。新政策、活动细则、分值和结算条件缺少资料时，优先查询官方来源，仍不足则回答无法确认。

## 实现选择

原有 Chat Completions 通道与博查 / Tavily / SearXNG 搜索协议继续使用。记忆保存到房间配置，在边界验证结构、大小和到期日，查询时按相关性取有界记录。用户资料从 system 指令中移到 user 数据包。

媒体通过用户主动点击后的浏览器 `getDisplayMedia` 获取所选共享画面和可选标签页音频；不读取麦克风。画面缩小后上传，音频由 MediaRecorder 独立分段、浏览器解码及重采样后编码为 WAV。每路最多一个在途请求，停止使用会话代数撤销迟到结果；清空另设时间边界。原始媒体不持久化。

音视频是近实时采样，没有 Realtime WebSocket 会话，也没有自动在浏览器重载后恢复授权。浏览器测试中的识别文字来自模拟模型，不能当作供应商模型准确率或真实直播验收。完整配置步骤见 [AI 使用说明](../guides/ai-context.zh-CN.md)。
