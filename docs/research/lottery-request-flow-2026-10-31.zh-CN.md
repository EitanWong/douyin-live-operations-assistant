# 福袋参与请求与原生调用链核对

核对日期：2026-10-31，北京时间。用户在指定直播间手动点击“一键发评论参与福袋”，并报告参与成功。本记录把本轮 HTTP 观察与网页发布代码分开核对；没有重放报名请求，也不据此声称自动参与已完成真实验收。

## 材料与轮次

- 页面直播间 `260440030123`，实际 room_id `7702463172476701483`，主播 UID `4007055676415213`。
- 本轮 lottery_id `7702521633959316287`；查询返回 10 钻、1 份，条件为粉丝团点亮、活动口令及手动参与。
- 原始材料位于本机忽略目录 `output/douyin-fudai/2026-10-31/`。`round2/network.har` 有 2,250 条请求，其中包含上一轮保留日志，不能把它们全部计为本轮请求。本轮选取零基 HAR 索引 1625、1626、1698、1699、2119。

| 材料 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `round2/network.har` | 135,482,563 | `fc4b54d0c36d9fed78434366ee75e940a3528b757e23b2ef0973306e82b64636` |
| `request-source/LotteryViewPlugin.ae0b7b46.js` | 110,407 | `75a309db3990c73a94907c3e6b0f9bb26ded878dda510af25a6fe92ebd1ec2dd` |
| `request-source/LotteryShortTouchPlugin.dff12b10.js` | 31,095 | `15bc716f4281544496194e3b1ef55a38e66d342ba2e1c74e0f56c9bf850f892c` |

View 插件正文来自已保存 HAR；ShortTouch 插件按 HAR initiator 中出现的同名发布地址另行读取，不能把另行读取的正文声称为本轮网络响应。两者均只进行静态分析。`round2/request-flow-summary.json` 提供不含会话令牌的请求摘要，`round2/request-flow-manifest.json` 记录上述文件及摘要的大小和哈希。原始 HAR、摘要和清单均保持本机文件权限 600，目录权限 700。

## 本轮 HTTP 观察

以下时间为 HAR 的请求开始时间转换到北京时间，各请求均为 HTTP 200、JSON `status_code=0`。

| 时间 | 索引 | 请求 | 观察 |
| --- | ---: | --- | --- |
| 02:21:26.026 | 1625 | GET `/webcast/lottery/melon/check_user_right/` | query 为 lottery_id、room_id、anchor_id；`has_command=false`、`has_activated=false`，粉丝团已点亮 |
| 02:21:26.035 | 1626 | 同上 | 悬停入口发起的另一次资格查询；同样未完成口令和手动参与 |
| 02:22:05.636 | 1698 | POST `/webcast/lottery/melon/update_user_condition/` | `application/x-www-form-urlencoded`；正文 `condition_type=6&lottery_id=7702521633959316287`；响应 `data={}` |
| 02:22:05.967 | 1699 | GET `/webcast/room/special_chat/7702463172476701483/` | query 的业务字段为 `type=9`、当前 room_id、`content=开心最美唱歌最好听`；响应返回相同口令及字符串消息 ID `7702527811424834569` |
| 02:23:26.050 | 2119 | GET `/webcast/lottery/melon/check_user_right/` | 本轮已开奖，`status=2`、`candidate_num=14`、`real_lucky_count=1` |

两条提交请求的开始时间相差 331 毫秒。提交后、开奖前没有新的资格查询保存在此 HAR，因此不能用本轮 HTTP 材料证明 `has_command` 与 `has_activated` 的中间变化。开奖查询把用户条件统一返回为 false，不可把这个结果当作对已结束轮次的报名失败判定。

02:21:26 的两次资格响应分别给出粉丝团等级 6 和 0，但两者的会员与点亮状态均为 true，本轮最低等级条件为 0。保留这个差异，不合并或补造账号状态。粉丝团条件的 `need_diamond_count=1` 描述未满足时的成本，不代表已点亮账号本次一定支付了 1 钻；本轮目标链路没有赠礼或支付请求。

## 发布代码与请求调用链

