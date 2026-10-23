# 抖音直播间数据可获取性研究

研究日期：2026-10-20 至 2026-10-21（Asia/Shanghai；目标主播下播前完成现场检查）
目标直播间：Lucy小露，`https://live.douyin.com/361690799431?anchor_id=3804784440654216`
研究范围：当前 Chrome 登录态下的可见页面、仓库中的扩展实现及 REA 浏览器观测能力。本文不记录 Cookie、访问令牌或完整用户标识。

## 摘要

当前扩展在页面已登录且直播正常播放时，可以从直播 IM WebSocket 解出部分互动事件和 PK 协议消息；也可从页面 DOM 补充公屏文本、星守护/贡献榜播报，并用同源页面接口识别主播及当前账号。它不是通用网络抓包器，也没有覆盖抖音所有业务接口。源码实现证明了解码/识别能力，不等于本次直播里每一类消息都实际出现或已逐条核验。

| 数据 | 当前证据/路径 | 扩展可用性 | 主要限制 |
| --- | --- | --- | --- |
| 直播间号、主播主页链接、昵称 | 当前直播 DOM；同源房间资料接口 | 已识别/可识别 | 房间显示号与服务端 room ID 不同；接口失败时可手填 |
| 主播标题、主播 UID | 页面初始化数据或 `/webcast/room/web/enter/` | 已实现识别 | 依赖登录态、接口结构和当前房间校验 |
| 当前登录用户 ID、昵称 | 页面初始化数据或 `/webcast/user/me/` | 已实现识别 | 未登录/拒绝/结构变化时为空；不会把弹幕用户误当自己 |
| 公屏聊天文本、用户昵称、UID、secUid、抖音号、财富等级、粉丝团 | `WebcastChatMessage` | 解码器支持 | DOM 备用通道只取昵称和文本，用户资料为空；私信/历史内容不涵蓋 |
| @提及目标 | `WebcastChatMessage` 的 atUser 字段 | 解码器支持 | 只覆盖已识别的单一 atUser 字段，不是完整富文本/多提及解析 |
| 进场/会员消息 | `WebcastMemberMessage` | 作为 `enter` 事件解析 | 具体 action 仅接受源码中的 0/1；不代表通用关注事件 |
| 礼物名、礼物 ID、数量、单价、连击/分组 ID、主播房间、送礼人 | `WebcastGiftMessage` | 已解码并供礼物感谢/账本使用 | 礼物字段版本变化、匿名/缺失用户、业务语义变化会影响完整性 |
| 点赞事件、点赞增量/总数 | `WebcastLikeMessage` | 已解码 | 页面本场点赞数字也可见，但没有对实时值逐帧校验；不保证逐个点赞用户事件 |
| 直播结束控制消息 | `WebcastControlMessage` | 特定结束码解析 | DOM 结束提示可配置；直播结束语义只覆盖当前识别码/选择器 |
| PK 开始/结束、比分、主播参与者、战局 ID/时长 | LinkMic/Battle 系 protobuf 消息 | 已实现多种字段布局 | 当前房间未现场验证这些事件；协议升级需重新核对字段 |
| PK 贡献用户、贡献分、排名、贡献人数、平台生效卡的类型/时间 | `LinkMicMethod` / `LinkMicArmies` 等结构 | 已实现，部分只读分析使用 | 卡片倍率/卡名未猜测；缺失 UID/对手数据不补造 |
| 1000 贡献榜用户、可见分值、DOM顺序 | 直播聊天面板 DOM | 已实现 DOM 读取器 | 依赖易变 CSS/DOM 层级；直播观众列表不是全体在线用户全集 |
| 粉丝团等级、财富等级 | 用户对象协议字段 | 解码器有对应字段 | 本次 DOM 中没有逐用户校验；没有证据说明每个消息都携带 |
| 在线人数、当前榜单、礼物货架、页面点赞计数 | 页面 DOM 可见内容 | 当前页面可读；未全部接入扩展业务 | 本次 UI 快照值会变化；在线列表仅展示一小部分 |
| 视频/音频流、回放、用户完整资料、私密数据 | 本次未捕获/扩展不读取 | 未实现为运营数据 | 需要单独授权的媒体/接口能力；本次没有尝试绕过平台限制 |

## 本场页面快照

通过当前 Chrome 标签的辅助功能树观察到的快照（页面持续变化，数字仅代表观察时刻）：

- 标题为“Lucy小露的抖音直播间”，主播昵称 Lucy小露；页面资料链接指向主播主页。
- 页面显示本场点赞约 3423；显示粉丝团人数 18、榜单入口，以及“甄选展馆”等直播间组件。
- 礼物货架展示比心兔兔（299 钻）、冠名（199 钻）、一束花开（366 钻）、热气球（520 钻）、跑车（1200 钻）、抖音飞艇（20000 钻）、PK 宝箱（600 钻）、甜心跑车（1200 钻）。这是当前可见货架，不代表完整礼物目录。
- 页面显示在线观众数约 15，并展示“全部”“1000贡献用户(2)”“高等级用户”分类及少量用户行。这不是全量观众清单。
- 公屏快照包含若干昵称和文本；页面中也显示了扩展生成的一条欢迎文本。DOM快照证明文字当时可见，不证明每条消息都能从 WebSocket 解码。
- 页面播放区显示直播计时约 04:21；没有对主播视频、音频、实时画面做识别或保存。

## 实现边界与数据路径

