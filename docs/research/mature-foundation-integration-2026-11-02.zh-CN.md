# 成熟底层组件接入与替换记录

日期：2026-11-02。沿用[先前开源调研](open-source-foundation-2026-11-02.zh-CN.md)，本轮接入实际运行路径，保留原始主题和 32 套配色、三种材质以及现有设置格式。

## 采用的方案

| 能力 | 实际接入 | 替换内容与边界 |
| --- | --- | --- |
| 表单布局 | 已有 Mantine 9.7.4 的 SimpleGrid / Stack | 字段按容器自动排列；AI、外观、运行规则、主播管理、内容治理使用连续阅读的设置卡片，避免短卡片旁长期空白。新界面接管时暂停旧 WorkspaceGrid 的 ResizeObserver 和行跨度计算，组件失败回退时恢复；图表仍可测量 |
| 本地知识检索 | [MiniSearch 7.2.0](https://github.com/lucaong/minisearch)，MIT | 取代手写 BM25 排序、词频和文档频率计算；库负责倒排索引、BM25+、英文前缀与拼写容错。Intl.Segmenter 与中文双字补充负责中文切词；短中文词不做模糊匹配。原文分块、偏移、来源、核对时间、到期/停用、房间隔离和上下文预算仍为领域规则 |
| 持久存储 | [Dexie 4.4.7](https://github.com/dexie/Dexie.js)，Apache-2.0 | 取代手写 IndexedDB 请求与事务回调；使用原数据库、原生 version 1、records/metadata 表及 journalOrder 复合索引。Dexie 版本 0.1 对应原生版本 1。新建库也保留旧索引名字，支持旧读取器回退；业务事件、账本和用量统计在事务提交后才算成功 |
| 感知会话 | [XState 5.33.3](https://github.com/statelyai/xstate)，MIT | 每个 LiveMediaAnalyzer 独立 actor；idle → active.starting → active.running。active actor 统一持有采集资源与 AbortController；退出时中止请求和释放资源，迟到采集器立即释放。保留每类采样最多一项在途、忙时丢帧、三次失败/额度用尽停机，不新增自动重连或重试 |
| AI 流式响应 | [eventsource-parser 3.0.6](https://github.com/rexxars/eventsource-parser)，MIT | 取代按行切分的 SSE 解析，按事件边界支持多行 data、CRLF、注释与 BOM。保留 [DONE] + finish_reason=stop 的完整性要求。通过现有扩展/油猴请求网关接收响应，再解析完整返回体；本轮不声称实现了逐 token 的 UI 流式展示 |
| 模型输出契约 | 已有 Zod 4.6.7 | 对流式文本字段做类型校验，拒绝数字等非文本内容；意图使用 discriminatedUnion，限定搜索、跳过与直接回复各自合法的 query/reply 组合。jsonrepair 只修复 JSON 语法，修复后仍需通过 Zod |

这些包从官方 npm 包安装并锁定准确版本，不运行远程脚本，不增加扩展权限。生产产物包含依赖许可证及 Dexie NOTICE。npm 元数据和官方 README 快照保存在 `output/mature-foundations-2026-11-02/`；本次生产依赖 audit 无报告漏洞，不是无漏洞保证。

## 版本与技术取舍

本次 npm 元数据中 Dexie 4.4.7 发布于 2026-10-19，XState 5.33.3 发布于 2026-10-17；MiniSearch 7.2.0 发布于 2025-09-16。MiniSearch 是成熟、稳定的本地索引库，不能表述成近期频繁发布；其选择依据是当前知识容量、同步本机运行、可控中文行为、MIT 许可和实测结果。eventsource-parser 最新 4.1.3 要求 Node >=22.12，项目声明 Node >=20，因此采用仍兼容该声明的 3.0.6（Node >=18）。不为追随最新版强行变更项目工具链。

- 当前知识库上限仍为 40 条 / 20000 字。这里选择 MiniSearch 而不是同时引入 Orama：目前没有 embedding 来源、向量维度、索引迁移和真实语义召回数据；不能安装一个库就声称已完成向量或混合 RAG。未来需要语义检索时，用明确的中文问答语料比较后再替换检索适配层。
- 保留原始 FLV/HLS 读取和 hls.js/mpegts.js 解码。XState 管理资源生命周期，不替代协议与模型音视频适配；浏览器签名、账号权限、CDN 跨域和编码限制仍然存在。
- 普通回复、媒体识别、搜索继续经过已有授权网关。AI SDK 没有在本轮接入：现有普通调用共享 Chat Completions 协议，而 Omni WebRTC 有独立协商与确认流程。新增 provider 框架并不能直接替代它，暂时会并存重复适配。
- 不新增 p-queue、TanStack Virtual 或 WXT：实时采样已经有明确丢帧背压，送达和计费路径不能随通用队列重试；当前表格已有分页，虚拟化需按实际数据量决定；构建迁移不与持久存储替换捆绑。

## 验证与实施边界

先编写并复现失败测试：重复批次存储计数、停止时在途请求取消、标准多行 SSE、Unicode 分块、前缀/拼写容错、分支不一致的模型意图、新界面接管/失败回退。进一步覆盖事务回滚、跨连接并发计数、迁移中断重试、旧库与新库向旧读取器兼容、会话错误与资源释放。

固定八项小型检索语料中，原实现命中预期第一条或正确无结果 6/8，MiniSearch 为 8/8；新增通过的是英文前缀和拼写容错。不是普遍召回率、语义理解或生产性能证明。既有中文来源引用、资料有效期、上下文重建与预算测试继续通过。

工作区全量测试 1022 项通过；实际浏览器桌面/390px 各 19 页无横向溢出，知识库入口已实测拼写容错与来源展示。只包含本任务的独立版本结果、最终提交和 Chrome 状态见[行动日志](../development/action-log.zh-CN.md)。crapper、dryer、mutator 不可用，未执行。

UI 仍通过原控制器维护草稿和业务操作，兼容桥尚在；旧模板与额外图表实例并未全部移除。本轮没有把已安装库等同于整仓重写，也没有证明真实百炼长时间直播、生产性能和付费操作。所有模拟验收不发送真实弹幕、不调用付费模型。
