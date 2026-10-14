# 抖音直播运营助手：功能调研与实现取舍

调研日期：2026-10-14。以下比较基于产品公开说明，不等于购买、安装或实测竞品；“未说明”不代表产品没有该功能。未采用竞品脚本代码。

## 市面产品

| 来源 | 公开文档说明 | 对本项目的启发 |
| --- | --- | --- |
| [LiveBot 项目](https://github.com/TanMusong/livebot-assets) / [油猴发布页](https://greasyfork.org/zh-CN/scripts/579676-livebot-%E6%8A%96%E9%9F%B3%E7%9B%B4%E6%92%AD%E6%99%BA%E8%83%BD%E5%9C%BA%E6%8E%A7%E5%8A%A9%E6%89%8B) | 普通/高等级欢迎、点赞/礼物感谢、AI @回复、兼容模型接口、对话记忆、节流、预览、独立房间配置与日志 | 油猴形式可覆盖核心流程；增加明确的粉丝团归属核对和人工审核 |
| [云云暖场感谢](https://www.yx-zhibo.com/help/thanks/) | 进场、点赞、下单、礼物独立开关，多行轮播和昵称变量，建议控制高频触发 | 礼物与欢迎分开配置；感谢优先于常规发言 |
| [云云关键词回复](https://www.yx-zhibo.com/help/auto-reply/) | 包含/全匹配、规则分组、排序、昵称变量；文档说明多规则命中会逐条回复 | 本脚本使用首条命中，避免同一问题多条刷屏，固定规则优先于 AI |
| [云云自动发言](https://www.yx-zhibo.com/help/auto-speak/) | 分组、间隔、轮歇、随机/顺序等节奏控制 | 多组定时、轮换、互动避让；不补发后台错过的任务 |
| [逍遥助手帮助中心](https://help.xydouyin.com/) | 搜索摘要描述语音播报、自动互动和礼物管理；正文访问返回 502 | 只作为市场线索，不用于精确功能对比 |

## 本次重点

| 能力 | 公开竞品说明可确定的范围 | 本脚本实现 |
| --- | --- | --- |
| 礼物感谢 | LiveBot/云云说明支持 | 钻石单价或连击总价阈值，未知金额跳过，可补价格表 |
| 点赞感谢 | LiveBot/云云说明支持 | 独立规则/AI 模式、话术轮换和按用户冷却 |
| 连击去重 | 上述介绍未明确说明累计值结算细节 | 同组累计数量取最大值，阶段结算只计新增数量 |
| 高等级欢迎 | LiveBot说明区分高等级用户 | 荣誉等级与粉丝团等级独立可配 |
| 本主播已点亮粉丝团 | 上述介绍未明确说明归属与状态联合条件 | 校验主播 UID、粉丝团等级与状态，缺字段不通过 |
| 指定用户欢迎 | 上述介绍未明确说明此精确规则 | UID/sec UID/显式精确昵称名单，可独立欢迎 |
| AI互动 | LiveBot说明支持 | 近期公屏、主播资料、触发词、冷场、调用预算与审核 |
| 定时消息 | 云云说明支持 | 多组、北京时间时段、跨午夜、互动避让 |
| 节流与预览 | LiveBot说明支持 | 全局优先级队列、逐用户冷却、文本去重、默认预览、可编辑审核 |
| 可诊断性 | LiveBot说明日志与浮窗 | 帧/事件/解析状态、拒绝原因、控件定位、规则自检与日志导出 |

这些功能是针对用户需求的组合与实现取舍，不能据此声称优于所有竞品。当前没有下单检测、语音播报、禁言、拉黑、评论置顶或多账号运营；核心关注“有条件地回应、少刷屏、可检查”。

## 实现依据

普通网页脚本复用浏览器已有登录和直播连接，只观察原页面接收到的事件，不另建带签名的直播连接，也不自行发送 ACK/心跳。[抖音直播 SDK](https://open.douyin.com/platform/resource/docs/ability/douyin-live-sdk/introduction) 是官方能力介绍，不应视为普通油猴脚本的公开授权 API。

消息字段参考 [DouyinLiveWebFetcher 的 protobuf 定义](https://github.com/saermart/DouyinLiveWebFetcher/blob/main/protobuf/douyin.proto)，自行实现 wire reader，UID 始终保留为字符串。粉丝团状态、礼物累计值等都是待真实帧进一步验收的页面协议适配，不能保证平台变更后仍有效。

2026-10-14 获取的抖音公开发布代码显示公屏为富文本编辑器，输入上限为 50；发送图标会随空/非空状态替换。静态证据来自 [ChatRoom](https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/ChatRoom.b626dcc2.js)、[聊天编辑区域](https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/island_237ab.480da559.js)、[RichTextEditor](https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/RichTextEditor.82a7f2f5.js)。因此采用编辑器纯文本粘贴路径、重新定位发送图标、对比实际输入。静态代码核对不等于已完成真实发送测试。

AI 采用可编辑的 Chat Completions 兼容接口，服务资料：[DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/)、[阿里云 DashScope](https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope)、[火山方舟](https://docs.volcengine.com/docs/ark/chat-api?lang=zh)。模型名称以服务账号当前可用项为准。油猴注入与权限依据 [Tampermonkey 文档](https://www.tampermonkey.net/documentation.php)。