1. `extension/page.js` 在 MAIN world 包装原生 `WebSocket`，只筛选抖音域名且 path 命中 `webcast/im/` 的新建连接。采集通道不主动发起平台请求；发送通道另行复用页面已有客户端，见下文。接收到的事件通过同源 `postMessage` 桥交给隔离世界。
2. `src/browser/protocol.js` 自行读取 protobuf wire format；支持 gzip/deflate、legacy protobuf groups，单个解压消息最多 8 MiB，且对一帧内损坏的单条业务消息做隔离。源码支持 Chat/Gift/Like/Member/Control、LinkMic/Battle、RoomStats/RoomUserSeq、Social/Fansclub、Emoji/Screen/Audio chat、置顶评论、弹幕点赞计数、粉丝票统计、RoomMessage/RoomRank/RankUpdate、商品与轻礼物、小游戏状态、礼物面板/房间标记、活动信号及红包预览；RoomNotify 只解外层，WRDS 对 7 种已知 sync type 有限解码。未识别 method 不进入业务队列，但诊断会按安全字符白名单累计 method 名和次数，不保留未知 payload。
3. 用户 ID 以十进制字符串保留，避免 64 位 UID 被 JavaScript `Number` 截断。事件常有平台时间、房间 ID 和消息 ID；字段缺失时保留空/未知，不推断。
4. `src/browser/adapter.js` 使用 MutationObserver 读取公屏 DOM，socket聊天活跃时避免重复发出 DOM 弹幕；断流时可回退到 DOM。DOM 只提供昵称、文本及符合已知格式的播报，不具备协议事件的 UID/等级资料。
5. `src/browser/identity.js` 从明确的初始化槽位及同源房间/本人接口读取主播、当前登录用户和管理身份；房间 ID 必须匹配。该接口用途是身份识别，不是任意用户搜索接口。
6. 页面桥接与 socket 处理设有队列/字节上限，超过上限时可能出现可诊断的数据缺口；不能将其宣传为不丢包采集。

## 当前明确不支持 / 尚未验证

### 直接请求发送（2026-10-21 补充）

- 当前已加载的公开 bundle `3273.81597587.js` 模块 40356 使用 GET `/webcast/room/chat/` 发送普通聊天；`426.3098d46d.js` 模块 801541 的 `Ew` 使用 POST `/webcast/screen_chat/`，模块 261882 在管理员样式分支选择它。付费接口 `/webcast/privilege/screen_chat/send/` 是另一条路径，助手不调用。
- `src/browser/request-sender.js` 复用 `client-entry~1.28f20eec.js` 中请求模块的默认客户端，保留登录态、安全初始化和公共参数拦截器。只允许当前房间和账号；管理员还须页面用户资料明确标记 `user_attr.is_admin`。这些属于页面私有实现，版本变化会使能力探测失败并回退 UI。
- 本场运行记录 00:14:42 普通定时弹幕通过请求提交，00:14:43 收到本人结构化公屏回显，延迟 1305 ms。00:14:00 管理员欢迎请求返回成功，页面随后可见同文消息，但未收到助手可识别的结构化回显。原站发送逻辑也会根据接口响应生成 `is_mock` 本地显示消息，故页面可见本身不证明远端投递；管理员回显仍待补齐协议证据。
- 入站的 `WebcastScreenChatMessage` / `WebcastPrivilegeScreenChatMessage` 已有 decoder。2026-10-22 修复发送跟踪器仅接受 `chat` 的遗漏：现在 `screen-chat` 也可在本人 UID、文本、来源和时间全部匹配后确认发送，其余业务仍按只读活动处理。不把发送接口 HTTP 成功或本地显示伪装成 socket 回显；本场管理员远端投递仍待新版实测。请求结果未知后不转 UI 再发；同一发送票据只执行一次。
- REA 对本地 JavaScript 树的分析调用遇到结果 schema 错误，Chrome CDP 不可达；以上路由结论来自常规静态源码追踪及扩展自身运行记录，不是 REA 成功执行的网络抓包结果。

| 缺口 | 状态 | 判断依据与解码前提 |
| --- | --- | --- |
| `/webcast/im/fetch/` 轮询事件 | **新增裸 Response 与 WebSocket PushFrame 双格式支持；线上样本未验证** | MAIN world 只观察同源精确路径的 GET，不改 responseType、不发请求、不留 URL/body；ArrayBuffer、Blob 和可无损还原的字节字符串进入与 WebSocket 相同的有序队列。解析器接受 PushFrame field 8 或直接解析 Response.messages；合成两类 framing 测试通过。公开协议参考把 long-poll body 定义为内层 Response，但 REA 未保留真实 body，当前 Chrome 的 REA CDP 端口也不可达，所以仍需诊断计数确认本场响应实际可解。 |
| `RoomDataSyncMessage` / WRDS | **外层已解；7 种已知子类型有 schema decoder** | 保留 sync type、trace/request ID 和 payload 字节数；对 RoomLinkMic、连麦设置、LotteryInfo、RoomChannelSettings、DoubleLike、AudienceGift、InteractEffect 子类型按白名单提取字段；未知类型仍只留长度。当前仅有静态 schema 与合成字段测试，没有本场 WRDS 样本。 |
| 关注/分享/粉丝团、表情/醒目留言、房间公告、榜单变化 | **源码 decoder 支持；本场类型覆盖未证实** | 结构化事件进入有界只读活动日志，不触发自动回复。用户、文字、榜单条目和可确认外层字段按公开 proto 取值；平台版本、action enum 和实际下发仍要实测。 |
| RoomNotify 内层、未知 WRDS 同步数据 | **仅外层字段已解；未知内层未解** | RoomNotify 只留通知类型/子类型及 opaque bytes 长度；未知 WRDS 只留 sync type、ID 和 payload 长度。已知七种 WRDS 子类型按当前网页 proto 提取白名单字段，但仍待真实样本核对。 |
| 语音转写、置顶评论、轻量礼物、直播购物状态/商品列表变化、直播间横幅、榜单奖励 | **源码 decoder 支持；本场类型覆盖未证实** | 只保留文字、时长原值、礼物 ID/数量/单价、推广 ID/商品 ID、榜单值等字段；语音媒体 URL、横幅 bytes 和商品未知 JSON 不记录。轻礼物可能是粉丝票/人气票，不能等同付费收入。 |
| 福袋/抽奖、红包预览、中奖提示 | **支持活动 method 信号及红包摘要；活动详情不完整** | Lottery/LuckyBox 多数公开定义只有 Common 头，因此只给出方法类别；红包预览保留 ID、时间、数量、状态和金额字段，不保留图标 URL。目标房间是否下发和字段单位仍需现场验证。 |
| 评论点赞的完整明细、任务/活动、付费直播状态 | **仅部分 method 可见** | ChatLike 可还原部分消息 ID 和点赞计数，无法证明完整覆盖或恢复全部评论文本；小游戏状态只覆盖一个结构消息。其余类别需当前网页样本，不能由 WRDS/REST path 推断后台数据。 |
| 在线人数、观众榜、榜单分页、礼物目录、连麦对象/状态 | **页面可见或接口路径存在；扩展未接入完整数据模型** | REA 只保留了只读请求路径、参数名和状态，没有 JSON body。可以通过 bundle 追踪响应字段访问；对于实时值还需不同账号/房间状态下的响应样本。在线观众 DOM 是虚拟列表，不能等同全体在线观众。 |
| 任意 UID 的完整用户资料 | **当前不支持批量/任意用户查询** | decoder 只取 IM 消息中携带的用户子集；`IdentityReader` 只查主播和当前登录用户。观察到 `/webcast/user/` 请求不能证明页面授权返回所有用户字段，也不能证明该接口适合作为扩展数据源。 |
| 音视频流、画面内容、回放、历史弹幕、私信 | **本扩展未读取** | 与互动 IM 不同的媒体或历史能力；现有 protobuf 解码器不处理媒体流，本次也没有尝试绕过访问控制或保存直播媒体。 |

