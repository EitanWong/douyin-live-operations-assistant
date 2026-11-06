# 测试

| 目录 | 范围 |
| --- | --- |
| `unit/` | 引擎、机器人、协议、身份、AI、账本和日志协调器 |
| `integration/` | 页面行为、Chrome 扩展产物、后台接口与开发更新 |
| `helpers/` | Web Locks 模拟和临时构建工具 |

运行 `npm test` 执行全部测试，或使用 `npm run test:unit`、`npm run test:integration` 分组执行。构建产物用例自动创建和清理临时目录，不依赖现有 `dist/`。

性能诊断单独运行 `npm run benchmark:runtime`。真实房间检查按[本机实测](../docs/guides/live-testing.zh-CN.md)执行。

界面投影基准运行 `npm run benchmark:workspace`。定位候选测试可用 `npm run agent:impact -- 源文件`；新增或修改测试后运行 `npm run agent:index`，索引校验已包含在 `npm run check`。详见 [Agent 开发导航](../docs/development/agent-guide.zh-CN.md)。

`npm run eval:harness` 执行浏览器研究循环、持久恢复、取消、额度、来源时效、持续任务去重与前台知识复用的确定性行为/故障测试。使用受控模型和搜索响应，不代表真实模型回答质量。

`npm run eval:agent` 使用 Promptfoo 0.125.1 运行61个应用场景（11个后台研究），需通过环境变量设置 `QWEN_API_KEY`、`QWEN_WORKSPACE_ID`。模型走实际请求，搜索与页面使用固定虚构证据以隔离外部变化；多跳/原文场景必须满足实际工具轨迹，猜对答案不能代替执行。原始答案、工具次数、来源、取消、耗时和失败检查保留在报告中，不发送真实弹幕。缺凭据时不执行模型评测，不以模拟响应的通过率代替模型成绩。详见[浏览器 Harness](../docs/development/browser-agent-harness.zh-CN.md)。
