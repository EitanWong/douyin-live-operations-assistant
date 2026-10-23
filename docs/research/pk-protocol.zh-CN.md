# PK 比分协议核对

核对日期：2026-10-19。对应 `src/browser/protocol.js`、`src/pk/model.js` 及协议、状态和引擎集成测试。

## 字段证据

使用抖音直播网页发布的 protobuf 解码表核对字段，而非按字段值大小猜测语义：

- [live-schema-im.e322bd8a.js](https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/live-schema-im.e322bd8a.js)
- 下载文件 SHA-256：`232a3d3890052ebe868b4b14aca38918730285adbc0f623c77dc8bdaafbc783b`
- 网页 runtime 对应 chunk 2403；页面 bundle 中的协议版本为 `2026.4.24`。这是此次核对的网页版本，不能推断后续版本字段不变。

| 消息或结构 | 字段 | 用途 |
| --- | --- | --- |
| `WebcastLinkMicMethod` | 17，重复 `UserScores` | 各主播累计比分 |
| 同上 | 104 / 114 | battle_id / battle_id_str；字符串优先 |
| `UserScores` | 1 / 2 / 21 | score / user_id / user_id_str |
| 同上 | 4 / 7 | score_relative_text / score_blur_text |
| `WebcastLinkMicBattleMethod` | 2 / 6 | BattleSettings / 主播 UID 到 BattleUserInfo 的映射 |
| `BattleSettings` | 2 / 42 | battle_id / battle_id_str |
| 同上 | 3 / 4 | start_time_ms / duration（秒） |
| `BattleUserInfo` | 1 / 13 | BaseUserInfo / room_id 字符串 |
| `BaseUserInfo` | 1 / 2 / 5 | user_id / nick_name / user_id_str |
| `WebcastLinkMicBattleFinishMethod` | 2 / 4 / 12 | BattleSettings / 重复 BattleScore / 主播映射 |
| `BattleScore` | 1 / 2 / 8 | score / user_id / user_id_str |
| 同上 | 11 / 12 / 15 | score_relative / score_relative_text / score_blur_text |
| `webcast.data.User` | 4 / 7 / 1014 / 1015 / 1045 | `gender` / `birthday` / `birthday_description` / `birthday_valid` / `age_range`；年龄只由明确有效的完整生日推算，`age_range` 不等于岁数 |
| `WebcastLinkmicPlayModeUpdateScoreMessage` | 5 / 6 / 7 / 9 | anchor_id / from_user_id / to_user_id / hot_score |

`PlayModeUpdateScoreMessage` 的字段 6 是送礼用户 ID，字段 9 是单次热度更新，不能直接当作累计比分。旧参考 proto 将字段 6 标成 `score_self`，与当前网页解码表冲突。`LinkMicArmies` 属于贡献榜，也不能相加代替官方累计比分。普通连麦、布局更新和未核对的 Battle 类型不再建立战局。

## 数值与归属

- 优先使用显式 score；relative/blur 文本和标记即使存在，也不代表显式总分无效。公开样本中既有 `score=65249` 配 `score_blur_text="65249"`，也有 `score=1273262` 配 `score_blur_text="100万+"`。
- score 未传时，只接受纯数字显示文本；`100万+`、`领先46161` 不转换成精确分数。既无 score、又无显示文本或相对标记时，按 protobuf 默认零值处理。
- 无有效主播 UID 的记录不参与比分；UID 和战局 ID 全程保留字符串。超出 JavaScript 安全整数范围的分值不显示。
- 己方按自动识别或配置的主播 UID 匹配；也可由参与者的真实房间 ID 匹配。只有明确的对手 UID 或唯一另一方才归为对方，不按列表先后顺序猜测，多人 PK 不强行折算为 1 对 1。
- 外层消息 ID 仅用于去重，不是 battle_id。中途入场先收到比分即可激活状态；没有 battle_id 时按主房间关联，再收到真实 battle_id 时合并临时状态。
- 首次快照作为速度基线；重复开始消息保留比分，重复结束不重复记样本。双方比分未完整观测时，预测保持未知，结束也不制造平局记录。
- PK 快照升级至 version 2；恢复 version 1 时清除旧启发式比分、倒计时和胜负样本，保留贡献者、弹幕及人工倍率/卡片记录。收入账本、主播配置不属于此次迁移。

## 验证范围

协议回归包含 64 位 UID、双方顺序颠倒、零分、数字/模糊显示文本、开始/结束字段以及 gzip 混合消息。集成回归覆盖 gzip 推送 → 解码 → 暂停中的引擎 → PK 状态，并验证消息去重。

