# 挂机与后台采集（2026-10-23）

## 原因与证据

用户报告长期待机后礼物、PK 等数据停止。2026-10-23 从当前 Chrome 直播页的 script DOM 取得运行时资源地址，再下载同一发布版本的 runtime chunk map 及其 PausePop chunk 做静态检查：

- [官方 PausePop.fd6feca0.js](https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/PausePop.fd6feca0.js)
- SHA-256：`1ca386d1e453667e4cd33310bd7385fc95eba61250ee4ba970b1c94b183abff5`
- 模块 `842833`：依据 `new_pause_pop_config` 和房间 `web_live_port_optimization.strategy_config` 设置前台/后台无操作计时；监听 document 的 `mousemove`、`click`、`keydown`、`wheel`、`visibilitychange`。当前版本该监听不检查 `isTrusted`。
- 后台无操作达到期限后弹出“长时间无操作，已暂停播放”。倒计时结束不仅调用播放器 `pause()`，还调用 `singletonStore.message.pause()`，同时切断直播 IM；因此并非单纯视频停止。
- 原站“继续播放”的处理器恢复内部计时状态、播放器和当前房间 IM，并重新确认房间状态。恢复必须走这个原生处理器，单独重建 WebSocket 或改 `pausePop` 标志不足以复原全部状态。

REA 对 `http://127.0.0.1:9222` 的 `list_browser_targets` 返回 `endpoint_unreachable`，未建立该登录会话的被动网络观察。以上行为来自当前公开发布脚本的静态控制流；不声称观察到了用户本次丢失事件对应的超时执行，也没有线上连续数小时挂机验证。

## 实现

- `CollectionGuard` 在 MAIN world 和油猴页面观察器运行，与场控发送开关无关。当前直播间身份与开播状态明确时，每 20 秒向 document 发送不冒泡的 mousemove，重置原站无操作计时。不会填写、聚焦、滚动公屏或发送互动。
- 延迟恢复时只在明确的挂机提示区域寻找唯一的“继续播放”，点击原生按钮；不点击普通播放按钮、登录或验证界面。恢复操作至少间隔 30 秒。
- 扩展每 30 秒用 `chrome.alarms` 唤醒隔离脚本，再通过有房间校验的桥触发页面保活。回应来自本次 MAIN 检查；扩展上下文失效时停止保活。
- 使用 `chrome.storage.session` 保存各标签页的采集租约；后台进程每次启动重新向直播标签核对，关闭、导航、失效或下播后释放。只要还有明确开播的采集页，`chrome.power.requestKeepAwake('system')` 阻止系统自动睡眠，屏幕仍可熄灭；全部停止后释放。
- 最低 Chrome 版本改为 120，以支持 30 秒 alarm；增加 `alarms`、`power` 权限。已有 `https://live.douyin.com/*` host permission 足够枚举匹配直播页，无需增加全浏览记录的 `tabs` 权限。
- 页面隐藏不暂停采集；BFCache pagehide 暂停保活，pageshow 恢复。结束、离线、身份不明确或离开当前 URL 时不保活。
- 连接健康兼容最近 90 秒内成功解码的 IM 长轮询，避免仅靠 WebSocket 状态把轮询模式误报离线。安静的已打开 WebSocket 仍保持健康，不因无人发言被误判断线。
- 本人赠送的真实礼物也进入收入账本；本人消息的回复过滤不再丢弃这类收入。

“保活次数”和“恢复播放次数”记录尝试次数，不是服务端接收/完整性证明。诊断另列实际协议帧、礼物、PK 计数与最长保活间隔，便于发现后台延迟。

## 验证与边界

自动化覆盖连续 4 小时的后台无操作时间推进、计时延迟后的原生挂机恢复、非挂机界面拒绝点击、下播/离线/切房、BFCache、多直播页和 MV3 重启、长轮询健康、本人礼物入账，以及构建后 MAIN/隔离脚本/后台唤醒桥。

无法保证操作系统强制睡眠、浏览器退出/强制冻结/标签丢弃、断网、登录失效或平台协议变化时仍收到事件。主动系统睡眠会压过 power 请求，alarm 也不是精确实时调度。没有收到且平台未重放的礼物/PK 不可从本地保活补造；预测仍应依据实际收到的比分与数据新鲜度。
