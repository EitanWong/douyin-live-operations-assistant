# 内容治理接口与判定边界（2026-10-24）

## 网页静态证据

此次复用本机已下载的抖音公开网页资源，按其 runtime 中的 chunk 名称与哈希，从公开 CDN 获取 `chunks/LiveUserProfile.3679af0c.js`。没有调用真实禁言或拉黑接口。REA 浏览器目标发现的 `http://127.0.0.1:9222` 返回 `endpoint_unreachable`，因此没有取得运行期响应证据。

| 资产 | SHA-256 | 观察 |
| --- | --- | --- |
| `LiveUserProfile.3679af0c.js` | `72b3598916b0f43212d1b43c83cc690a3061053d14952ad384b7b5153da91b0c` | 用户资料卡管理按钮通过模块 937589 的 `Bv` 禁言、`Vv` 拉黑；管理入口核对 `room.admin_user_ids_str`，排除主播及其他管理员。 |
| `client-entry~1.2eb38c7d.js` | `753fb39f23ac656847c60295193aad8e12c51c008b6bc185abc27bead657a958` | 模块 937589 的 `Bv` 向 `/webcast/room/silence/` POST；`Vv` 向 `/webcast/room/kick/user/` POST，使用空 body 与 params。 |

禁言调用传 `room_id`、`user_id`、`sec_user_id`、可选 `target_webcast_uid`；拉黑调用传 `room_id`、`kick_uid`、`sec_kick_uid`、可选 `webcast_uid`。网页将资料卡 `user_data.webcast_uid` 传入后两者；资料缺失时该字段可为 undefined。当前实现只使用消息中已知的 UID/secUID，不额外请求用户资料或猜测 webcast UID。若服务端要求 webcast UID，须根据平台拒绝结果和后续运行期证据再补充，不自动重试。

网页以 `response.data.status_code === 0` 显示成功提示；拉黑确认文案为“Ta将无法进入当前主播所有直播间”。这支持将该操作解释为主播直播间拉黑，不能解释为抖音账号全局封禁。源码中未见这里传禁言时长，助手不虚构自定义时长。

## 实现与验证

管理请求复用现有页面 HTTP 客户端，限制在当前房间，准备和提交时分别核对账号、房间、主播与管理员名单，要求目标有可靠 UID/secUID，排除本人、主播和其他管理员。固定的动作白名单只接受 mute/ban，不接受模型给出的 URL、UID 或操作指令。操作票据只执行一次；状态持久化成功后才允许提交。只有平台明确返回 status_code 0 才记为 accepted；明确拒绝与网络未知分别报告，未知不自动重试。

AI 审核是独立于聊天人设的 JSON 分类请求，仅传目标文本、最近有效文本上下文、启用类别与敏感话题规则，不传用户 UID。判定需含目标原文证据；低置信度、无效格式和证据不匹配不触发自动处罚。AI 失败时的本地命中只提醒；不会把模型提供的回复直接作为警告公屏发送。

单元测试覆盖逐次提醒、累计升级、严重处置、普通批评、无关键词 AI 检测、异常降级、预算/队列、迟到响应、去重、恢复、持久化失败、权限变化、同票据重复提交与未知结果。构建产物集成测试和浏览器模拟只证明本地流程正确，不能代替真实管理员账号下的平台执行验证。
