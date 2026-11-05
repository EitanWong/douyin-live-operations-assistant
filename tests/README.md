# 测试

| 目录 | 范围 |
| --- | --- |
| `unit/` | 引擎、机器人、协议、身份、AI、账本和日志协调器 |
| `integration/` | 页面行为、Chrome 扩展产物、后台接口与开发更新 |
| `helpers/` | Web Locks 模拟和临时构建工具 |

运行 `npm test` 执行全部测试，或使用 `npm run test:unit`、`npm run test:integration` 分组执行。构建产物用例自动创建和清理临时目录，不依赖现有 `dist/`。

性能诊断单独运行 `npm run benchmark:runtime`。真实房间检查按[本机实测](../docs/guides/live-testing.zh-CN.md)执行。

界面投影基准运行 `npm run benchmark:workspace`。定位候选测试可用 `npm run agent:impact -- 源文件`；新增或修改测试后运行 `npm run agent:index`，索引校验已包含在 `npm run check`。详见 [Agent 开发导航](../docs/development/agent-guide.zh-CN.md)。
