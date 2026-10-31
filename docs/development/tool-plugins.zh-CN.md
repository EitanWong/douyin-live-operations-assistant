# 包内工具插件开发

实现日期：2026-10-26。工具宿主通过运行时适配层使用固定版本 `cordis@4.0.0-rc.12` 核心。自动点赞和福袋红包使用相同的注册、生命周期、操作网关和 UI 接口；主播数据继续沿用原有统计链路。

## 接入位置

```text
src/tools/
  bundled.js              包内工具清单，新增工具在这里注册
  registry.js             工具定义及 API 版本校验
  runtime.js              独立挂载、停用、重建、故障隔离
  cordis-adapter.js        Cordis Context、服务注入、工具 Fiber 与 effect 卸载适配
  scope.js                资源作用域、协作取消、清理与排空
  gateway.js              能力检查、房间锁、操作校验与在途请求跟踪
  auto-like/index.js       自动点赞生命周期，复用 core/auto-like.js
  auto-like/view.js        自动点赞界面、状态渲染及按钮操作
  auto-gift/index.js       自动送礼生命周期，复用 core/auto-gift.js
  auto-gift/view.js        礼物搜索、余额、消费上限及手动控制
  rewards/index.js         福袋红包生命周期，复用 browser/rewards.js
  rewards/view.js          福袋红包界面、状态渲染及按钮操作
```

`src/app.js` 经 `src/runtime/tool-host.js` 创建每房间宿主，提供经过环境校验的操作和存储适配；`src/ui/navigation.js` 和 `src/ui/panel.js` 从注册表生成工具菜单、页面、状态和按钮路由。包内工具与业务模块通过普通相对 ESM 导入接入，esbuild 会解析完整模块依赖并保留 ESM 语义，无需另外维护一份工具构建清单。

## Cordis 适配边界

每个 `ToolRuntime` 拥有一个独立的 Cordis 根 Context。宿主将页面与日志适配注册为 `toolServices` 服务；每个工具实例对应一个声明该依赖的 Fiber。适配层在 Fiber 中调用项目自己的 `mount(ctx)`，仅把冻结的服务表注入 `ctx.services`，业务工具不接触 Cordis Context、Fiber 或依赖声明 API。

Cordis `effect()` 登记工具作用域的关闭。停用时，适配层先同步撤销作用域，再卸载 Fiber，并等待作用域清理和 Cordis 卸载都完成。挂载迟到、清理报错与在途操作仍由项目作用域跟踪；Cordis 内部捕获清理异常不会使宿主误判回收成功。所有工具结算后才释放根服务，单工具重建不重建根 Context。

服务表在一个宿主生命周期内固定。将来需要替换共享服务时，应先通过宿主撤权并排空依赖工具，再重建工具；不要直接修改 Cordis 服务触发绕过操作网关的隐式业务重启。工具故障仍逐个处理，不用 Cordis `emit()` 承载核心事件确认或隔离业务回调。

当前只使用 Cordis 核心，没有安装 loader、HMR 或插件市场。该版本仍为 RC，依赖及 lockfile 固定版本，升级时须运行工具回收、在途请求和浏览器产物回归。构建器将适配层及其依赖内置进油猴和隔离脚本；MAIN 桥和扩展后台不加载工具宿主。模拟器通过 import map 加载构建后的 `dist/tool-runtime.js`，运行时不从网络加载框架。Cordis 与 Cosmokit 许可证保留在产物及 `THIRD_PARTY_LICENSES.txt` 中。

## 最小工具定义

下面的接口示意不包含新的产品功能；真实工具应分别维护入口与视图，参考已有工具。

```js
const exampleTool = {
  id: 'example',
  label: '示例工具',
  icon: 'heart',
  version: '1.0.0',
  apiVersion: 1,
  capabilities: [],
  view: {
    template: () => '<section class="page" role="tabpanel" id="page-example" aria-labelledby="tab-example" data-page="example" hidden><p data-example-status></p><button type="button" data-action="example-run">运行</button></section>',
    update: (panel, state) => panel.text('[data-example-status]', state.reason),
    actions: {
      run: (panel, invoke) => invoke('run')
    }
  },
  mount(ctx) {
    ctx.publish({ phase: 'idle', reason: '等待开始' });
    return {
      actions: { run: () => ctx.publish({ phase: 'completed', reason: '已完成' }) },
      dispose: () => {}
    };
  }
};
```

将定义导入 `bundled.js` 并加入 `new ToolRegistry([...])`。ID 必须唯一，工具版本使用三段数字；不兼容的 `apiVersion` 会被拒绝。视图使用现有控件样式，最外层为一个工具页面 `section`；宿主在页面末尾追加统一“工具管理”。按钮使用 `工具ID-操作名` 的 `data-action`，按钮行为只在该工具的 `view.actions` 中声明。

工具视图是随包发布的受维护代码，模板不能拼入未经转义的外部内容。不要将远程 HTML 或插件代码作为工具定义。

