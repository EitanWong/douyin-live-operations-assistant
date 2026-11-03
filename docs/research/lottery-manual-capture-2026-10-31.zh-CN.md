# 福袋手动参与真实抓包记录

采集日期：2026-10-31，北京时间。用户在原生直播页面手动点击参与并报告成功；本次只观察、导出和离线解析，没有重放请求或代替用户报名。

## 本轮身份与证据

- 页面直播间：`260440030123`；主播 UID：`4007055676415213`。
- 实际 room_id：`7702463172476701483`；lottery_id：`7702514039720839955`。
- 奖品：30 钻石、3 份；条件文字为“粉丝团点亮”“发送口令: 开心最美唱歌最好听”“手动参与”。
- 全部原始材料保存在本机忽略目录 `output/douyin-fudai/2026-10-31/`。原始请求 URL 保留当时的签名和令牌，只保存在本机；研究记录不复制其值。没有请求或导出 Cookie、Authorization 等登录请求头。

| 材料 | 范围 | SHA-256 |
| --- | --- | --- |
| `complete-round-network.har` | Chrome 脱敏 HAR，1,369 条；01:40:06.468—01:49:07.766；67,965,788 字节 | `e56f7a4e89bedbdd17d922c325bbca4b7f3a9e8055084c4246f32ced89ac6cda` |
| `recovery-after-participation.raw.json` | 参与后的恢复数据，982 条协议帧 | `ae44b0d4d22dcb5209980e1a33cde9fc83dcf06321a5c7c525fdf63ff1267ebf` |
| `recovery-after-draw.raw.json` | 开奖后的恢复数据，953 条协议帧，与上一份存在重叠 | `8dc3151d3bbaba9b77527ae8b3834d67eb460de5f6c9fa35234df04e9031e587` |

另存 `participation-network.har` 作为首次导出的检查点。`lottery-http-complete.raw.json` 提取了最终 HAR 中 7 条福袋查询、参与和口令请求，完整保留请求、响应及原始 HAR 索引；每条还分别保存 `.request.json` 和 `.response.json`。`timeline.json` 提供时间线，`lottery-evidence.json` 保存本轮结构化消息，`protocol-analysis-complete.raw.json` 保存完整离线分析，`manifest.json` 提供文件大小和哈希。

## HTTP 时间线

时间为浏览器记录的请求开始时间，响应返回与 socket 消息接收另有各自时钟。

| 时间 | HAR 索引 | 请求 | 观察结果 |
| --- | ---: | --- | --- |
| 01:40:29.147 | 32 | GET `/webcast/lottery/melon/check_user_right/` | `has_command=false`、`has_activated=false`，粉丝团已点亮，候选人数 1 |
| 01:40:30.455 | 40 | POST `/webcast/lottery/melon/update_user_condition/` | 表单 `condition_type=6&lottery_id=7702514039720839955`；`status_code=0`、`data={}` |
| 01:40:30.676 | 42 | GET `/webcast/room/special_chat/7702463172476701483/` | query `type=9`、`room_id=7702463172476701483`、`content=开心最美唱歌最好听`；响应相同口令及消息 ID，`status_code=0` |
| 01:40:44.994 | 63 | GET `/webcast/lottery/melon/check_user_right/` | `has_command=true`、`has_activated=true`；候选记录出现当前账号；候选人数 2 |
| 01:47:25.612 | 1145 | GET `/webcast/lottery/melon/check_user_right/` | 本轮 `status=2`，返回开奖条目，`real_lucky_count=3` |
| 01:47:25.976 | 1147 | GET `/webcast/lottery/melon/get_candidate_state/` | `candidate_state=2`，extra 中 `candidate_num=25`；保留原码，不据单个样本定义完整枚举 |
| 01:47:26.071 | 1148 | GET `/webcast/lottery/melon/check_user_right/` | 再次返回本轮开奖条目 |

上述 7 条请求均为 HTTP 200 且 JSON `status_code=0`。`check_user_right` 的业务 query 包括 lottery_id、room_id、anchor_id；`get_candidate_state` 的业务 query 包括 lottery_id。通用网页参数、原始签名、请求头与响应正文在本机文件中。

## 报名成功的独立回执

01:40:31.591 接收到 `WebcastLotteryCandidateEventMessage`，消息 ID `7702516983410084649`：room_id、lottery_id 与当前账号 UID 均匹配，`participate_success=true`，version=`1793382031399`。首次恢复文件的零基 frameIndex 为 857；开奖后恢复文件中也保留同一回执。

01:40:31.719 接收到消息 `7702517124249506859`，文字为“已成功参与福袋，开奖前勿离开直播间”。它没有 lottery_id，只佐证附近的结构化回执。口令 HTTP 响应的消息 ID 为 `7702517131598844966`。

因此，本轮确认链包括用户报告、条件状态变化、当前账号的结构化候选人成功回执及成功提示。不能把 POST 的 `status_code=0` 单独等同于报名成功，也不能从一次实测推断任意账号只发该表单就能参加。

## 开奖材料

01:47:25.972 接收到 `WebcastLotteryDrawResultEventMessage`，消息 ID `7702517780561859634`，开奖后恢复文件零基 frameIndex=869，extra 中候选人数为 25。消息保留 4 个 user_id，当前账号不在其中；原始 UID 仅保存在本机材料。

HTTP 返回的 4 条开奖记录由 3 条 `prize_type=1`（grant_count 为 14、8、8，总计 30）和 1 条 `prize_type=2001`（grant_count=1）组成。因此，本轮返回列表条数不等于钻石中奖份数；附加奖励应与钻石记录分开解释。HTTP 列表的 user_id 被置为 0、昵称被遮蔽，不能据它恢复完整账号身份。本文不建立 candidate_state 全枚举或跨类型的通用获奖判定。

计划 draw_time 为 01:47:27；响应的 real_draw_time 为 01:47:25。以上均保留原始值，没有修正服务器与客户端的时间差。开奖后的恢复材料还包含下一轮开始消息，不代表当前账号参加了下一轮。

## 验证与边界

- 检查 HAR JSON 可解析、7 条目标响应正文存在、POST 表单与口令 query 完整；最终 HAR 未发现 Cookie、Set-Cookie、Authorization、Proxy-Authorization 请求或响应头。
- 使用现有离线脚本读取两份恢复材料，共读取 1,935 条帧记录（包含重叠），得到 22 条去重相关证据；目标轮次有本人成功回执和开奖回执，解包错误为 0。此结果不证明覆盖了采集窗口之外的活动。
- `node --test tests/unit/lottery-capture.test.mjs`：7/7 通过。未修改运行代码，不重新构建或运行全量业务回归。
- `crapper`、`dryer`、`mutator` 不可用，未执行对应检查。
- REA 的既有 `127.0.0.1:9222` 端点不可达，改用原生 Chrome Network 面板；没有扩大调试访问。HAR 不包含 socket 原始帧，socket 证据来自助手恢复导出。扩展会清理旧帧，两次导出保留了本轮关键回执，不声称取得全部历史帧。
- 本次没有分析签名生成算法、重放任何业务请求、自动参与下一轮或领取奖励。