这里要区分两种“不能”：WRDS、关注等是**实现缺口**，协议样本齐全后可能新增 decoder；HTTP 响应体、REST JSON 字段则是**证据缺口**，目前不能负责任地给出 schema。对 protobuf 的通用 wire 结构可以逆向，但字段语义仍需 schema 或多条可对照样本，不能只靠字段编号猜测。长轮询解析器现有合成测试覆盖 PushFrame 与裸 Response；仍需在当前直播页诊断中看到 `解码帧` 和 `事件` 增加，才算确认真实 body 兼容。

## 可尝试扩展的协议消息

以下优先级来自公开的社区逆向 schema 和脱敏样本目录，不代表这些 method 已在 Lucy 小露本场出现。公开参考列出 80 多种 method，并给出不少独立样本；它可以指导 decoder 原型，但不能代替本地页面运行版本的线上确认。

| 优先级 | 候选 method / 数据 | 可恢复的信息 | 判断与风险 |
| --- | --- | --- | --- |
| 已实现，待本场确认 | `WebcastRoomStatsMessage`、`WebcastRoomUserSeqMessage` | 在线人数/显示字符串、累计观众或人气值、贡献榜部分用户/分值/名次 | 源码支持且字段有公开 schema 参考；本机 Chrome CDP 不可达，未证实本场实际下发这些 method。榜单是平台提供的部分 top rows，不是全体在线用户。 |
| 已实现，待本场确认 | `WebcastSocialMessage`、`WebcastFansclubMessage` | 关注/分享 action、分享类型/目标、粉丝团加入或升级、事件用户 | action 原值保留；仅把已知 action 映射成名称。线上 enum/展示与跨版本行为待验证。 |
| 已实现，待本场确认 | `WebcastEmojiChatMessage`、`WebcastScreenChatMessage`、`WebcastPrivilegeScreenChatMessage` | 表情文字/ID、醒目留言文字、优先分值及用户 | 富文本只拼已识别的 string/user/pattern/image-alt 片段；未知节点不猜。事件为观察记录，不进入普通聊天回复规则。 |
| 已实现，待本场确认 | `WebcastRoomMessage`、`WebcastRankUpdateMessage`、`WebcastRoomRankMessage` | 房间文本/欢迎标记、榜单类型和名次、有限用户榜单 | 只读记录；显示时长、榜单 enum 及字段版本待真实样本对照。 |
| 已实现，待本场确认 | `WebcastAudioChatMessage`、`WebcastHighlightCommentMessage` | 语音转写、音频时长原值；置顶评论内容、作者及显示区间 | 音频 URL 不保留；时间单位与页面表现需真实包验证。 |
| 已实现，待本场确认 | `WebcastLightGiftMessage`、`WebcastLiveShoppingMessage`、`WebcastProductChangeMessage` | 轻礼物 ID/数量/单价；当前推广 ID、有限商品/分类 ID 列表 | 轻礼物价值不一定是现金收入；未知商品 JSON 和完整商品目录不读取，也不代表订单或成交额。 |
| 已实现，待本场确认 | `WebcastInRoomBannerMessage`、`WebcastRanklistAwardMessage` | 横幅类型/负载长度、榜单奖励字段 | 横幅内层可能有推广内容，只记录负载长度；榜单字段 enum 待真实样本核验。 |
| 已实现，待本场确认 | `WebcastChatLikeMessage`、`WebcastUpdateFanTicketMessage`、`WebcastProfitGameStatusMessage` | 弹幕目标消息点赞计数、房间粉丝票总量、小游戏标题/状态及有限属性 | ChatLike 实际版本的计数结构与公开 schema 有差异；粉丝票不是礼物收入；属性列表有界且不展开未知 JSON。 |
| 已实现，待本场确认 | `WebcastGiftSortMessage`、`WebcastRoomIndicatorMessage` | 礼物面板排序场景、房间标记类型和内层长度 | GiftSort 的 scene 在脱敏样本中是嵌套消息而非直接字符串；RoomIndicator 内层不展开。 |
| 已实现，待本场确认 | Lottery/LuckyBox/PrizeNotice 与 `WebcastPreviewCjRpMessage` | 活动 method 类别；红包预览的数量、状态、金额和时间字段 | 抽奖/福袋公开定义大多只有 Common 头，不能还原参与者或结果详情；红包 URL 不持久化。 |
| 外层/已知子类型可解 | `WebcastRoomNotifyMessage`、`RoomDataSyncMessage` | 通知 subtype；WRDS 已支持连麦 roster/设置、抽奖计数、频道开关、双击点赞和礼物接收人 | 未知 WRDS 仍只记录类型及长度；已知分支需本场样本交叉核验。 |
| 中低 | OEC / ItemShare 与订单侧接口 | 商品分享上下文或商品目录补充 | 商品事件 decoder 只读取推广/商品 ID 子集；不能由此推断下单用户、订单、成交额或后台数据。页面自然响应的商品目录还没有 schema 样本。 |
| 中低 | Linker / LinkMic guest state 类消息 | 嘉宾加入/离开、麦位变化、连麦状态和参与者 | 可在出现实际 method 后利用公开 proto 逆向；与当前已经支持的 PK 比分/贡献榜是不同消息族。不要误把普通连麦状态当 PK。 |