工具可声明 `timeoutMs`（1～60,000 的整数），覆盖该工具的网关、通知、命令及生命周期等待预算；未声明时默认 15 秒。福袋工具使用 30 秒，容纳资格查询与两步提交各自最长 8 秒的等待。这个预算不改变底层请求超时，也不允许放弃未结算请求的所有权。

## 运行上下文与资源

| 接口 | 用途与要求 |
| --- | --- |
| `ctx.room` | 当前宿主所属直播间 |
| `ctx.config()` | 获取工具对应配置的结构化副本；修改副本不会修改 Engine |
| `ctx.previousState` | 同一宿主上一次实例的展示状态副本；不包含可恢复的操作资格 |
| `ctx.publish(state)` | 更新工具展示状态；旧代次或已撤销作用域的更新被忽略 |
| `ctx.guard()` | 获取当前停用、切房、断线、账号等环境问题；空字符串表示环境检查通过 |
| `ctx.signal` | 停用时立即触发的 AbortSignal；异步工作应协作取消 |
| `ctx.scope.timeout(fn, ms)` / `clearTimeout(id)` | 登记并清理计时器；回调异常只影响当前工具 |
| `ctx.scope.listen(target, name, fn, options)` | 登记可回收的事件监听，返回提前移除函数 |
| `ctx.scope.defer(cleanup)` | 登记清理函数，可返回 Promise；Observer 可登记 `disconnect()` |
| `ctx.lock.acquire()` / `release()` | 获取该工具与房间的运行锁，停用后迟到授权会归还 |
| `ctx.operations.call(name, payload)` | 通过能力网关执行操作 |
| `ctx.services` | 页面、日志、账号读取与活动记录存储适配；不包含可写 Engine 或底层发送器 |

`mount()` 返回实例，或返回解析为实例的 Promise。实例可包含 `actions`、`tick()`、`stop(reason)`、`resume()` 和 `dispose()`：

- `tick()` 由应用现有 250 ms 周期触发。每工具同名钩子最多一个在途调用；实际业务轮询频率由工具自己控制。
- `stop()` 停止当前业务任务，保留插件及其界面；`resume()` 恢复允许自动等待的工具。自动点赞没有自动恢复任务的钩子。
- `dispose()` 用于整实例停用和重建，必须停止业务并回收资源；若需等待在途工作，返回相应 Promise。

宿主先同步撤销作用域、取消计时器、移除监听并调用清理，再等待挂载、计时器/监听/命令/通知的真实异步回调、资源清理和实际操作排空。异步挂载超时后迟到返回的实例也会被清理。清理异常或未结束的旧工作会阻止替代实例启动；不能为了“重启成功”放弃这道检查。

工具展示状态中的 `hostPhase` 由宿主生成，区分挂载、就绪、失败和停用；业务自己的 `phase` 继续描述本次任务。福袋工具保留同一页面重建前的点击／确认计数，活动去重在锁内从按房间、账号隔离的共享存储重读；扩展使用后台 IndexedDB，用户脚本使用 GM 存储，旧 sessionStorage 副本成功迁移后才删除。自动点赞每次重建都等待用户重新开始。

## 能力与操作网关

工具必须声明所需能力，网关在每次调用时检查。平台操作需要当前工具、房间及环境有效，并持有该工具的房间锁；取消操作只允许清理当前实例持有的 token。

| 能力 | 载荷与校验 |
| --- | --- |
| `like.prepare` | 本次目标数量，1～1,000,000；准备后核对账号和环境，过期 token 自动注销 |
| `like.commit` | `{token, count, sequence}`；单批 1～100，序号连续，不超过本次剩余额度，账号不能变化 |
| `like.stop` | 当前实例的 token；撤销作用域后仍允许完成注销 |
| `gift.read` | 无载荷；只读原生礼物目录、余额及待核对记录，不取得运行锁 |
| `gift.prepare` | `{giftId, priceUnits, batch, intervalSec, target, budget}`；金额用十分之一钻整数计算，绑定账号、房间、目标、价格及预算 |
| `gift.commit` | `{token, count, sequence}`；序号和额度先预留，MAIN 再检查实时目录、余额、权限及账号锁 |
| `gift.stop` | 当前实例的 token；撤销后续操作，账号锁等在途请求结算才释放 |
| `gift.acknowledge` | 用户已核对的未知批次记录 ID；锁内刷新余额后解除匹配记录，不重发旧请求 |
| `rewards.click` | 已识别的页面活动节点；应用再次核对房间、开关、节点所属页面、连接及禁用状态 |
| `rewards.prepare` | `{lotteryId, allowPassword, signal?}`；绑定当前账号及开关，只查询精确轮次的资格，迟到或取消的准备自动注销 |
| `rewards.commit` | `{token, signal?}`；当前实例的单次票据，重新核对账号、开关和房间；先提交条件 6，再按资格发送必要口令 |
| `rewards.stop` | 当前实例的福袋票据；撤销未派发资格，已派发轮次仍保留去重 |
| `rewards.configure` | 福袋配置副本；由应用验证并保存配置。断线时仍可关闭功能，但页面已离开或存储失效时拒绝保存 |

