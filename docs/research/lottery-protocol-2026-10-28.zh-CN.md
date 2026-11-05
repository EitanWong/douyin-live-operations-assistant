# 抖音福袋协议离线逆向核对

核对日期：2026-10-28。素材为用户在直播间 `361690799431` 手动参与前后保留的恢复数据，以及抖音网页发布的静态 protobuf 解码表。此次工作只读取文件，没有调用报名接口或操作直播间。生产解码器及自动参与逻辑未修改。

## 已确认的范围

现有数据足以识别福袋轮次、奖品份数、总量、口令条件、全局候选人数、本人报名成功回执和开奖事件；不足以还原报名 HTTP 请求、签名流程或完整资格判断。

原始数据保存在本机 `output/douyin-fudai/2026-10-28/`，由 Git 忽略。以下计数只涵盖保留的材料，不能代表完整直播：

| 证据 | 位置 / 身份 | 用途与限制 |
| --- | --- | --- |
| E1：原始帧恢复文件 | `recovery-with-protocol.raw.json`，796 帧；SHA-256 `c118e51ff65d2348cb08fbd31869fcec09015b693a90b66d36e99c8ebaa600b8` | 接收方向的 socket / HTTP 长轮询原始载荷，02:35:15—02:57:22，北京时间 |
| E2：扩展失效前的运行快照 | `recovery-before-refresh.raw.json` 的 `runtime.roomData.activities` | 补充已被原始帧缓存清理的轮次同步；该文件的 `collection.events` 为空，不代表运行快照没有数据 |
| E3：抖音发布的静态 schema | [live-schema-im.e322bd8a.js](https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/live-schema-im.e322bd8a.js)；SHA-256 `232a3d3890052ebe868b4b14aca38918730285adbc0f623c77dc8bdaafbc783b` | 提供字段名、类型和编号。已与 E1 的实测载荷交叉核对；未证明直播当时加载的就是此文件版本 |
| E4：此前 Chrome Network 观察 | `check_user_right` / `get_candidate_state`，HTTP 200 | 没有保存完整请求和响应；早期 HAR 的 entries 为空。不能作为可重放的报名请求证据 |

E1 与 E2 合并、按消息身份去重后，得到 88 条相关记录：82 条 `LotteryInfoSyncData`、2 条福袋开始、1 条候选人确认、1 条成功 toast、2 条开奖结果。两份材料合计覆盖 3 轮，只有 1 轮有当前账号的明确报名成功回执。

## 接收协议与封装

WebSocket 的二进制帧使用 `PushFrame.payload`（field 8）承载内部 `Response`，压缩类型由 field 6 或 `compress_type` 头部提供；实测包含 gzip。`/webcast/im/fetch/` 返回内部 `Response`，无需再套一层 PushFrame。

内部 `Response.messages`（field 1）包含 method（1）、payload（2）及 msg_id（3）。外层消息 ID 用于去重，lottery_id 用于关联轮次，两者不能混用。所有 UID、room_id、lottery_id、msg_id 和 version 保留十进制字符串，避免 JavaScript Number 丢失精度。

分析脚本第一版把内部 Response 的整数 field 8 当成 PushFrame 的字节 payload，并尝试解析 Response 的非头部 field 5，产生了 6 个假解析错误。现已按 wire 类型识别 payload，只对 PushFrame 读取头部；修正后 E1 全部 796 帧均能解包，相关消息提取错误数为 0。这不补回已清理的帧，也不证明所有无关业务消息都已实现语义解码。

## 福袋开始与条件

`WebcastLotteryEventNewMessage` 对应 E3 的 `webcast.im.LotteryEventNewMessage`。

