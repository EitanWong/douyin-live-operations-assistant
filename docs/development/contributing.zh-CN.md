# 开发与测试

## 环境

使用 Node.js 20 或更新版本，在项目根目录执行：

```sh
npm ci
npm run dev
```

首次在 Chrome 加载 `dist/chrome-extension` 并刷新直播页。开发版名称带“开发”，源码保存后自动构建，Chrome 检测更新后重载扩展和直播页。更新服务只绑定 `127.0.0.1:4179`。

`npm run demo` 启动模拟器，地址为 `http://127.0.0.1:4178`。模拟页面读取实际源码，模拟提交显示在本地公屏。

| 变量 | 用途 |
| --- | --- |
| `DOUYIN_DEV_PORT` | 开发更新服务端口，默认 4179；修改后需重新加载开发扩展 |
| `DOUYIN_DEMO_PORT` | 模拟器端口，默认 4178 |
| `DOUYIN_DIST_DIR` | 构建和产物语法检查的输出目录 |

## 检查

```sh
npm test
npm run build
npm run check
git diff --check
```

开发监听运行时，可在独立目录验证正式产物：

```sh
DOUYIN_DIST_DIR=/tmp/douyin-build npm run build
DOUYIN_DIST_DIR=/tmp/douyin-build npm run check
```

`npm run check` 检查源码、工具脚本、测试和生成的 JavaScript。`npm test` 会为需要产物的用例创建临时构建，并在结束后清理，不读取或覆盖 Chrome 正在使用的 `dist/`。

## 测试分类

| 命令 | 范围 |
| --- | --- |
| `npm run test:unit` | 引擎、机器人、协议、AI、身份、账本和持久化协调器 |
| `npm run test:integration` | JSDOM 页面流程、扩展 bundle、后台接口与开发更新 |
| `npm test` | 全部测试 |
| `npm run benchmark:runtime` | Node 本地调度和堆内存诊断，结果随机器变化 |

共用工具放在 `tests/helpers/`，用例按被验证的层归类。修复数据丢失、重试或生命周期问题时，应覆盖触发故障的路径和恢复后的结果。性能基准与功能回归分开，不用机器相关毫秒值作为普通单元测试门槛。

真实浏览器和平台验收按[本机实测](../guides/live-testing.zh-CN.md)执行；模拟帧和模拟控件测试不代替真实公屏回显。

## 文件管理

- 业务代码放在 `src/` 对应职责目录，平台入口放在 `extension/`。
- 构建和开发工具放在 `scripts/`；修改模块依赖时同步更新构建顺序。
- 使用说明放在 `docs/guides/`，技术说明放在 `docs/development/`。
- 当前测试结论放在 `docs/reviews/validation.zh-CN.md`；详细问题复盘与历史调研分别存放。
- 文档引用的图片放在 `docs/assets/`；过时界面仅作为历史资料保留在 `archive/`。
- `dist/`、`node_modules/`、浏览器会话缓存和临时截图由忽略规则排除。

日常工作提交到 `dev`，版本与发布按[发布流程](release-process.zh-CN.md)管理。
