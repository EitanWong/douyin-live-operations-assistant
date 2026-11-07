# 持续研究能力、证据与剩余缺口

核对对象：当前 `dev` 实现及本任务已有验收记录。此表分别记录实现、已执行证据和未验证部分；历史验收沿用原回执，本次没有重跑真实下载、模型推理或长期调度。已有开源选型见[Harness](../development/browser-agent-harness.zh-CN.md)、[公开资料研究](../research/deep-public-evidence-2026-11-07.zh-CN.md)与[本机知识图谱](../research/knowledge-graph-local-2026-11-06.zh-CN.md)。本次复用 MiniSearch、Zod、LangGraph 和既有来源片段机制，无新增依赖。

## 需求映射

| 需求 | 当前实现与源码 | 已执行的证据 | 实际边界 / 剩余缺口 |
| --- | --- | --- | --- |
| 加强联网搜索、成熟供应商与公开API | `src/services/search.js` 支持 Bocha、Tavily、SearXNG；`public-data.js`、`weather.js` 提供具名工具和参数校验；Readability/linkedom读取正文，MiniSearch检索原文 | `mature-retrieval`、`public-data`、`web-research`、`web-knowledge`测试；[公开API真实核实](../development/public-data-tools.zh-CN.md) | 供应商需配置/权限并受限流；SearXNG需自建。天气/汇率等按时效现场查询，不把所有API响应永久记作稳定常识。尚无跨供应商的大规模真实问题召回率基准 |
| 主播公开主页、作品、评论与关联账号 | `extension/account-research.js`、`src/ai/account-context.js`：稳定UID/secUID核对、实际加载页面采样、分级额度与去重 | `account-research`、`profile-research-flow`、`profile-knowledge`及既有浏览器验收 | 登录、验证、未加载、未授权均为未知；没有全量遍历任意主页或跨平台身份自动认证。已研究 jiji262/douyin-downloader，未将其CLI接为生产下载后端；当前采用已有页面归属的下载链路 |
| 视频音轨、视觉、重点原文入库与索引 | `extension/public-media-research.js`、`native/public_media_source.py`、`public_media_worker.py`、`public_media_frames.py`：HTTPX下载、FFmpeg、完整音轨分段及有界关键帧，结果进入唯一原文库 | `public-media-knowledge-flow`、`public-media-visual-flow`、`public-media-session-flow`；既有真实媒体SHA `5db5a0a730539b8ac2f8907cf64ba7ece909d834de83a9c4e7c6fd5bc57931e2`，五段转录和三帧观察 | 完整音轨不等于完整连续视觉分析；机器文本待核实、说话人未知。独立人工字幕/视觉真值及CER/WER未完成，不能宣称商业识别准确率 |
| 精确人物档案与关系图谱 | `audience-profile.js`、`person-dossier.js`、`relationship-library.js`：按稳定主体、来源、时效、明确陈述与观测互动重建；ECharts展示，Dexie/SQLite持久索引 | `audience-profile`、`relationship-library`、`relationship-query`、`relationship-memory`和[人物档案验收](person-dossier-2026-11-07.json) | 研究subject不是网页作者认证，提及/互动不证明私人关系。保存可核对事实和自述，不从礼物、衣着、歌词推定人格、心理诊断、财富或私密身份；不做隐私挖掘或欺骗性社工 |
| 长期记住观众原话及删除恢复 | `src/ai/audience-memory.js` 的 `snapshot()` 保存已观察的全部原话，查询按相关性和预算披露；遗忘水位、主体版本防止旧任务回填 | `ai-memory-agent`、`live-memory-continuity`、`live-memory-archive`测试；既有真实Chrome IndexedDB重开、遗忘与持久化验收 | 查询的3条明细限制不等于只存3条；30天礼物/活跃窗口不等于30天删除全部原话。未采集发言不能补造。真正多日实播、磁盘容量与实际安装仍待验收 |
| 后台Harness持续循环、额度、断点和取消 | `AgentHarness`、LangGraph `StateGraph`、Dexie检查点、`continuous-research.js`、`extension/ai-background.js`；XState管理任务生命周期，单写者拥有知识与遗忘版本 | 既有受控48小时/3房间/288任务/24重建；真实Chrome三次生产一分钟alarm、三次worker停止、浏览器重开、关闭研究后1ms收到abort | 受控时间不是实际48小时。浏览器关闭时暂停，MV3唤醒可能延后；真实多日实播未完成，不保证全天不间断运行 |
| 前台按资料准确回复，保留音画原文与来源限制 | `automatic-knowledge.js` 按网址组合至多3段；`source-evidence.js`统一引用格式和范围；`intent.js`接受有界复合引用；`edge-prompt.js`按完整候选控制预算 | 本次 `compound-knowledge.test.mjs`：单次问答、逐段删除/到期/范围校验、旧引用兼容、非法引用拒绝、来源分散和端侧完整投影；复用原8条真实媒体记录执行同输入三态事务 | 本次修复的是已观察的检索/交付遗漏；规划响应为夹具，不能当真实模型语义正确率。至多3片段不能代表读完所有视频。模型候选期间失效后，现有重新搜索仍需专门核验搜索词质量 |
| 商业级稳定性与回复自然度 | 共用 `reply-style.js` 和引用/时效校验；原有Promptfoo场景、完整JS/native回归与CI | 每次实际全量结果及提交见[行动日志](../development/action-log.zh-CN.md)，本机详细字面回执位于 `output/deep-research-2026-11-07/` | 自动化通过不等于商业质量认证。独立人工参考、真实模型事实性/礼貌盲评、真实安装和长期直播仍缺；历史 `native/host.py:174` 图像新鲜度故障尚无稳定复现根因。crapper/dryer/mutator不可用、未执行 |

## 本次可检查的产品变化

原来“整个夏天和贝雷帽”一次知识查询仅交付同一视频的一段音轨；另一段视觉原文因为 `maxPerSource:1` 被排除。只放开检索仍不足：前台意图一次只能选择一个候选，而且端侧原来的200字符截断会再次丢失后面的证据。

现在同网址相关片段组成一个有界候选，复用 `mergeSourcePassage` 保留独立来源、偏移、日期、到期和范围。前台仍选择一个候选、复核一次、使用一个引用，但复核内部必须确认所有组成片段有效。每网址至多3段、每段600字符，全局至多8段、6000原文字符；端侧可以因token预算省略整项。复用不改原人物归属，不延长保存期限，不把机器判断升级为已核实事实。

本次事务沿用原四角色，新增复合检索检查点：相同8条媒体输入在父实现上遗漏音画组合，在修改版上同时交付并拒绝已删除片段，独立修改副本回滚后恢复父行为。前16组历史结果保留，不宣称全部重跑。原始媒体、原知识记录和最初基线档案保持原字节。

## 后续验收顺序

1. 独立复现“候选在生成期间失效”后的前台回退，检查外部搜索实际收到的查询，不能将内部引用ID误当语义搜索词。
2. 使用独立人工字幕、逐帧事实标签和真实模型回答评估检索召回、引用支持、条件保留、CER/WER与未知判断。既有机器输出不得自充真值。
3. 在实际安装、真实直播与多日运行中验证吞吐、容量、断网、浏览器更新/重启、取消与遗忘。发现真实问题后再按证据修复，不以反复跑已通过夹具替代。
