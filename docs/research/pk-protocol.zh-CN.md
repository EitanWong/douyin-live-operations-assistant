# PK 比分协议核对

核对日期：2026-10-18。对应 `src/browser/protocol.js`、`src/pk/model.js` 及协议、状态和引擎集成测试。

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
