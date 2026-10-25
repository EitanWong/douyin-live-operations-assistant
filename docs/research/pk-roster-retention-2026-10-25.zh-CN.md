# 多人 PK 名单与展馆保级数据

2026-10-25 核对及修复。

多人 PK 开局播报过去只读 `opponentName`，而多人名单保存在 `competitors`，因此即使已有昵称也会播报“待识别”。现按参战 UID 汇总全部对手，排除己方，跨帧合并名单，补全所有对手房间归属；尚未发送的开局提醒可由迟到名单更新，保留原有效期且不重发。多人比分保持逐主播记录，不将任意一人或比分和伪装成单个对手。

官方网页 `live-schema-im.e322bd8a.js` 中 `LinkMicMethod` 字段 45 为 `User[]`，字段 58 为 `ListUser[]`，后者字段 1 为 `User`。比分更新可用这些资料补全昵称，但只接受同帧比分中明确出现的参战 UID。中途入场无需等待下一条完整开局名单。

实际直播页面只读观察到“甄选展馆 / 差1款保级”，位于 `live_pc_indicator_container_douyin` 的跨域 iframe。其已加载 `protocol-runtime.min.js?protocol_id=exhibition_section`，参数明确指定 `/webcast/gift/play/indicator/?activity_id=exhibition_section`。

- 接口采集复用直播页现有请求客户端，读取成功响应 `data.banner_detail.role2views` 中当前角色（默认 user）的生效 banners；从 `props` 或对应 `component_props` 的平台文案提取明确的保级款数。
- 协议补充解码 `RoomIndicatorMessage.biz_info`（字段 4）内的 `CommonBizInfo.contents`（字段 2），再读取 `BizContent.text_content`（字段 3）。未知业务载荷保持外层事件，不导致整条帧解析失败。
- 主页面可见文字及限定 CDN 路径的 iframe 内容脚本为后备；iframe 每 3 秒检查变化，同值至多每 30 秒更新一次。后台核对来源、frame、主播和房间，仅将数据转交原标签主页；主页再核对 iframe 与当前主播。
- 协议/响应在 2 分钟新鲜窗口内优先于网页后备。保留主播 UID、来源、采集时间及过期状态；未观测值不置零。
- 展馆 `home` 响应已解析的保级目标、升级差距、展馆类型现在进入统计及快照。列表可能不完整，因此不由已点亮列表推算“还差几款”。

展馆保级关联到 PK 段位数据区、PK 任务页、定时报送及新鲜 AI 上下文；保留它的“展馆保级”含义，不将“甄选展馆”覆盖为主播 PK 段位。

边界：未登录的独立请求返回 `status_code:20003`，需要复用已登录页面客户端。此次核对证实页面展示、接口地址与发布脚本消费结构；自动测试使用响应夹具，尚未逐次对照真实多人 PK 直播，也未将当前登录会话的原始指标响应导出保存。用户脚本可使用接口/协议和同源 DOM 后备；跨域 iframe 后备由 Chrome 扩展提供。
