# 抖音直播运营助手

面向抖音直播间的 Chrome 扩展，提供礼物感谢、进场欢迎、弹幕回复和观众互动。支持按直播间独立配置，附带本地模拟器和 Tampermonkey 兼容脚本。

## 功能

- 礼物感谢、连击合并、荣誉等级与粉丝团条件欢迎、点赞感谢。
- 关键词回复、多组定时消息、可配置的 AI 回复。
- AI 语境判定与本地词库检测敏感话题、辱骂和恶意挑衅，支持逐次提醒、累计禁言、严重违规直播间封禁及处置记录。
- 四种房间游戏：成语接龙、猜数字、真心话与大冒险，支持免 @ 开局和全场参与；成语接龙支持离线词典校验、同音与前后鼻音接续、多局个人加减分、答对计次、分级提示和冠军结算。
- PK 比分状态、倒计时、双方归属和可解释的观测统计；无法确认的数据保持未知。
- PK 每日任务面板采集、定时进度/展馆播报、开局/终局提醒、跨零点开局时间计算与战局提醒；“PK 预测”页内提供“PK 播报设置”，AI 优先生成、固定格式兜底。
- 所有 AI 功能共用直播上下文，结合近期弹幕、观众、钻石与收入估算、当前及历史 PK、任务和展馆数据。
- 多主播配置、礼物场次/月度统计、榜单估值和收入估算，数据跨刷新与后台重启保留。
- 主播数据独立模块：按 UID 与时间范围汇总 PK 场数、胜率和总分，展示段位、展馆点亮及任务进度，支持分页与统计导出。
- 有界事件缓冲、持久日志、失败隔离、发送回显/未知状态和恢复导出。

## 安装

需要 Chrome / Edge 120 或以上。挂机采集使用后台唤醒和系统待机保护，具体行为见[使用指南](docs/guides/usage.zh-CN.md#挂机采集)。

1. 从 [Releases](https://github.com/EitanWong/douyin-live-operations-assistant/releases/latest) 下载 Chrome 扩展包并解压。
2. 打开 `chrome://extensions`，启用开发者模式，加载解压后的 `chrome-extension` 目录。
3. 登录并刷新抖音直播间，打开“场控”面板，在设置中启用所需功能。

AI 服务需配置接口、模型和密钥，并在扩展弹窗中授权服务域名。完整操作见[使用指南](docs/guides/usage.zh-CN.md)，当前开发版测试见[本机实测](docs/guides/live-testing.zh-CN.md)。

## 开发

需要 Node.js 20 或更新版本。

```sh
npm ci
npm run dev
```

在 Chrome 中加载 `dist/chrome-extension`。开发监听期间，源码修改会触发构建和扩展更新。

| 命令 | 用途 |
| --- | --- |
| `npm run demo` | 启动本地模拟器：`http://127.0.0.1:4178` |
| `npm test` | 运行全部测试 |
| `npm run test:unit` | 运行单元测试 |
| `npm run test:integration` | 运行集成测试 |
| `npm run build` | 生成正式扩展和兼容脚本 |
| `npm run check` | 检查源码和构建产物语法 |
| `npm run benchmark:runtime` | 运行本地调度与内存基准 |

正式构建前先停止开发监听，或通过 `DOUYIN_DIST_DIR` 指定独立输出目录。

## 文档

- [使用与配置](docs/guides/usage.zh-CN.md)
- [项目结构与架构](docs/development/architecture.zh-CN.md)
- [开发与测试](docs/development/contributing.zh-CN.md)
- [验证记录](docs/reviews/validation.zh-CN.md)
- [PK 协议核对](docs/research/pk-protocol.zh-CN.md)
- [发布流程](docs/development/release-process.zh-CN.md)
- [全部文档](docs/README.md)

## 许可

[MIT](LICENSE)

自动点赞入口：**扩展工具 → 自动点赞**，支持批量、间隔、目标及手动停止；拒绝或结果未知时停止且不重试。协议依据与验证边界见 [自动点赞研究](docs/research/auto-like-2026-10-24.zh-CN.md)。