请求开始前先预留本次额度和序号，结果未知也不能重用该批次。超时不代表撤回平台请求：网关停止等待并撤销工具后续操作资格，并把 AbortSignal 传给支持取消的底层请求，但继续跟踪实际请求。实际请求没有结算时不允许启动替代实例。

福袋口令是上述受控参与流程的一部分，只取当前资格回复的活动口令，复用 MAIN 中网页现有签名 HTTP 客户端；工具不能指定 URL、请求头或任意弹幕。其他弹幕工具仍应通过现有 Engine 队列、检查点与发送回显链路；不得直接把底层发送函数交给插件。

## 应用生命周期与独立管理

每个工具页面的“工具管理”可单独停用、重新启用当前工具。停用不改写主场控配置、账本或主发送队列；工具自身明确要求保存配置的操作除外，例如“立即停止参与”会保存 `rewards.enabled=false`。

直播结束或人工暂停会向全部工具发出任务停止通知。页面进入 BFCache 时撤销实例并回收资源，返回后只重新挂载原先启用的工具；手动停用的工具保持停用。刷新、关闭及切房会关闭宿主，旧回调不能继续提交操作。

`onReady` 调试接口中的 `tools` 提供 `ready`、`status()`、`state(id)`、`diagnostics()`、`enable(id)`、`disable(id)`、`restart(id)`、`invoke(id, action, value)`、`suspend()`、`resume()` 和 `close()`。`diagnostics()` 返回 `{backend:'cordis', plugins, scopes}`，可检查启停后 Fiber 和作用域是否归零。这些接口属于应用内维护与测试接口，不是页面主世界的外部控制入口。

## 与现有可靠性链路的关系

工具没有订阅持久事件日志，也不加入日志确认的等待路径。礼物仍按原有账本事务入账，事件确认仍等待核心检查点，发送未知状态仍由原有交付记录管理。工具的异常、超时与管理操作不会清空这些数据。

这次实现是“已打包工具的实例启停与重建”，没有远程安装代码或源码 HMR。需要可靠消费事件、独立状态迁移或重计算隔离时，再分别设计 outbox／消费游标、状态 schema 和可终止执行容器。同线程的同步死循环与内存耗尽不能通过 Promise 超时隔离。后台仍遵循 MV3 的持久化与唤醒规则。

Cordis API 仅封装在 `cordis-adapter.js`；业务工具和 UI 继续依赖项目上下文与能力接口。框架升级或替换不要求业务工具跟随修改。

## 验证

`tests/unit/tools.test.mjs` 注入异常、挂起、迟到锁、迟到 token、清理失败与在途批次，检查资源回收和撤权；100 次启停后检查 Cordis registry 与作用域归零，并验证服务注入、挂载失败、迟到挂载和根服务关闭。`tests/integration/tools.test.mjs` 使用自动点赞、福袋红包及页面 DOM 验证实际接口，并通过应用入口检查 BFCache、日志确认和礼物入账。`tests/integration/extension.test.mjs` 在没有 Node 全局的浏览器环境执行实际油猴与隔离产物，验证内置 Cordis 的挂载、注入、重建和回收。

`tests/unit/lottery-requests.test.mjs` 与 `lottery-automation-request.test.mjs` 验证资格边界、单次提交、取消及持久去重；`tests/integration/lottery-extension.test.mjs` 执行构建后的 MAIN 桥，检查真实语义操作的请求顺序、重复票据、迟到资格和两阶段取消。平台 HTTP 客户端由本地夹具替代，不产生真实报名，也不把测试成功计作本人服务器参与确认。

浏览器本地模拟器已验证：工具注册导航、模拟点赞完成、独立停用与重新启用、重新启用后等待用户开始。未向真实直播间发送弹幕、点赞或参与活动；真实平台长时运行仍需按实测指南验收。

## 互动抽奖的数据边界

`giveaway` 通过包内注册加入导航。纯规则位于 `src/core/giveaway.js`；运行器在房间租约下串行保存，持久状态为 `{version:1, rounds}`。直播间、轮次、参与者、礼物连击进度与中奖 ID 各有明确字段，规则创建后固定。

`dispatch` 可靠分发弹幕／礼物事件并等待工具保存，区别于可合并的 `notify` 状态提示。保存失败时核心仍接收事件，抽奖保留待处理日志并进入失败状态；重建工具先恢复截止前的日志，再开奖。后台通过 `giveaway-read/write` 按来源房间限制记录，并在 IndexedDB 事务提交后返回，错误不会清空旧数据。工具关闭先撤销未来任务、等待当前写入，再释放租约。

使用 `tests/unit/giveaway*.test.mjs`、`tests/integration/giveaway.test.mjs` 和构建后的扩展后台测试验证规则、跨页接管、恢复与存储边界。
