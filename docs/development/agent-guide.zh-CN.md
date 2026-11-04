# Agent 开发导航

原则只在 [AGENTS.md](../../AGENTS.md) 维护。先用本文定位职责，再查询生成索引；不要把整个索引、历史日志或大文件一次读入上下文。

## 查询和维护

```sh
npm ci
npm run agent:check
npm run agent:find -- EventInbox
npm run agent:find -- 停止后
npm run agent:find -- setInterval
npm run agent:impact -- src/runtime/inbox.js src/runtime/journal.js
```

`agent:find` 搜索路径、顶层声明、类成员、测试名称及资源 API 调用位置，返回文件和一基行号；结果最多 60 条，超出时收窄关键词。`agent:impact` 沿反向依赖查找受影响模块与候选测试，包括静态导入、重导出、字面量动态导入、构建入口及文件读取中的源码路径引用。多个修改文件可以一起查。

查询读取上次生成的快照，故删除文件后仍可先查询旧影响。校验与查询分开，不能把过期索引的行号当作当前源码。改动完成后运行：

```sh
npm run agent:index
npm run agent:check
npm test
npm run build
npm run check
git diff --check
```

生成器位于 `scripts/lib/agent-index.mjs`，命令入口为 `scripts/agent-index.mjs`，唯一产物为 [agent-index.json](agent-index.json)。索引逐文件解析，使用内容 SHA-256、稳定排序和逐模块一行输出；没有时间戳、绝对路径或业务运行数据。临时文件使用独立名称并原子替换产物，重复生成结果一致。不要手改生成文件。

`npm run check` 已包含索引过期校验，因此现有 CI 和发布检查会拒绝未更新的索引。源码、测试、构建工具的改动应与索引差异一起提交。只改文档无需重建。新增索引根目录时修改生成器中的 `INDEX_ROOTS`。

边界：这不是调用图或完整覆盖率分析。变量动态加载、通过 Chrome 消息连接的入口、运行期反射及未写为完整路径的构建引用不能静态追踪；查询会列出无法解析的动态导入位置。资源调用只标记可审查位置，不证明泄漏或回收成功。Python、HTML、CSS、模板字符串里的代码和外部包内部不做符号解析。候选测试不是“只跑这些就足够”的保证；最终按项目流程执行完整验证。

## 按任务进入代码

| 任务 | 首选入口 | 重要边界与回归入口 |
| --- | --- | --- |
| 应用启停、页面缓存、切房 | `src/app.js`、`src/browser/room-context.js` | pagehide 的关闭与 bfcache 暂停不同；`live-mode`、`room-context` 测试 |
| 直播事件采集与解码 | `extension/page.js`、`extension/content.js`、`src/browser/adapter.js`、`src/browser/protocol.js` | MAIN 与隔离世界交接；`adapter`、`protocol`、扩展集成测试 |
| 队列、背压、快照、日志确认 | `src/runtime/inbox.js`、`src/runtime/journal.js` | 有界内存与持久日志不同；`inbox`、`journal`、`extension` 测试 |
| 感谢与发送恢复 | `src/core/engine.js`、`src/runtime/delivery.js` | 礼物优先、检查点、未知结果不自动重发；`core`、`delivery` 测试 |
| 工具扩展、权限与回收 | `src/tools/registry.js`、`src/tools/runtime.js`、`src/tools/scope.js`、`src/tools/gateway.js` | 独立作用域、同步撤权、在途排空；`tools`、`reward-automation-protocol` 测试 |
| 数据、收入、事务和缓存 | `src/data/gifts.js`、`extension/durable-storage.js`、`extension/protocol-cache.js` | 后台单写者、按房间隔离、成功落盘才确认；`income`、`durable-storage`、`protocol-cache` 测试 |
| 统计预测与图表 | `src/analytics/service.js`、`src/analytics/archive.js`、`src/ui/prediction-charts.js` | 缺测与零值、完整场次与采集片段不同；`prediction-*` 测试 |
| 可见界面与表单 | `src/ui/panel.js`、`src/ui/product/bridge.js`、`src/ui/product/runtime.js` | 原控制器是唯一草稿来源；`product-workspace`、`product-runtime`、`workspace-system` 测试 |
| 布局、放大、动效 | `src/ui/product/layout.js`、`src/ui/product/fit.js`、`src/ui/product/inspect.js` | 尺寸、密度、焦点与减少动效；`workspace-fit`、`product-layout`、`adaptive-layout` 测试 |
| AI 回复与上下文 | `src/services/ai.js`、`src/services/ai-context.js`、`src/ai/context-policy.js` | 共享现场事实、预算、过期回复拒绝；`ai-context-budget`、`ai-stale-facts` 测试 |
| 产品内 Agent 任务 | `src/ai/harness.js`、`extension/ai-background.js`、`src/ai/task-store.js` | 后台持久任务、取消、额度与发送分离；`agent-execution`、`agent-lifecycle` 测试 |
| 语音、视觉与原生宿主 | `src/browser/live-media.js`、`src/browser/native-perception.js`、`extension/native-perception.js`、`native/` | 实例独立状态与取消；`media-lifecycle`、`native-perception-*`、`native/test_*.py` |
| 公共数据与检索 | `src/services/public-data.js`、`src/services/weather.js`、`src/services/retrieval.js` | 来源、时效、单位、取消与缓存边界；`public-data`、`weather`、`mature-retrieval` 测试 |
| 构建与交付 | `scripts/build.mjs`、`extension/manifest.json`、`.github/workflows/ci.yml` | 按 [发布流程](release-process.zh-CN.md) 集成 dev；`standalone-build`、`extension` 测试 |

