# 小心心送礼请求与原生调用链

采集日期：2026-11-01，北京时间。用户在 Lucy小露直播间手动送出“小心心 ×1”，并明确反馈已送出。本轮取得真实 HTTP 请求和成功响应，用于后续扩展工具的自动送礼设计；没有实现或执行自动送礼，也没有重放请求。

## 采集范围与材料

- 页面直播间：`361690799431`；实际 room_id：`7702839019851270938`；主播 UID：`3804784440654216`。
- Chrome 原生 Network 面板在用户操作前开始录制，保持日志，使用 `Export HAR (sanitized)` 导出。REA 的 `127.0.0.1:9222` 端点不可达，本轮没有成功的 REA Evidence ID。
- 原始材料保存在本机忽略目录 `output/douyin-gift/2026-11-01/`，目录权限 700，材料权限 600。HAR 共 471 条请求、43,100,710 字节，SHA-256 为 `5be113c202941f8d51deb135e977a8473de2bebc26be0998d80b30690af70eff`。
- `gift-http.raw.json` 提取 6 条礼物相关请求并保留原始 HAR 索引；`send.request.json`、`send.response.json` 分别保存本次送礼的完整请求和解析后响应；`request-summary.json` 保存去除签名、安全头值和账号余额的结构化摘要；`manifest.json` 记录文件大小与 SHA-256。
- 脱敏导出未含 Cookie、Set-Cookie、Authorization、Proxy-Authorization 请求或响应头，但仍含 URL 签名、CSRF、ticket-guard 值及响应账号信息。这些材料只留本机，不提交 Git；本文只记录业务字段及安全头名称。

## 实际请求

请求开始时间为 **2026-11-01 01:09:14.741 +08:00**，零基 HAR 索引 **151**。

```text
POST https://live.douyin.com/webcast/gift/send/
Content-Type: application/x-www-form-urlencoded
```

表单包含以下 21 个字段，`extra` 和 `tags_extra` 在实际正文中先 JSON 序列化，再按表单编码：

```json
{
  "buff_level": "0",
  "combo_position": "gift_panel",
  "count": "1",
  "extra": "{\"total_count\":1}",
  "gift_id": "463",
  "gift_source": "0",
  "is_first_combo": "true",
  "is_hotkey": "0",
  "originPrice": "1",
  "price": "1",
  "room_anchor_id": "3804784440654216",
  "room_id": "7702839019851270938",
  "send_scene": "1",
  "send_type": "4",
  "sort": "85",
  "sortType": "default",
  "tags_extra": "{\"gift_source\":\"gift_panel\",\"enter_from_merge\":\"personal_homepage\",\"enter_method\":\"personal_homepage_fast_live_head\",\"is_client\":false}",
  "to_episode_id": "0",
  "to_room_id": "7702839019851270938",
  "to_user_id": "3804784440654216",
  "to_user_ids": ""
}
```

`gift_id=463` 对应小心心，本次单价 1 钻、数量 1。`room_id` 是当前直播房间；`to_room_id`、`to_user_id` 是收礼目标；`room_anchor_id` 是当前房间主播。本次目标与当前主播一致，不能据此假定连麦或多人送礼时这些编号始终相同。

`extra.total_count` 在发布代码中由当前连击累计数产生，不能统一解释为“本次新增数量”；本次首次单礼物与 `count` 恰好都是 1。`sort`、`sortType`、`combo_position` 和来源标签由当前货架及入口决定，不应将本次货架排序、主页来源或 `send_scene` 枚举推广到其他场景。

query 除网页通用参数外，包含 `webid`、`device_id`、`ignoreToast=true`、`msToken`、`a_bogus` 等。请求头还出现 `x-secsdk-csrf-token`、`rpc-persist-webcast-trace-id` 及多个 `bd-ticket-guard-*` 头。本文不保存这些值，也不将某个样本中出现的字段全部认定为最小必需参数。

## 服务器响应与成功范围

本次 HTTP 200、JSON `status_code=0`。响应中的关键业务字段为：

| 字段 | 本次值 |
| --- | --- |
| `data.gift_id` | `463` |
| `data.gift_struct.name` | `小心心` |
| `data.gift_struct.diamond_count` | `1` |
| `data.group_count` / `repeat_count` / `combo_count` | 均为 `1` |
| `data.group_id` | `1793466555` |
| `data.msg_id` | `7702879801052468266` |
| `data.describe` | `Eitan:送给主播 1个小心心` |

响应还包含 `left_diamond`、`left_deci_diamond` 等余额字段，实际值仅保留于本机。`msg_id` 在原始 JSON 中为大整数；本轮使用 Python 保留其精度，并在摘要中转成字符串。后续 JavaScript 实现应在 JSON 边界保留精确编号，不能在普通 JSON.parse 已舍入后再转字符串。

用户反馈、HTTP 成功响应和原生公屏展示一致。曾尝试导出助手恢复数据，但下载等待超时，未取得新增恢复文件；因此本轮没有独立保存并核对同一 msg_id 的 IM 礼物回执。原生成功分支会依据 HTTP 响应构造消息并更新本地展示，不能仅凭公屏展示就声称观察到独立广播。没有独立核对主播最终结算、连击、多件、失败、余额不足、多人目标或自动请求的真实执行结果。

## 相邻只读请求与礼物目录

下表时间均为北京时间，索引均为最终 HAR 的零基索引；这些请求均为 HTTP 200、JSON `status_code=0`。