另对 [opedium/douyin-live-proto 的公开样本](https://github.com/opedium/douyin-live-proto/tree/master/sampled_payload)作字段交叉核对；部分 LinkMicMethod 样本移除了主播 UID，因此不以数组顺序恢复身份。此次未完成更新后真实直播 PK 比分与平台画面的逐次对照；自动测试不等于线上推送验收。


## 2026-10-19 采集扩展与延迟隔离

本次继续对同一 SHA-256 的官方网页 schema 做静态字段核对；本地副本为 `/tmp/douyin-pk-bundles/live-schema.js`。REA `analyze_javascript_application` 对已下载 bundle 目录的分析请求在 300 秒超时，未返回可引用的 Evidence ID。因此以下证据来自本地原始发布文件的解码表和页面协议别名表，不声称完成 REA 应用图分析或真实直播运行观察。

| 发布文件中的结构（字符偏移，零起始） | 已核对字段 | 实现用途 |
| --- | --- | --- |
| `LinkMicMethod.UserScores`（547962 后的嵌套结构） | 15 `buff_score_ratio` / 16 `contribute_count` / 17 `score_version` | 附带原始比例、参与贡献人数和版本字符串；比例不直接换算成倍率 |
| `LinkMicMethod`（547962） | 16 `duration` / 26 `start_time_ms` / 82 `score_update_log_id` / 22 主播 UID→`ContributorList` | 比分带明确时钟时恢复倒计时；贡献榜独立输出，不替代累计比分 |
| `LinkMicMethod.Contributor`（558272） | 1 `score` / 2 `rank` / 3 `user_id` / 4 `User` | PK 贡献分、名次与用户资料 |
| `BattleStateSyncMessage`（140037） | 2 `webcast.im.BattleSettings` / 5 `score_version` | 重连/中途入场时同步时钟；不伪造比分 |
| `LinkMicArmies`（521643） | 2 主播 UID→`UserArmies` / 4 `BattleContributorsRankListV2` | 兼容明确归属的旧榜与 v2 榜；字段 3 的匿名顺序列表不猜所属主播 |
| `UserArmy`（521643 后嵌套结构） | 1 `user_id` / 2 `score` / 3 `nickname` | 旧贡献榜真实值，缺少精确 score 不猜测 |
| `BattleContributorsRankListV2`（1807686） | 1 字符串主播 UID→`BattleAnchorContributors` / 3 `webcast.data.BattleSettings` | v2 贡献榜与战局时钟 |
| `webcast.data.BattleSettings`（1774344） | 1 `battle_id` / 2 `start_time_ms` / 3 `duration` / 42 `battle_id_str` | data 结构与 im 结构字段不同，分别解析 |
| `BattleAnchorContributors`（1806993） | 1 重复 `BattleRankUser` / 2 `total_count` / 3 重复 `BattleBuffCardInfo` | 贡献榜、总人数、生效道具 |
| `BattleRankUser`（1806366） | 1 `User` / 2 `score` / 3 `rank` | 用户实际贡献分与名次 |
| `BattleBuffCardInfo`（1846804） | 1 `battle_buff_card_type` / 2 重复 `BattleBuffCardMeta` | 有明确开始和结束时间的生效卡 |
| `BattleBuffCardMeta`（1846039） | 1 `battle_buff_card_type` / 2 `effect_json` / 3 `effect_start_time_ms` / 4 `effect_duration_ms` | 输出真实毫秒窗口和原始类型码，不猜 JSON 字段含义、卡名或加成倍率 |

`3767.e87f0311.js` 字符偏移 438292 的协议 `relation` 显式将 `LinkMicArmiesMethod` 映射到 `LinkMicArmies`；其 SHA-256 为 `2db0082fda342d545617963e3e9b3666485ec88b0b10c2086a9ac7ac956913d1`。`client-entry~1.28f20eec.js` 字符偏移 422776 的消息常量包含 `WebcastLinkMicArmiesMethod`；其 SHA-256 为 `2e17fd6a60becfa5029d9e3970cffe91314a54d743ad43e3b57ee30f2a11a5e2`。偏移是 UTF-8 解码后的 JavaScript 字符偏移，不是字节偏移。

事件契约：`pk-contribution` 每主播一条，包含 `anchorId`、`contributors:[{user,score,rank?}]` 以及可用的 `battleId/startedAt/durationMs/endsAt/contributorCount`；`pk-effect` 包含目标 `anchorId`、`effectType:'card'`、原始 `cardType`、`startAt/endAt/durationMs`。从同一消息拆出的事件 ID 增加类型与主播后缀，避免双方贡献被去重为一条。`decodeFrame` 将多事件展开为普通事件数组，并继续隔离损坏消息。时钟同步为 `pk-score` 携空 `scores`；分析模型不得据此制造零分或复活已结束战局。

WebSocket 解码保持到达顺序；新增可选只读 `onPK` 观察回调，在交给普通 `onEvent` 持久化前完成。两个任务链分开，慢存储不会阻塞下一帧比分解码。全部原始事件依旧按序交给 `onEvent`。待交付总帧数最多 256，原始帧总字节最多 16 MB；超限显式累计 `frameGaps`，不无限积压。MAIN 桥接的 PK 只读事件在 content 就绪后直接发布，普通事件保留原有背压；初始化前队列仍受 4096 条/8 MB 限制。另以 16 MB 估算预算保留已解码事件缓存（JSON UTF-16 字节估算），超过预算的帧不保存解码结果，普通交付轮到时重解码一次，不重复执行 PK 回调或重复累计解析错误；原始事件不丢弃。诊断追加 `pkEvents/pkScoreEvents/lastPK/lastPKScore/decodedCacheBytes/uncachedFrames`，记录到达/解码时间与服务端时间偏差。

仍未取得或无法核实：`TeamTask.Reward` 虽包含 `current_reward_buff_multiple` 以及相对战局结束的秒数，但已下载页面消费 bundle 未找到比例换算和相对秒符号的依据，不据字段名推断实际倍率窗口；`effect_json` 内部格式、道具类型枚举对应名称、非公开贡献用户、未下发的对方完整榜单均不补造。此版本未对真实直播逐次比分和平台画面做对照，也未主动发消息、调用额外账号接口或操作账号。

新增回归覆盖榜单双侧 UID、贡献/累计分分离、两种 settings 字段、道具毫秒窗口、拆分事件去重 ID、混合帧损坏隔离，以及普通订阅等待时后续 PK 仍及时观察且高峰帧上限有效。另覆盖 gzip 解压放大时的缓存预算、超限重解码不丢普通事件及错误不双计、初始化积压的旧开始被结束快通道超越后不复活战局。