| field | 发布 schema 的名字 / 类型 | 本次实测与解释 |
| ---: | --- | --- |
| 1 | common / Common | 房间、消息身份；创建时间可能不传 |
| 2 | lottery_id / int64 | 福袋轮次 ID |
| 3 | lottery_status / int32 | 实测 1；保留原码，不定义完整状态枚举 |
| 4 / 5 / 6 | lottery_start_time / lottery_draw_time / lottery_current_time，int64 | 秒级时钟，与 UI 倒计时相符 |
| 8 | prize_type / int64 | 实测 1；本次 UI 和 award_name 同时表明是钻石，不能把所有类型 1 永久解释为钻石 |
| 10 | conditions / repeated int32 | 支持 packed 与 unpacked；实测 `[3,6]` |
| 11 | extra / map<string,string> | 实测 `participate_type=password`、`money=30`、`get_gift_cnt=3`、`avg_money=10`、`time=180`、`fans_level=0`、`lottery_range=all` |
| 12 | use_new_draw_interaction / bool | 实测 true |
| 13 / 14 | prize_count / lucky_count，int64 | 实测 30 / 3 |
| 18 | award_name / string | 实测“钻石” |
| 21 | conditions_detail / repeated LotteryCondition | 实测 type=3、content=“好美呀”，以及只有 type=6 的条件项 |

`LotteryCondition` 的 field 1—6 分别为 type、content、need_diamond_count、min_fans_level、remarks、biz_info。当前材料足以将 type=3 与本次口令条件关联；type=6 的具体业务要求仍未知。不能因 content 为空，就把该条件认定为“无要求”或已完成。

## 人数与轮次同步

路径为 `WebcastRoomDataSyncMessage` → `sync_type=LotteryInfoSyncData` → field 5 的嵌套载荷。

| 嵌套 field | 发布 schema 的名字 | 含义 |
| ---: | --- | --- |
| 1 | lottery_id | 轮次 ID |
| 2 / 6 | lucky_count / prize_count | 份数 / 总量 |
| 3 | candidate_total_count | 全局候选人数；不能证明本人已参加 |
| 4 | last_candidate_total_count_surge_timestamp | 原始人数增长时间标记；不与候选人 version 混用 |
| 5 | lottery_type | 原始类型码 |
| 7 / 8 | start_time / draw_time | 秒级开始与计划开奖时间 |
| 9—13 | enabled_dilatation、dilatation_config_detail、dilatation_now、prize_count_before_dilatation、lucky_count_before_dilatation | 扩容相关字段；本次没有足够非默认样本核实业务效果 |

中途进入房间时可能先收到同步数据，不能要求必须先观察到开始事件才能建立轮次。持久化身份应为 `(room_id, lottery_id)`，不要用奖品数量、DOM 节点或倒计时文字作为唯一身份。

## 本人报名回执

`WebcastLotteryCandidateEventMessage` 对应 E3 的 `LotteryCandidateEventMessage`：

| field | 名字 / 类型 | 本次值 |
| ---: | --- | --- |
| 2 | lottery_id / int64 | `7701413500338785075` |
| 3 | user_id / int64 | 与 Eitan 弹幕回显的 UID 完全一致；原值仅保存在本地材料 |
| 4 | participate_success / bool | true |
| 5 | version / int64 | `1793126730191`；这是版本标记，不按字段值形状推断为时间 |
| 5000 | user_openid / string | 本次未传，不据此补造用户身份 |

确认消息 ID 为 `7701420459484973839`，E1 的零基 frameIndex=561，收到时间 02:45:30.521。其 Common 没有 create_time，不能拿 version 填充事件时间。

随后 frameIndex=562 的 `WebcastCommonToastMessage` 收到“已成功参与福袋，开奖前勿离开直播间”；frameIndex=564 收到本人“好美呀”评论回显。接收顺序不等于服务端业务处理顺序。

toast 的文本在 `Common.display_text`（1→8）中：Text.field2 是 default_pattern，Text.field4 是重复 TextPiece；本次 pattern=`{0:string}`，TextPiece.type=1、field11 为实际文本。toast 本身没有 lottery_id，只能佐证附近的结构化候选人确认，不能独立归属某轮福袋。

离线状态分析只在 room_id、lottery_id 和当前 UID 都匹配时记录本人参与；无候选人回执保持未知。防止旧确认覆盖新状态时，脚本按 version 的整数顺序比较，这属于本地分析设计，仍需后续多次参与/重连样本验证平台的版本约定。

## 开奖事件及尚未解决的异常

`WebcastLotteryDrawResultEventMessage` 对应 `LotteryDrawResultEventMessage`：field 2 为 lottery_id，field 3 为 repeated int64 user_ids（支持 packed），field 4 为 extra 字符串。

