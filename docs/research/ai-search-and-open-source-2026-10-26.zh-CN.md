# 直播数据问答、联网搜索与开源组件

日期：2026-10-26。

观众提问先由当前配置的模型识别 `live-data`、`web-search`、`chat`、`clarify` 或 `skip`，随后读取直播上下文、调用搜索服务、直接回答或澄清。无需固定触发词；无需模型服务提供专用 function calling。联网结果整理复用现有 Chat Completions 通路。

## 已接入

| 项目或服务 | 用途 | 接入方式 |
| --- | --- | --- |
| [博查官方公开 MCP 实现](https://github.com/BochaAI/bocha-search-mcp/blob/master/src/bocha_search_mcp/server.py) | 核对官方 Web Search 的请求与响应契约 | 独立实现浏览器适配：`POST /v1/web-search`，Bearer 鉴权，`query/count/summary/freshness`，读取 `data.webPages.value` 的标题、URL、摘要和发布时间。未复制或打包其 Python 服务源码。 |
| [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search) | 可切换的搜索服务及兼容网关 | `POST /search`，Bearer 鉴权，基本搜索；关闭服务端答案与完整网页正文，只取有界来源摘要供当前模型回答。 |
| [SearXNG](https://github.com/searxng/searxng)，AGPL-3.0 | 开源聚合搜索，可接自建实例 | 依照[官方 Search API](https://docs.searxng.org/dev/search_api.html)，`POST /search` 使用表单 `q/format=json/pageno=1`，通常不需要平台密钥；实例需开启 JSON 格式。仅通过 HTTP 调用，不复制或嵌入其服务器代码。 |
| [jsonrepair](https://github.com/josdejong/jsonrepair) 3.15.0 | 修复模型结构化意图输出中的缺引号、单引号、尾逗号等语法问题 | 直接安装并打包到扩展与用户脚本，ISC 许可证。修复后严格校验字段、意图枚举、搜索词和回复长度；未知意图或额外字段拒绝执行。无运行时 CDN 或远程代码。 |

博查与 Tavily 的服务调用需要各自的密钥。开源客户端代码不等于免费搜索额度，也不等于开源搜索索引。选择自建 SearXNG 时需已有可用实例；使用博查或 Tavily 不需要额外运行 Python 或 MCP 服务。

## 可继续扩展的项目

| 项目 | 评估 |
| --- | --- |
| [Vercel AI SDK](https://github.com/vercel/ai)，Apache-2.0 | 适合后续增加多步工具调用、流式回答和服务端 agent。当前扩展已有受限域名权限、跨后台消息转发和 GM 请求通路，本次保留这些通路，采用有界的意图识别与单次检索。 |
| [Tavily JavaScript SDK](https://github.com/tavily-ai/tavily-js)，MIT | 官方 SDK 可用于未来独立的 Node 服务。当前搜索接入层需要经过扩展后台授权和 GM 请求转发，直接按公开 HTTP 契约接入，保持两个浏览器版本一致。 |
| [Bocha MCP](https://github.com/BochaAI/bocha-search-mcp) | 可作为未来桌面或服务端 MCP 工具源。当前仅使用其公开接口契约作核对，没有向浏览器加入本地进程执行能力。 |

## 数据与执行范围

主播在线人数、当前礼物、最高单价礼物、送礼贡献、时长、PK、任务和展馆来自已有采集与账本。礼物和 PK 的昨日、今日、周、月、季、年和累计汇总先全量计算，再截取近期明细；未知、过期、估算与榜单补差保留口径。历史读取当前主播账本，独立于面板选择的其他房间或月份。

搜索只发送模型生成的必要查询词。搜索密钥与模型密钥按服务域名分别保存；不写进模型提示、配置导出或来源记录。后台只转发指定搜索协议的请求；不按搜索结果 URL 抓取任意网页。来源 URL 限 HTTP/HTTPS，不执行网页摘要中的指令。

每次联网问答最多一次搜索与两次模型请求；模型请求分别计入现有额度。搜索独立限额，失败不自动重试；暂停、切主播、切直播场次或下播后，旧回复不能继续发送。公屏引用序号需对应实际返回的来源，完整链接在面板查看。

## 验证边界

自动化覆盖博查、Tavily 与 SearXNG 的请求、鉴权和响应适配、意图 JSON 修复与拒绝、两次模型调用预算、错误与零结果、来源隔离、真实账本投影以及跨场失效。服务测试使用固定响应，不需要或读取用户真实密钥。真实账号的联网搜索效果仍需填写密钥或实例地址后通过面板“测试联网搜索”和直播弹幕验收。