1. ShortTouch 和 View 插件都包含请求模块 `604509`。它从模块 `330866` 取 `ZP` HTTP 客户端：资格查询走 GET；条件提交先用 stringify 序列化表单，再 POST；口令使用 `special_chat/<room_id>/` GET，默认 `type=9`。
2. 枚举模块 `55317` 将条件码 6 命名为 `DefaultParticipate`，3 为 `Comment`，8 为 `LightFansClub`。这些是此发布代码的命名，与本轮响应里的“手动参与”“发送口令”“粉丝团点亮”交叉对应；不据此定义其他版本的完整协议。
3. View 插件模块 `139675` 中的 `doParticipate` 先等待局部函数 `C()` 完成。`C()` 向 `604509.R_` 传当前 `lotteryStore.currentLottery.lottery_id_str` 和条件码 6；非零业务码或抛错时结束本次处理。成功后才按 `participateFuncKey` 分支，口令分支调用 `E()`，由 `604509.SZ` 发送当前房间及条件中的 comment。
4. HAR 的 initiator 与以上结构吻合：POST 经 ShortTouch 的 `d` → View 的 `C` → `doParticipate`；口令经 ShortTouch 的 `c` → View 的 `E` → 同一 `doParticipate`。HAR 使用零基行、列：POST 的 View `C` 为 `0:39958`，口令的 View `E` 为 `0:42846`，两者的 `doParticipate` 为 `0:49827`。
5. View 模块 `440721` 根据 `user_condition.has_command` 计算口令是否完成，根据会员、点亮和粉丝等级计算粉丝团条件；其总完成判断在存在条件 6 时还检查 `has_activated`。原生口令响应成功后更新本地条件并插入原生消息队列；这条本地显示路径不能充当独立的服务器报名回执。

因此，“只发一次条件 POST 即可参加所有福袋”不符合本轮原生流程。对于这类已满足粉丝团条件、尚未完成口令的福袋，需要条件提交与口令发送组成的流程；其他条件组合仍须另行验证。

## 请求模拟的实现边界

静态代码表明应复用网页现有 `ZP` 客户端。它让网页既有的通用参数及请求拦截流程继续负责会话和签名。本轮 HAR 也能观察到签名 query 与 POST 的 CSRF 请求头；本记录没有分析这些算法，不能宣称已经验证独立 HTTP 客户端可以自行生成等价请求。

不应复制 HAR 中的签名、令牌或安全请求头到运行代码。Chrome 脱敏导出中未发现 Cookie、Set-Cookie、Authorization、Proxy-Authorization 头，但这不表示 HAR 不含敏感材料：URL 签名、CSRF 值和响应安全头仍只保留在本机原始文件中，不能提交到 Git。

用于实现的保守范围是本次已观察的 6 / 3 / 8 条件组合：用精确字符串关联账号、房间和轮次，查询当前资格，确认已满足粉丝团条件，并仅在用户允许口令参与时发送活动口令。付费、关注、分享、会员及未知条件需要原生页面处理。条件 POST 已派发后，如口令失败、取消或结果未知，不能整组重试或回退点击，否则可能产生重复动作。

两条请求被平台接受只表示提交阶段成功。最终报名状态应继续核对同一房间、同一轮次、当前账号的 `WebcastLotteryCandidateEventMessage` 成功回执，并与页面状态分别计数。用户本次报告成功是现场观察信息；独立结构化回执应由恢复材料另行核验。

## 验证范围与未完成项

- 五条目标响应均可解析，业务参数、POST 表单、口令响应和 initiator 均已保存并交叉核对。
- 此次分析未执行任何实时业务请求，没有代替用户点击参与，也没有领取奖励。
- REA 静态分析工具返回 `unreadable_output`，具体为 `identity/key` schema 校验失败；本记录依据直接读取的 HAR 和发布代码，没有可引用的 REA Evidence ID。
- 本轮 HTTP 材料不足以确认独立候选人回执、请求代码的真实自动参与结果、其他条件组合或跨版本兼容性。实现及自动化测试结果由本任务行动日志记录，不把离线测试当成真实报名验收。

## 已实现的请求通道

`src/browser/lottery-requests.js` 在 MAIN 内复用网页客户端。prepare 只查询资格并签发短期、单轮次票据；commit 固定执行条件 POST 和必要的口令 GET。资格响应只接受已观察的 3 / 6 / 8 条件，身份采用精确字符串编号；未知条件、未满足的粉丝团、付费流程、已结束活动和账号／房间变化均阻止派发。服务器当前时间决定剩余有效期，网页只有精确轮次 ID 时也可由资格回复补充倒计时。

扩展桥只增加 prepare / commit / stop 的固定语义。工具网关绑定当前账号与配置，自动参与器派发前持久保存轮次预留；每次异步等待后重新检查环境。未知或部分提交保留记录，不回退按钮或自动重发。停止及保存设置撤销旧准备；页面缓存恢复允许新准备，离开前的票据仍失效。工具等待预算为 30 秒，底层每条请求仍为 8 秒，实际在途请求一直被宿主跟踪。

本地行为及构建桥测试覆盖提交顺序、重复调用、同步重入、身份／轮次变化、时钟、容量、停止、迟到响应、持久化等待和重建。真实资格响应 1625 / 1626 已用模拟客户端离线验证可准备，开奖响应 2119 被拒绝；未向线上重放这些请求。完整构建与测试结果见行动日志。
