# 抖音直播运营助手

面向抖音直播间的 Chrome 扩展，提供礼物感谢、进场欢迎、弹幕回复和观众互动。支持按直播间独立配置，附带本地模拟器和 Tampermonkey 兼容脚本。

## 功能

- 礼物感谢、连击合并、荣誉等级与粉丝团条件欢迎、点赞感谢。
- 关键词回复、多组定时消息、可配置的 AI 回复。
- @机器人菜单、成语接龙、猜数字、真心话与大冒险等互动。
- 多主播配置、礼物日/月统计和收入估算。
- 消息队列、失败重试、运行状态保存与刷新恢复。

## 安装

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
- [发布流程](docs/development/release-process.zh-CN.md)
- [全部文档](docs/README.md)

## 许可

[MIT](LICENSE)