| 福袋 ID | 计划开奖 | 观测结果事件 | extra.candidate_num | user_ids 项数 / lucky_count |
| --- | --- | --- | ---: | --- |
| `7701411754655877898` | 02:36:08 | 02:36:07.258 | 440 | 9 / 3 |
| `7701415404480498442` | 02:41:18 | 保留素材中未找到 | 最后同步为 160 | 未知 / 3 |
| `7701413500338785075` | 02:46:55 | 02:46:54.626 | 146 | 4 / 3 |

已按发布 schema 解出 user_ids，且本次两份列表均不包含当前 UID。但其项数与 lucky_count 不相同，尚缺页面消费逻辑和完整开奖查询响应，因此只保存为 `reportedUserIds`，不直接输出“中奖名单”“未中奖”或中奖概率。不能因同步截止时间已过就声称已经收到开奖结果。

结果推送接收时间略早于计划开奖秒值，可能涉及客户端时钟和服务端调度，现有单侧记录不足以测定原因，不修正原始时间。

## 报名 HTTP 请求仍需补抓

此前现场见到 `/webcast/lottery/melon/check_user_right/` 和 `/webcast/lottery/melon/get_candidate_state/` 两个 HTTP 200 查询。前者参数含 lottery_id、room_id、anchor_id；后者含 lottery_id；均有通用网页参数和令牌/签名。完整 data 未保留，status_code=0 只说明该查询返回成功，不能证明报名成功或所有资格满足。

当前扩展协议缓存记录接收帧和 IM 长轮询响应，不记录所有业务 HTTP 请求。现有证据也不能排除报名由正常评论请求触发，因此不能凭接口名猜出一个 join URL，或假设“发出指定口令”等同于报名成功。

下次只需要在原生页面手动参与一轮，保留以下材料：

1. 在点击前打开 Network，启用 Preserve log，记录全部 Fetch/XHR；不要只筛选 `lottery`，避免遗漏评论请求。记下打开福袋、点击参与、成功提示与开奖的北京时间。
2. 保存参与前后资格查询、候选状态查询及点击时新增请求的 URL、方法、请求体、状态码与响应正文。HAR 使用浏览器默认敏感请求头脱敏，无需额外导出 Cookie 或登录凭证。
3. 导出含响应正文的 HAR，同时从助手“连接诊断 → 导出恢复数据”保存 JSON。HAR 通常不能替代 WebSocket 消息载荷，恢复 JSON 仍需要。
4. 保存参与条件和开奖界面；同一轮尽量同时留参与前、参与后、开奖后的状态响应。先导出再重载扩展，避免连接失效或缓存清理导致缺口。

优先补普通参与成功样本，再补自然出现的“已参与”、未满足条件、过期轮次等状态，不需要为测试额外消费。新的红包需单独采样：现有帧没有 `WebcastPreviewCjRpMessage` 或 LuckyBox 消息，钻石福袋结果不能替代红包协议验证。

## 可复用的分析工具与验证

新增 [离线分析脚本](../../scripts/analyze-lottery-capture.mjs)，只读取给定 JSON，解包 rawBase64，输出轮次、字段、消息 ID、原始载荷哈希和每条证据在输入文件中的位置。它没有 HTTP 客户端、浏览器控制或报名操作；输出可能含 UID 和评论，应保存在忽略目录。

```sh
node scripts/analyze-lottery-capture.mjs \
  output/douyin-fudai/2026-10-28/recovery-with-protocol.raw.json \
  output/douyin-fudai/2026-10-28/recovery-before-refresh.raw.json \
  --out output/douyin-fudai/2026-10-28/lottery-decoded.raw.json \
  --self-uid '<当前账号的十进制UID>'

node --test tests/unit/lottery-capture.test.mjs tests/unit/protocol.test.mjs
```

本次真实素材回放：796 帧、88 条去重证据、3 轮福袋、本人确认成功 1 轮、成功 toast 1 条、解析错误 0。7 个新增测试及 48 个现有协议测试全部通过；新增用例覆盖 gzip / 长轮询区分、packed/unpacked int64、参与 false/true/缺字段、精度、旧 version、账号与房间关联、双传输去重、无轮次 toast 和坏消息隔离。测试验证离线分析行为，不代表线上自动报名验收。

目前没有把研究字段接入生产解码器，也没有更改或启用自动参与。待补齐报名 HTTP 证据后，再决定是否以及如何实现相应功能。
