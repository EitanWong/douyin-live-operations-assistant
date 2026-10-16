# 验证记录

当前开发版本：0.1.1。最近完整验证：2026-10-16，169 项自动化测试通过，0 失败。

## 自动化覆盖

| 分类 | 验证内容 |
| --- | --- |
| 引擎与调度 | 条件欢迎、本人过滤、关键词优先、定时与时段、过期、礼物优先和机器人调度 |
| 礼物 | 累计连击、重复帧、乱序结束、补价、长断线保留、多种礼物缩短、1,200 条突发 |
| 机器人 | @身份匹配、分页菜单、各玩法、免 @参与、超时、失败结束、入队失败不推进会话 |
| AI | 调用预算、用户冷却、上下文、请求校验、失败回退、暂停后旧响应隔离 |
| 数据 | 多主播隔离、日/月汇总、跨日连击、历史比例、重复上报和后台重启 |
| 恢复 | 快照隔离、发送前落盘、在途任务恢复、日志回放、失败退避、待入账礼物重建 |
| 页面 | 表单、模块开关、输入草稿、富文本、SVG 发送控件、焦点和快捷键隔离 |
| 扩展 | MAIN / ISOLATED 交接、来源与房间校验、服务域名授权、开发更新 |
| 性能行为 | 空闲不通知刷新、稳定面板不重建、折叠日志不重绘、事件队列分段回收 |

新增运行时回归覆盖：2,400 条事件与日志回放交错、连续队列回收、慢存储合并写入、超过 100 条待确认日志、确认失败和页面离开。测试产物均在独立临时目录生成。

构建、源码与产物语法检查、Git 差异格式检查通过。测试命令及分类见[开发与测试](../development/contributing.zh-CN.md)。性能测量条件和数值见[性能审查](performance-review.zh-CN.md)。

## 测试环境

规则和数据用例使用模拟时钟；协议用例使用人工构造 protobuf/gzip 帧。页面与扩展集成使用 JSDOM 和模拟 Chrome 接口，并执行实际构建产物。

此前独立 Chromium 本地模拟器检查覆盖两标签互斥、释放与接管、连续启停、关闭持锁页接管和面板键盘隔离。最新模拟器页面可在真实浏览器中读取；本轮未取得浏览器性能 trace。

真实直播页曾只读核对富文本编辑器、SVG 发送图标和输入后的可发送状态，检查结束清理草稿，未向真实公屏发送测试消息。

## 待完成的实播验收

- 真实房间事件的礼物价格、特殊计数、连击结束和进场粉丝团字段。
- 登录账号的编辑器提交、平台接受、公屏回显与平台限流。
- 用户配置的真实 AI 服务权限、模型和响应。
- 持续数小时运行、浏览器休眠、崩溃与网络波动。

执行步骤见[本机实测](../guides/live-testing.zh-CN.md)。事件日志覆盖成功落盘后的恢复窗口；断线期间平台未重放的事件、落盘前进程退出及本地数据被清除仍可能丢失。提交后尚未完成持久确认时，恢复可能重复发送。

## 参考与历史资料

字段核对参考社区维护的 [TikTokLiveJava webcast.proto](https://github.com/jwdeveloper/TikTokLiveJava/blob/master/API/src/main/proto/webcast.proto)、[douyin-live-proto](https://github.com/opedium/douyin-live-proto/blob/master/docs/complete_payload_reference.md) 和[直播间响应样例](https://github.com/mteverest/douyin-live/blob/main/%E6%8A%96%E9%9F%B3%E7%9B%B4%E6%92%AD%E7%9B%91%E6%8E%A7Api%EF%BC%9A%E7%9B%B4%E6%92%AD%E9%97%B4%E4%BF%A1%E6%81%AF.md)。参考字段需要继续用真实房间样本核验。

- [稳定性审查](stability-review.zh-CN.md)：各轮缺陷、原因和修复证据。
- [性能审查](performance-review.zh-CN.md)：快照、队列与本地基准。
- [月报桌面截图](../assets/income-desktop.png)与[月报窄屏截图](../assets/income-mobile.png)：本地模拟数据。
- [旧版工作台](../assets/archive/chrome-extension-demo.png)、[计数](../assets/archive/panel-demo.jpg)、[筛选](../assets/archive/rules-demo.jpg)和[旧审核界面](../assets/archive/review-demo.jpg)：历史界面资料。