测试简称可通过 `agent:find` 查询完整路径。现有 [架构](architecture.zh-CN.md)、[工具接口](tool-plugins.zh-CN.md)、[布局约定](layout-standards.zh-CN.md) 是进一步阅读入口；本文只负责导航。

## 生命周期与性能审查

先用资源 API 索引缩小范围，再检查谁创建、谁关闭、失败时谁排空。不要通过丢弃未确认业务事实来限制内存。可恢复暂停应保留工作，最终关闭应撤销监听和定时器、释放强引用，迟到结果不得复活旧实例。

界面桥只投影当前页，忽略其他页内部的变更。不可变视图通过结构共享保留未变化的子树、数组与图表配置；React 复用相同节点。控制器提交新图表配置时应提供新对象，不能原地修改已经交给视图的配置。非 JSON 值（例如 formatter 函数）按身份比较。可操作节点的强引用仅保留在当前投影，重新挂回控件仍使用其原 ID。

事件队列仍是单消费者，累计 200 条或 8ms 后在尚有工作时让出主线程，保留顺序与重放的一条步进语义。8ms 是事件之间检查的合作预算，不能抢占一个耗时的处理器。关闭释放内存队列与隔离区；已经开始的外部操作仍可能完成，持久日志的恢复规则不变。

```sh
npm run benchmark:runtime
npm run benchmark:workspace
```

前者检查调度、快照合并和本地堆；后者检查六图表各千点的 DOM 投影、状态更新和后台页更新。它们不发送网络请求，也不代表浏览器 FPS、进程 RSS 或全天运行保证。将性能证据、环境和限制写入行动日志；不要用机器相关毫秒值作为普通测试阈值。

## 术语

| 词语 | 含义 |
| --- | --- |
| 开发 Agent 索引 | 本文的离线源码导航数据；不进入扩展产物或用户配置 |
| 产品内 Agent | 为直播业务执行受限任务的 AI；与开发索引没有运行时依赖 |
| Inbox | 内存事件交接队列；接收成功不等于已持久化 |
| Journal | 已落盘、尚待检查点确认的可重放事件 |
| Checkpoint | 完成后才能确认日志或继续发送的实际存储屏障 |
| Scope | 一个工具实例持有的取消信号、监听、计时器与在途任务 |
| Projection / 视图快照 | 从唯一控制器草稿生成的只读呈现数据，不是第二份配置 |
| Room / Session | 页面房间范围 / 一次开播场次，两个标识不能混用 |
| Gap / Unknown | 未采集到的事实 / 已提交发送但结果不确定，分别处理 |