| 时间 | 索引 | 请求 | 观察 |
| --- | ---: | --- | --- |
| 01:09:07.339 | 75 | GET `/webcast/wallet/info/` | 送礼前余额查询 |
| 01:09:08.156 | 93 | GET `/webcast/gift/extra/` | 本次查询 gift_id / gift_ids 为 3729，不是小心心；不能当作 463 的前置参数 |
| 01:09:12.628 | 134 | GET `/webcast/gift/play/indicator/` | 礼物活动展示 |
| 01:09:12.829 | 136 | GET `/webcast/gift/exhibition/home/` | 礼物展馆展示 |
| 01:09:13.198 | 137 | GET `/webcast/gift/exhibition/rare/` | 稀有礼物展示 |
| 01:09:14.741 | 151 | POST `/webcast/gift/send/` | 本次小心心 ×1 |
| 01:09:15.264 | 156 | GET `/webcast/wallet/info/` | 送礼后余额查询 |
| 01:09:23.853 | 247 | GET `/webcast/gift/list/` | 送礼后的当前房间礼物目录，不是本轮送礼前查询 |

目录响应顶层 data 包含 `gifts_info`、`gifts`、`pages`、`default_tab_id`、`gift_sort_strategy`、`event_track`、`fetch_strategy` 等。小心心出现在 `data.pages[1].gifts[84]`（推荐）、`pages[3].gifts[47]`（展馆）及 `pages[9].gifts[3]`（常用），三者均返回 `id=463`、`diamond_count=1`、`is_locked=false`、`req_extra_type=3`。后续目录按 gift_id 去重，但应保留所属页和场景；一次响应不证明覆盖所有账号、房间和活动礼物。

## 原生调用链：静态核对

HAR initiator 的调用栈从 `OperatingBar.969dfe81.js` 经 `5337.3645bf80.js`、`3657.27cce0bb.js` 进入网页 HTTP 客户端及安全 SDK。沿这些已观察地址另行取得三份公开发布脚本，保存在 `request-source/`。脚本正文是另行读取的静态材料，不冒充本轮 HAR 中的响应正文。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `3657.27cce0bb.js` | 79,088 | `1da5ef9cbc5fe2bcab29910de6b29c394407c2d75b321481e7b473400e7b2d1d` |
| `5337.3645bf80.js` | 288,801 | `a11a792b57410970620e6fcf344900b00f8e0641546ac0016e143b0009edfdac` |
| `OperatingBar.969dfe81.js` | 235,799 | `2173cd13923b1d8105c150a2f834e442c6d3ffbc293fe9eb47380e6dd7f174fa` |

1. `OperatingBar` 的送礼处理器向 `sendGift` 提供数量、当前价格、gift_id、连击累计数、首次连击标记、货架排序、来源和快捷键标记。本次表单与这条路径吻合。
2. `5337` 的 `sendGift` 检查登录、送礼资格、自送限制和目标，补充当前房间、主播、目标、`send_type=4`、动态 `send_scene`、来源 JSON，并生成本次 trace；成功后更新礼物展示并查询余额。该路径会按场景处理连麦目标，不能只复制当前主播字段。
3. `3657` 中模块 **334862** 的导出 **hF**（局部函数 b）负责送礼：规范 `extra.total_count`、`tags_extra.is_client`，进行表单序列化，再调用模块 **330866.ZP.post** 的 `/webcast/gift/send/`。通用参数、会话、安全 SDK 及拦截器留在网页既有链路内。
4. 同一模块提供礼物目录 `Xq`、余额 `sb`、价格转换 `Jh`、超时报告 `X0`；`Jh` 优先读取 `diamond_x10 / 10`，否则读取 `diamond`，因此后续余额处理不应只假设旧单字段或整数钻石。
5. `5337` 的静态失败分支处理 20003（登录）、40001（余额不足）、42201 / 42202（前往 App 验证身份）。这些码本轮没有实际触发，不作为线上失败实测结论。
6. 静态超时分支在功能开关允许时向 `/webcast/gift/report/` 报告同一 trace，而不是再次送礼。本轮没有观察到该报告请求；trace 是否具有服务端幂等语义未知，不能把它当作重试依据。

## 后续接入建议与未验证项

可按现有自动点赞和福袋工具的结构增加固定语义的 `gift.prepare / commit / stop`，在 MAIN 内复用网页模块 334862.hF。工具配置表达礼物、单次数量、间隔、总数量与本次钻石上限；准备时解析当前账号、房间、主播及实时目录价格，提交前再次核对并在持久记录中预留本次消费。刷新、切房、账号变化和结果未知后停止，重复调用同一操作不得再次扣费。仅有 HTTP trace 不能证明幂等，已经派发但结果未知时应保留未决记录，不自动重试。

首个可验证单元可限定为用户主动开始、给当前主播送普通单人礼物；以后逐项验证多件和连击。价格、加成、插件附加价、锁定、粉丝团限制、多人送礼、背包礼物及充值均不能直接套用本次 21 字段。上述为设计建议，尚未新增运行能力、工具界面或默认启用开关。

验证：离线重新解析 HAR，确认唯一一条 send 请求、21 个无重复表单字段、目标编号一致、HTTP/业务成功、响应礼物与数量匹配、目录三个 463 条目，以及所有材料哈希和文件权限。未改运行代码，不构建或运行全量业务测试。`crapper`、`dryer`、`mutator` 在 PATH 和可调用工具中均不可用，未执行对应检查。
