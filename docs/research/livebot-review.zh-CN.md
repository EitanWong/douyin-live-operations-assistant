# LiveBot 参考脚本复盘

> 历史调研记录。当前功能与操作方式见[产品范围](../product/overview.zh-CN.md)和[使用指南](../guides/usage.zh-CN.md)。

分析对象：用户提供的 LiveBot 0.2.7 用户脚本。作者仓库声明 MIT 许可，公开说明见 [livebot-assets](https://github.com/TanMusong/livebot-assets)。对附件进行了静态解混淆和代码检查，没有在抖音页面执行脚本。

## 观察到的实现

- 每个直播间路径独立保存配置；功能开关、话术、冷却和日志分模块管理。
- 欢迎、较高等级欢迎、点赞、礼物、@回复使用独立 observer/handler；AI 回复提供八种语气预设和最近欢迎回复去重提示。
- 点赞、进场、高等级欢迎、礼物和聊天通过 DOM `MutationObserver` 读取；发送走直播网页的输入控件，不走独立弹幕 API。
- 礼物和点赞按昵称做冷却，点赞监听直播页面中的第二个消息容器。它没有本扩展已有的 UID 冷却、全局队列限速、礼物价值过滤和连击合并。
- AI 使用 Tampermonkey 的跨域请求能力发送到用户配置的兼容接口，API Key 放在 `Authorization` 请求头；静态检索未发现读取 Cookie、动态执行代码或自建 WebSocket。实际数据发送目标取决于用户填写的模型服务地址。
- 可见代码和菜单中没有管理员鉴权、封禁或禁言实现。

## 吸收内容

增加了独立的点赞感谢页，支持规则轮换、AI 生成、每人冷却、全局发送节奏、预览和逐条审核。点赞事件按公开 Protobuf 参考中的 `WebcastLikeMessage` 字段解析：用户字段 5、点赞数 2、累计数 3；映射见 [opedium/douyin-live-proto](https://github.com/opedium/douyin-live-proto/blob/master/docs/complete_payload_reference.md) 和 [TikTokLiveJava webcast.proto](https://github.com/jwdeveloper/TikTokLiveJava/blob/master/API/src/main/proto/webcast.proto)。这些是社区逆向协议参考，不是抖音官方 API 文档，真实直播仍需实际环境验证。

没有移植参考脚本的 DOM 选择器、请求封装或封禁能力。原脚本所称高等级欢迎主要依赖页面文案识别；本扩展继续使用可核验的荣誉等级、本直播间粉丝团归属和点亮状态判断。