公开参考：[`douyin-live-proto` schema 与脱敏样本说明](https://github.com/opedium/douyin-live-proto)、[字段/样本参考](https://github.com/opedium/douyin-live-proto/blob/master/docs/complete_payload_reference.md)、[TikTokLiveJava webcast.proto](https://github.com/jwdeveloper/TikTokLiveJava/blob/master/API/src/main/proto/webcast.proto)。这些是社区逆向工程，不是抖音官方协议保证；抖音 Web 端和 TikTok 消息版本也可能不同。参考资料把 Response 容器描述为 `messages=1`，单项含 method/payload/msgId，并提供本文所列方法的候选字段与部分样本。新增方法在技术上可解，但业务语义必须以实际网页版本和独立事件样本复核。

## 脱敏 payload 交叉验证

本轮直接把扩展 decoder 跑在 `douyin-live-proto/sampled_payload` 的 18 个脱敏业务 payload 上：AudioChat、ScreenChat、PrivilegeScreenChat、Room、RoomRank、RoomStats、RoomUserSeq、Social、Fansclub、RoomNotify、RoomDataSync、LightGift、InRoomBanner、RanklistAward、ChatLike、ProfitGameStatus、GiftSort、RoomIndicator 均能返回相应事件类型；RoomRank/RoomUserSeq 各解出 3 条榜单行，ScreenChat/AudioChat 解出文本，ChatLike 样本解出 100 条更新、首条计数为 3。RoomNotify/RoomDataSync 样本没有完整内层字段，故这里只核对外层。另有 PreviewCjRp 红包预览、PrizeNotice 脱敏样本可交叉检查；该仓库没有 Lottery/LuckyBox 对应样本文件，这些活动信号目前只由构造字段测试覆盖。

样本也揭示公开 schema 版本差异：一份 ScreenChat 样本把文本放在字段 4、字段 3 放时间；一份 RoomNotify 样本的字段 2 是不透明 bytes，而网页 proto 另有该字段为 scheme URL 的布局。decoder 已兼容 ScreenChat 文本/时间两种布局；RoomNotify 仅在字段 2 确实以 URL scheme 开头时作为 URL，否则只记长度，不猜它是用户或 URL。`ProductChangeMessage.bin` 在该仓库中不存在，因此商品变更目前只通过字段构造测试验证。上述脱敏样本是独立社区样本，不是 Lucy 小露本场流量，也不是官方协议保证。

## REA 运行时调查结果

已加载本机 `reverse-engineer-anything` 技能，并尝试 REA `list_browser_targets`：指定 loopback CDP `http://127.0.0.1:9222` 后返回 `endpoint_unreachable`。REA 没有连到当前 Chrome；随后用 REA 启动了独立、未登录的 Chromium，在公开直播页做受控只读采样。当前登录 Chrome 的 DOM快照与该隔离会话并非同一身份环境。

REA 证据 `ev_f4608e011c26f1b245aa593b6f66b3bd1c58c51bf755b7c11c049d72a97c66f6`（controlled replay，Chromium 155）记录 8 秒窗口内 1,314 个网络事件、0 个采集丢失。`GET /webcast/im/fetch/` 出现 6 次请求、5 次 HTTP 200 响应；请求参数名包含 `resp_content_type`、`identity`、`room_id`、`cursor`、`internal_ext` 等。这里只保留方法、路径、状态和参数名，签名参数值不进入报告。窗口内还观察到以下抖音页面同源只读请求返回 HTTP 200：

| 路径 | 观察到的请求参数名 | 能支持的判断 | 未确认内容 |
| --- | --- | --- | --- |
| `/webcast/ranklist/audience/` | `rank_type`、`room_id`、`anchor_id` 等 | 页面读取观众榜/榜单数据 | 返回条目字段、分页、是否包含全量榜单 |
| `/webcast/linkmic/list/` | `channel_id`、`offset`、`count`、`link_status`、`anchor_id` 等 | 页面请求连麦相关列表 | 对象含义和主播/观众权限差异 |
| `/webcast/user/` | `target_uid`、`sec_target_uid` 等 | 页面按目标用户取资料 | 响应字段及可访问范围 |
| `/webcast/setting/` | 房间、设备和语言参数 | 页面读取房间设置 | 哪些字段对观众开放及稳定性 |
| `/aweme/v1/web/solution/resource/list/` | `spot_keys`、客户端能力等 | 页面请求播放器/直播资源配置 | 响应结构和扩展可安全使用的字段 |
| `/webcast/im/fetch/` | `resp_content_type=protobuf` 等 | 当前公开页面确实轮询 protobuf IM 接口 | 响应体没有被捕获；解析器现已支持公开参考中的裸 Response 以及 PushFrame 外壳，但真实 framing 尚未实测 |

静态检查该次加载的公开主 bundle（`client-entry~1.28f20eec.js`）确认其 IM transport 配置包含 `im_path:"/webcast/im/fetch/"`，且它将 `RoomDataSyncMessage` 注册为 WRDS 订阅消息。此处是当前公开网页 bundle 的观察，不是对所有浏览器、登录身份或以后的版本作保证。

本轮再通过隔离 Chromium / REA 分析当前页面实际加载的 76 个 JavaScript 资源，REA AST 解析 76/76、0 个解析失败，证据 `ev_083c30095a85d58ad6c6d74614266de590ac9d007ff5501a04896dd2eee34e3a`。来源映射不可用，REA 的通用 endpoint 候选只识别出监控上报 URL，没有恢复抖音 API 的字段消费调用链；静态分析完整度标记为 partial。另一条被动检查证据确认源码和网络请求可以观察，但网络正文与 WebSocket payload 按工具策略不保留。因此接口 path 能证实网页有请求，不能证实完整 schema 或权限边界。

另在用户当前已登录的直播页扩展诊断中观察到：WebSocket 观察器已安装、1 条抖音消息连接在线，已累计解析 187 帧、143 个结构化事件，解析失败 0，礼物事件 5。页面检查时刻最近礼物为热气球 ×2、520 钻/件。该诊断只给汇总，不提供原始帧/完整弹幕导出；它证明这个登录会话目前能走 WebSocket 并解出事件，不能证明所有会话都不用 HTTP long-poll。最近礼物一栏显示约 `-1.79e12 秒`的平台时间偏差；源码只在时间字段大于零时展示偏差，并将公共时间字段乘以 1000。诊断没有暴露原始时间值，故这是一个待验证的时间单位/字段缺失风险，不足以单独判定协议 bug。应以脱敏原始帧和解析前后数值核对后再修复；当前确认解析成功的是事件结构，不是其时间戳正确性。

当前页面确实在 Chrome 中打开，DOM 可见目标直播内容；现有浏览器连接器只暴露标签页状态/DOM，未暴露可直接传给 REA 的 CDP endpoint。隔离会话没有复用用户 Cookie，也没有采集登录态；REA Scenario 明确表示 response bodies are not retained。因此可以确认平台当前页面走 protobuf HTTP 拉取，但不能确认它返回的消息是否与扩展已有 PushFrame 解码器相同，不能报告真实弹幕/礼物/PK 方法分布或把鉴权后接口说成已解码。

## 可确认的“能拿到什么”

可以确认源码设计能在直播页面会话中监听并解码指定的直播 IM 事件：弹幕、进场、礼物、点赞、特定结束控制消息、若干 PK 消息、RoomStats/RoomUserSeq、Social/Fansclub、表情及醒目留言、语音转写、置顶评论、房间公告/榜单事件、轻礼物与部分商品状态；RoomNotify 只解外层，RoomDataSync 对七种已知 sync type 有白名单 decoder。未知 method 与尚未实现 decoder 的 subtype 不解释字段，但新版扩展会保留其原始协议帧供离线复解。协议用户对象还包含 UID/安全 UID/展示 ID、昵称、财富等级、粉丝团信息；但这些字段仅在平台消息实际提供且解码字段仍匹配时可用。扩展另能从当前页面提取部分 DOM 播报和公开可见贡献榜行。

不能据此确认扩展可以得到：所有在线观众及其完整个人资料、关注/取关的完整事件流、所有直播运营/带货订单数据、后台统计、完整礼物目录、主播实时音视频内容、平台未下发的私有信息、所有直播间都稳定一致的完整事件。当前研究没有取得本场登录态的真实 IM body 或 REST JSON，因此无法给出本场 socket 方法分布、每类事件真实样本数量或漏报率。

## 本轮补充：当前页面可见但未接入的数据

2026-10-21 对用户当前已登录直播页做了两次只读 DOM/无障碍树检查，没有刷新页面或触发互动。两次快照间在线数从 11 变到 12、本场点赞显示从 6,536 变到 6,553，说明这两项展示值在页面运行期间更新；粉丝团卡片显示 62 名点亮成员，礼物快捷栏列出 16 种礼物及钻数，贡献榜区域展示有限行。数字是检查时的瞬时页面值，不是协议完整性或历史数据保证，也没有把观众昵称写入本报告。

新增快照解析器后，用相同选择逻辑再次对仍打开的直播页做只读查询，得到在线 17、本场点赞 6,554；两项均来自主文档可见数字。该次对照验证了当前 DOM 结构与解析规则，扩展本身未因本轮代码改动而刷新，故还不能算构建后注入验证。

| 数据 | 当前观察到的可读面 | 扩展现状与边界 | 逆向判断 |
| --- | --- | --- | --- |
| 在线人数 | `#chatroom` 下的“在线观众”标签及其相邻数字 | 工作树新增只读 DOM 快照；缺节点/格式变化时留空；RoomUserSeq decoder 仍单独保留协议值 | 可读页面可见值；必须确认格式化计数、短暂缺失和消息更新频率，且不能与协议累计量混用 |
| 本场点赞总数 | 主文档中“本场点赞”旁的计数 | 工作树新增只读 DOM 快照；LikeMessage decoder 的增量/累计字段仍不作为 UI 总数替代 | 页面文字可读；仍需观察二者同步关系，不能把 LikeMessage 字段直接认定为权威 UI 总数 |
| 贡献榜/观众榜 | 直播间 DOM 有分类标签和少数行；当前 readAudienceContributions 专门读有限贡献榜 | 已接入的是可见贡献榜校准，不是在线观众完整列表；DOM 虚拟化、分页和切换分类都会隐藏其他行 | 继续读当前可见榜单可行；要拿完整榜单需找到自然请求分页响应并核对权限与分页终止条件 |
| 粉丝团人数、团排名、团力值、活动任务 | 无障碍树可见粉丝团卡片；本次扩展页面脚本无法从主文档访问跨源嵌入 frame 的 DOM | 目前未纳入扩展数据 | 可先从父页面 bundle 的 message bridge 或自然网络响应追踪数据来源；跨源限制不能靠父页面 selector 绕过，也不能假设 iframe 向父页暴露了完整模型 |
| 快捷礼物目录与价格 | 无障碍树列出当前货架 16 项；尝试父文档/shadow-root DOM 查询没有找到货架节点，呈现内容位于嵌入 frame | 扩展礼物名/ID/价值来自实际送礼 IM；GiftSort 只解面板场景/排序，不是礼物目录 | 先分析货架 iframe 的加载 bundle 和其自然请求响应 shape；不模拟购买、不调用送礼接口。即使拿到当前货架，也不代表完整可用礼物目录 |
| 在线观众全量及个人资料 | 页面只展示有限可见名单/榜单行 | 现有协议对象只包含平台在事件或榜单中附带的用户；不做任意 UID 批量查询 | 公开 `/webcast/user/` 路径只能证明页面有按对象取资料的请求，不能证明可枚举、全量或获准批量获取 |

REA 的本机 CDP 端点仍返回 `endpoint_unreachable`，所以这轮无法把 DOM 字段追到页面 React 状态或真实 REST/IM 响应体。普通父文档 DOM 查询也明确无法穿透跨源 frame；无障碍树能呈现 frame 子页面，不代表扩展 content script 具备同样访问权限。工作树已实现主文档在线数/点赞快照并在“连接诊断”显示；单测覆盖正常值、格式化计数、冲突和缺失情况，但需刷新直播页加载当前代码后才能验证线上选择器。粉丝团卡片和礼物目录应先从各自 frame bundle/自然请求建立字段证据，再决定是否扩展权限或只读消息桥。

扩展面板同一时刻显示本地当日礼物账本 203 钻、7 件，近期 10 分钟汇总曾显示点赞事件 0、礼物 2 件/99 钻。前者按本地观测的礼物消息累计，后者是有限时间窗互动事件；它们与平台本场点赞总数、在线人数不是同一口径。这个差异不是解码失败的证据，但说明后续快照应保留 `source`、`window` 与采样时间，不能把页面累计量、协议增量、扩展触发事件混成一个指标。

## 当前网页 bundle 逆向补充

从页面资产清单取得并静态检索本场已加载的主站 chunk，没有执行 bundle，也没有读取或复用 URL 查询参数。当前资产以文件名和 SHA-256 固定版本：`RoomInfoBar.56ddbdca.js`（`98f0455c48d3e25d3056c3fca871090f266077d57aeed1113a9bf330df49c85b`）、`LiveUserProfile.9fd8db6e.js`（`f0e82ce4ea355dc5930179f654587d73576dd2f4eaff8dcca61484c22cc241fd`）、`RoomMessageConsume.1e33b586.js`（`b7387e639b28e03a5f280b6c4b8a6bdc37809f69deb084518be22308854002c2`）。这是当前页面构建的静态源码观察；不是 REST 响应样本，也不证明每个面板都已请求过。

| 页面模块 | 源码里确认的读取路径与字段 | 能说明什么 | 仍未知 |
| --- | --- | --- | --- |
| `RoomMessageConsume` | 订阅 `RoomStatsMessage`；按 `display_version` 丢弃旧版本，增量值不大于当前值时也忽略；采用 `display_long/middle/short/value/version/incremental/is_hidden` 更新 room store | 网页自身以 IM RoomStats 作为房间展示统计来源；现有 decoder 字段映射基本对齐这条消费逻辑 | 当前房间实际广播频率、不同 `metric_type` 的具体含义以及点赞总数是否也走该消息 |
| `RoomInfoBar` 观众榜 | GET `/webcast/ranklist/audience/`；另有独立 GET `/webcast/ranklist/paygrade_seats/` | 观众榜和付费等级席位榜是不同数据集；不能把一个 decoder 结果称为全体在线用户 | 两个 endpoint 的响应对象字段、分页/排序和权限差异，仍无真实 JSON 样本 |
| `RoomInfoBar` 粉丝团 | GET `/webcast/fansclub/homepage/`、`/webcast/fansclub/me/`、`/webcast/fansclub/club_user_list/`；成员列表调用使用 `anchor_id`、`anchor_open_id`、`offset:0`、`count:100`。页面把 me 响应中的 `user_fansclub_info.task_infos` 映射到 `cardInfo/taskList`，读取 `fansButtonInfo`、任务完成和礼物进度 | 可读页面代码确实会查询粉丝团卡片/成员；成员列表有至少 100 条的首屏容量，但当前调用未显示分页继续条件 | 服务端是否返回下一页、团成员数与当前直播“点亮成员数”是否同一统计、未展开卡片是否触发请求 |
| `RoomInfoBar` 礼物展馆 | GET `/webcast/gift/exhibition/home/`、`/rare/`、`/achievement/detail/`、`/gift/detail/`；请求含房间/主播以及 group/task/gift 标识。礼物墙展示消费 `gift.gift_id/name/diamond_count/type`、`advanced_task.threshold/current_count`、`is_lighted` | 可逆向到展馆/任务礼物目录和钻数，不只是当前 16 项快捷栏；部分详情按 group/task/gift 单项加载 | 展馆覆盖范围不等于当前房间完整可送礼目录；实际响应、组分页和排序尚未捕获 |
| `GiftMenuPlugin` / `giftStore` | 礼物弹层订阅 `GroupLiveContainerChangeMessage`；`container_payload` 可解析为含 `data` 的 JSON，弹层使用 `data` 中的礼物 ID/名称/图标，并按 ID 与 `giftStore.giftList` 合并价格。`giftStore.giftList` 是从 `giftPages` 计算出来的；当前已分析入口 bundle 中能定位 `setGiftPages` 写入器，但没有定位到它的实际调用方 | 找到了当前页面礼物弹层的候选目录输入，以及价格补全链路；若自然消息到达且扩展能合法观察到该消息，可能获得该弹层实际展示的礼物子集 | `container_payload.data` 是否覆盖全部可送礼项目、是否分页/按场景裁剪、`giftPages` 的上游赋值模块，以及该消息是否经过主直播 IM socket，均未验证；这不是完整礼物目录或已接入扩展的能力 |
| `LiveUserProfile` 用户资料 | GET `/webcast/user/profile/`；按目标 `target_uid/sec_target_uid` 及主播/房间上下文请求；消费 `user_profile.base_info`、`user_profile.profile_tag_content` 和 `user_data`，包括昵称、关注/粉丝数展示字段、财富等级、粉丝团徽标等 | 页面通过显式打开某个用户资料卡读取资料，不代表批量枚举接口；源码有“主播设置不支持查看他人资料”的权限分支 | 哪些字段会按用户/房间/隐私设置裁剪，以及对非点击用户的访问权限 |

同一 bundle 还包含加入/退出粉丝团、切换自动点亮、送礼、关注、禁言、拉黑等写操作。本研究没有调用这些接口，也不应把它们混入只读采集。上述静态观察将后续逆向目标从“猜 URL”收敛到“通过页面自然访问取得脱敏响应 shape，再按 UI 消费字段实现白名单”；当前 REA/CDP 不可用，响应 schema 仍未被验证。

## 新发现与优先级

### 下播前最后一轮：新增可解消息族

依据当前网页公开 bundle 中的 protobuf schema 和 GiftMenu 消费代码，扩展工作树新增了以下只读 decoder，并纳入暂停状态下的有界活动日志与事件持久化：

| 消息族 | 当前抽取字段 | 证据边界 |
| --- | --- | --- |
| `GroupLiveContainerChangeMessage` | 礼物候选 ID、名称、价格、图标；只保留白名单字段 | 静态消费链确认容器 JSON 的 `data` 被礼物弹层使用；没有本场原始消息，不能称作完整礼物目录 |
| `WebcastBattleBonusMessage` | MVP、奖励道具、参与者和钻数 | 字段映射来自公开 schema；没有本场奖励 payload 交叉核验 |
| `WebcastBattlePropertyMessage` | 房间及生效道具 ID、名称、数量、时间窗口 | 可解外层结构；道具具体效果仍不推断 |
| `BattleSeasonHonorMessage` | 荣誉类型、名称、进度、解锁标记、关联用户 | 当前页面没有观察到对应事件，语义和版本仍需样本验证 |
| `PopularCardMessage` | 状态、开始/结束时间、进入人数 | 字段级合成测试通过，平台状态枚举未确认 |
| `FansclubStatisticsMessage` / `FansclubV1PushMessage` | 粉丝团名称与人数；粉丝团播报文字、动作类型和显示时长 | 消息 schema 字段明确；粉丝团人数口径及实际播报类型仍待在线对照 |
| `GroupLiveMemberChangeMessage` | 团播成员用户、成员分数和分数显示标志 | 只覆盖消息附带的有限成员，不代表全部团播用户 |
| `GroupLiveIncomeChangeMessage` | 团播成员收入、礼物收入、守护收入及守护人数 | 仅当平台消息主动下发时可读；无本场 payload，收益口径和单位未经实测 |
| `RoomTicketMessage` | 房票动作、时长、票 ID、房主 ID、带货开关状态 | 跳转 URL 不采集；不能据此推断购票用户或交易金额 |
| `LinkMicPositionMessage` / `LinkmicGuestLinkMessage` | 连麦席位/审核状态、嘉宾用户、频道人数、分数和时长 | 与 PK 比分消息区分；当前 schema 下可解析有限参与者，不代表完整连麦 REST 列表 |
| WRDS 已知子类型 | `RoomLinkMicSyncData`、`RoomLinkMicAnchorSettingsSyncData`、`LotteryInfoSyncData`、`RoomChannelSettingsSyncData`、`DoubleLikeSyncData`、`AudienceGiftSyncData`、`InteractEffectSyncData` | 按 `sync_type` 白名单分流并只记录确认字段；未知 subtype 不解析 | 依赖服务端 `sync_type` 与当前 proto 一致；本场 payload 不可用，尚未在线验证 |

这些事件已进入只读记录路径，不参与回复或发送。协议字段测试使用合成 protobuf/JSON 样本，构建通过；它们验证代码映射和白名单行为，不证明目标直播间真的下发这些消息。主播下播后没有继续生成新的在线样本，因此本表所列消息族均应标为“源码支持、待下一场实测”。

1. **验证 IM 轮询覆盖（最高优先级）**：扩展已被动挂接同源精确路径的 XHR，并复用 WebSocket 解码与交付队列；按消息 ID 跨传输去重。REA 未登录 Chromium 观察到 `/webcast/im/fetch/` 成功响应，但不保留 response body；当前 Chrome `127.0.0.1:9222` 仍不可达。解析器现支持裸 Response 和 PushFrame 两种封装，合成集成测试通过；需在目标标签页查看 `IM 长轮询` 的响应、解码帧和事件计数，并以未知 method 计数判断真实活动类型。
2. **验证已接入 decoder（高优先级）**：诊断新增类型计数和已解事件是否递增；有真实 method 之后，再对照页面可见人数、贡献榜、关注/粉丝团播报、公告和醒目留言。当前协议单测验证字段映射，但不等同目标直播间线上兼容验证。
3. **补 WRDS 和只读资料面（中优先级）**：七种 WRDS 子类型已按公开 schema 做白名单解析，但尚需页面自然流量的脱敏样本复核；其余 sync type 暂不解释字段，新版扩展会保留原始帧。观众榜、完整连麦列表、单用户资料和房间设置则需要取得页面自然请求的脱敏 JSON shape。当前 REA 证据只有 endpoint/参数名与 200 状态，没有字段 schema。付费直播类型修改只说明房间能力状态，不应推断用户消费。
4. **追礼物目录赋值链（中优先级）**：从当前页面全部已加载 bundle 搜索 `setGiftPages` 的调用方，并区分房间快捷栏 `GroupLiveContainerChangeMessage`、giftStore 中的送礼页数据与礼物展馆接口。仅在页面自然访问时观察到的字段可作为样本；不要为取目录主动调用送礼、付费或粉丝团写接口。
5. **扩展采用边界（后续）**：风控统计、监控上报、资源配置、完整用户资料、主播端管理接口也出现在页面网络中，但不是互动数据的首选采集面。写操作接口（关注、点赞、禁言、连麦确认等）不属于读取需求，本研究没有调用，也不建议把它们接入数据采集。

**能否解码**：技术上可行，当前源码也已经增加若干只读 decoder。`decodeFrame` 可处理 WebSocket PushFrame（gzip/deflate payload）和直接 protobuf Response，但 `/fetch` 的真实 body 仍未在本场验证。消息名、字段号和基础 wire type 可从公开逆向 schema 或样本实现；业务含义要再和实际事件、页面渲染交叉核验。WRDS 有七种 schema 明确的白名单子类型已实现，其他同步类型、RoomNotify 内层、REST JSON 响应及榜单分页仍没有足够运行时证据，不能仅凭 path 或字段号猜测。

## 2026-10-21 补充：扩展原始协议帧持久采集

已将协议帧采集接入扩展数据层。适配器在 WebSocket 与同源 `/webcast/im/fetch/` 二进制响应进入业务去重/引擎之前，复制收到的原始帧字节；记录传输来源、收到时间、字节数、每条 protobuf 消息的 method/message ID/已解事件类型，以及可得的解析错误。未知 method 和已识别 decoder 不完整的帧保留在同一原始帧日志，可用于后续离线复解。压缩帧保存的是平台实际传输的压缩字节，不是重新编码后的 protobuf。

原始帧走独立于业务事件日志的 MAIN → 隔离 content → MV3 后台持久化通道，按直播间 ID 隔离，后台重启后仍可分页读取，并纳入“导出恢复数据”。该日志不会随业务事件确认而删除，也不参与回复或发送。已知类型的结构化事件白名单也已补齐礼物目录、团播收入、连麦席位等近期 decoder 输出；如果某个结构化事件超过业务日志单条上限，原始帧仍保留作为复解来源。

当前限制需要按实测边界理解：单帧原始内容最多保存 512 KiB，超出的帧只保存元数据并标记 `FRAME_TOO_LARGE`；MAIN 桥与隔离脚本各有 8 MiB 待交接预算；扩展本地存储达到 80% 后停止新增协议记录并计为采集缺口。错误、过大帧、缓冲溢出和后台存储失败都会显示在采集状态并进入恢复导出计数。数据只保存在本机扩展存储，导出可能含观众文本和标识。以上是当前工作树和合成测试确认的实现能力，不代表主播下播后实际捕获到了新增在线 payload；还需在下一场直播加载新构建，检查协议帧计数、缺口计数并导出样本验证。

## 建议的验证矩阵

要把“源码支持”提升到“线上实测”，用已连接的 REA 对同一页面只读捕获至少覆盖以下状态：普通聊天、@提及、进场、关注/加入粉丝团、单礼物、连击礼物、点赞、榜单更新、PK开始/比分/结束、直播断线/重连、房间结束。每种事件需要同时记录目标 origin、method 名、脱敏后的字段形状、解码事件和页面可见结果，并检查未知 method 与队列缺口。记录时只留必要字段，不导出 Cookie、Authorization、完整 secUid 或无关用户资料；完成采样后对照更新 [protocol.js](../../src/browser/protocol.js)、[adapter.js](../../src/browser/adapter.js) 和协议研究记录。

## 证据与置信度

- **现场直接观察（当前页面 DOM）**：主播页标题、礼物货架、点赞/在线人数、榜单分类、少量观众及公屏文本。受限于一次页面快照与虚拟列表，不能代表完整历史或全量用户。
- **源码观察（当前工作树）**：扩展所监听的 WebSocket URL 范围、事件类型、 protobuf 字段映射、身份识别调用和 DOM 读取逻辑。注意工作树有用户未提交改动；本文只把这些实现作为当前检查对象，不把它们说成已发布构建的保证。
- **已观测但未解码**：REA 隔离 Chromium 确认公开直播 IM protobuf 轮询和若干只读 REST 接口的路径/参数名/状态；不包含用户登录态，且 response bodies 未保留。
- **未知**：当前登录 Chrome 未向 REA 暴露 CDP endpoint；尚未拿到用户会话下的原始 protobuf body、REST JSON 字段样本、WebSocket 与 long-poll 的完整切换条件或所有互动类型的线上逐条对照。平台协议会变化，需在具体运行版本和直播状态下复验。
