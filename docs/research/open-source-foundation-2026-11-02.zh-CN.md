# 扩展 UI 与底层能力的开源选型

调研日期：2026-11-02。范围为当前 Chrome 扩展、油猴版、Shadow DOM 面板及直播 AI 链路。本文是选型评估，尚未安装或迁移所列新增依赖，未做体积、性能或真实直播对比实验。

## 建议

优先选择 **React + Mantine** 作为唯一界面体系，渐进替换现有字符串模板和节点重排。先交付主播数据与 AI 设置两个完整页面，再迁移其他页面。保留现有业务引擎、协议适配、账本语义和媒体解码器。

如果明确希望继续保持 Web Components 技术路线，选择 **Lit + Web Awesome 免费开源组件**。两条路线二选一，不同时混用两套按钮、菜单、表单和主题。

底层按具体需求采用 Zod、Dexie、XState、TanStack Table/Virtual；RAG 扩大后再考虑 Orama；多模型接口扩展时评估 AI SDK。WXT 留到 UI 迁移稳定后单独评估。

## 当前问题与证据

1. `src/ui/panel.js` 当前约 1174 行，同时承担模板、样式、表单和交互。`workspace-pages.js` 再把已经生成的 DOM 拆分、搬动和包装，页面结构存在两个控制来源。
2. `adaptive-styles.js`、`anchor-styles.js`、`workspace-styles.js` 等共同影响卡片、网格和断点。上轮浏览器验收发现旧图表固定行跨度与新网格冲突，说明样式所有权仍不明确。
3. 容器没有越界、卡片没有重叠，只能证明几何正确，不能证明信息层级和操作路径合理。此前自动化结果不能作为用户体验已完成的依据。
4. 数据看板、设置表单、日志、规则编辑器被放进相似卡片中，用统一填空方式排列。它们需要不同的页面模板；表单尤其需要固定阅读与键盘顺序。
5. 本地检索现为自建分块、中文双字切词和 BM25 风格排序；上限 40 条、正文总量 20000 字。规模很小时可以保留，但继续增加全文索引、语义搜索、重排和文件导入会扩大自研范围。

## UI 路线比较

| 路线 | 能直接复用 | 本项目适配成本 | 判断 |
| --- | --- | --- | --- |
| [React + Mantine](https://github.com/mantinedev/mantine)，MIT | 表单、校验反馈、可搜索选择器、菜单、Tabs、Drawer、Modal、通知、主题、布局组件 | 中：需要组件化、状态桥接、Shadow DOM 样式和 Portal 容器配置 | 首选。组件覆盖面广，适合设置密集的运营控制台；减少手写控件行为 |
| [Lit](https://github.com/lit/lit)，BSD-3-Clause + [Web Awesome](https://github.com/shoelace-style/webawesome)，MIT 免费部分 | 响应式 Web Components、Shadow DOM、按钮、选择器、表单基础控件、弹层 | 中：贴近现有原生 JS，但完整应用壳、复杂表格和页面范式仍需组织 | 保守替代路线。付费 Pro 组件与素材不算免费开源依赖，需限定免费包并本地打包资源 |
| [shadcn/ui](https://github.com/shadcn-ui/ui)，MIT | 可复制的组件源码、设计参考和组合方式 | 中至高：源码落入本项目维护，还需组织 Tailwind、状态与页面范式 | 适合高度定制；对当前“减少自己维护组件”的目标，优先级低于完整组件库 |
| [GridStack](https://github.com/gridstack/gridstack.js)，MIT | 可拖动、缩放、保存布局的仪表盘 | 数据看板可局部使用；不负责表单、消息、导航和业务信息架构 | 只有用户确实需要自定义仪表盘位置时才引入 |

### Mantine 接入的关键限制

- [AppShell](https://mantine.dev/core/app-shell/) 默认采用固定定位和视口断点，不能直接当成网页内悬浮小窗口的壳。扩展独立工作台页可使用 AppShell；悬浮面板内使用容器内的 CSS Grid/Flex 与 Mantine 控件。
- [响应式文档](https://mantine.dev/styles/responsive/)包含容器查询。悬浮面板按自身可用宽度决定布局，不能因为直播网页很宽就强行显示三列。
- [Portal](https://mantine.dev/core/portal/) 默认会向 document.body 挂载。菜单、弹窗、通知需要指定 Shadow Root 内的目标容器，样式与 CSS 变量也必须注入对应根；主题选择器、焦点、Escape、滚动锁需做集成验证。
- [useForm](https://mantine.dev/form/use-form/)可接管字段错误、脏状态和表单校验。迁移页的输入只由组件管理；旧 Panel 不能再同时改该区域的 DOM。实时统计更新不能覆盖用户未保存草稿。
- 当前 esbuild 已支持打包依赖；选择 React 不要求先迁移到 WXT，也不要求把规则引擎改成 React。

## 底层开源能力

| 项目与许可证 | 可替代的重复工作 | 接入边界与优先级 |
| --- | --- | --- |
| [TanStack Table](https://github.com/TanStack/table)，MIT | 主播、观众贡献、收入、历史场次表的排序、过滤、分页、列状态 | 高。它是无样式表格逻辑，不能单独统一外观；与 Mantine 表格组件组合。导出仍读取完整领域数据，不能误导出当前可见行 |
| [TanStack Virtual](https://github.com/TanStack/virtual)，MIT | 长日志和大量表格行的可视区域渲染 | 中。数据量达到需要时再用；虚拟化不替代索引、分页、日志上限和采集背压 |
| [Zod](https://github.com/colinhacks/zod)，MIT | 配置导入、模型结构化输出、跨扩展消息的重复字段校验 | 高。边界解析一次；把错误路径映射到字段。JSON 修复后仍须校验。超大直播事件流按性能评估，不在每层重复全量校验 |
| [Dexie](https://github.com/dexie/Dexie.js)，Apache-2.0 | 手写 IndexedDB 事务、索引查询、升级与异步封装 | 中高。先从只读报表仓库接入；数据库版本升级只能由一个所有者执行。保持原库、原记录、单写入所有权，单独验证升级和回滚路径 |
| [XState](https://github.com/statelyai/xstate)，MIT | 感知启动、连接、采样、停止、错误和资源释放的布尔状态组合 | 高于继续扩展手写开关。每个房间/会话独立 actor；停止时取消请求并释放轨道。状态机持久化不等于流媒体连接或任务自动恢复 |
| [Floating UI](https://github.com/floating-ui/floating-ui)，MIT | 下拉菜单和提示的定位、边缘避让、随滚动更新 | 直接 DOM 路线可用；若所选组件库已处理相同控件，不再加一套。它负责浮层定位，不是主窗口布局或拖动缩放库 |
| [p-queue](https://github.com/sindresorhus/p-queue)，MIT | 模型、搜索、采样请求的并发和速率调度 | 条件接入。只负责请求队列，不承担持久弹幕送达、幂等和付费操作；超时或取消不代表远端没有执行，不能盲目重试 |
| [Orama](https://github.com/oramasearch/orama)，Apache-2.0 | 本地全文、向量、混合检索与索引 | 条件接入。先维护带来源、有效期和 chunk ID 的文档模型，再替换检索器。向量仍需 embedding 模型；中文分词、召回率、持久化和重建必须实测 |
| [AI SDK](https://github.com/vercel/ai)，Apache-2.0 | 模型 provider、流式输出、结构化结果、工具调用和 embedding 适配 | 条件接入。官方有 [Alibaba provider](https://ai-sdk.dev/providers/ai-sdk-providers/alibaba)，支持自定义 fetch 与地域端点。仍经过现有权限网关；不能据此声称支持 Omni 双向音视频实时会话 |
| [WXT](https://github.com/wxt-dev/wxt)，MIT | 扩展入口、开发重载、资源、构建和 UI 生命周期 | 后置。官方支持 [Shadow Root UI](https://wxt.dev/guide/essentials/content-scripts.html#ui)。油猴构建仍需单独保留；MAIN/ISOLATED 桥接、域名授权、持久化及自建热更新要逐项迁移 |

若仅扩展轻量全文检索，可比较 [MiniSearch](https://github.com/lucaong/minisearch)；若明确要混合检索，才优先 Orama。无需同时安装两种检索引擎。

### 现有依赖继续复用

- ECharts：现有图表保留，统一图表容器、主题、时间范围、空状态和 resize 管理，不重新造图表。
- hls.js / mpegts.js：继续负责原始流解码。更换播放器库不能消除签名、账号授权、CDN 跨域和编解码限制。
- Cordis：继续管理包内工具插件生命周期；XState 管理单个感知会话内部状态，两者职责不同。
- jsonrepair：保留其有限语法修复能力，结果交给结构校验。
- Lucide：继续共用现有图标，不再引入第二套图标视觉。
- Solid Glass：可以保留少量品牌色/材质参考，但不再与新组件库同时控制基础控件、焦点和尺寸。

## 界面如何组织

组件库负责控件行为，项目仍需明确以下页面模板：

| 页面类型 | 适用范围 | 固定规则 |
| --- | --- | --- |
| 数据看板 | 主播数据、PK | 同一筛选驱动指标、趋势和明细；对比图表同一行；明细表获得完整宽度；不混入自动回复配置 |
| 设置表单 | AI、运行规则、内容治理 | 任务顺序固定；基础项先显示，高级项按需展开；一套草稿、校验、保存状态；避免瀑布流打乱阅读 |
| 规则列表与编辑 | 关键词、定时消息、话术 | 主区列表 + 编辑抽屉/详情；不把每条规则展开成冗长表单 |
| 操作工具 | 自动点赞、送礼、抽奖 | 参数、执行操作、实时进度明确分区；危险/收费动作保留现有门控 |
| 消息与诊断 | 操作反馈、连接错误、历史日志 | 短反馈在统一通知区；持续错误在稳定状态区；字段错误紧邻字段；详细日志留在诊断页，不把所有事件都做成弹窗 |

使用一套主题 token、一套页面容器、一套标题层级、一套字段错误与保存反馈。空白应按任务分组评估：删除因固定最大宽度或错误列跨度造成的空白，但不把小表单无限拉宽，也不把数据与开关混排来填空。

扩展可提供“紧凑悬浮控制条 + 完整工作台标签页”。完整工作台使用正常页面宽度，适合表格和复杂设置；悬浮区保留启停、当前状态和快捷动作。也可评估原生 [Chrome sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)，但它仍较窄，需要新增声明与消息接线，不能作为宽看板的唯一入口。油猴继续提供悬浮入口，共享页面组件和领域适配层。

## 避免再次改乱的验证工具

- [Storybook](https://github.com/storybookjs/storybook)，MIT：保存字段、选择器、状态区和五种页面模板的亮/暗、窄/宽、加载/错误/空状态样例。
- [Playwright](https://playwright.dev/docs/test-snapshots)，Apache-2.0：新增真实组件状态的截图回归，覆盖窗口缩放、菜单位置、草稿保留、动态数据增高。截图需人工确认基线，单纯无越界不是设计评审。
- [axe-core](https://github.com/dequelabs/axe-core)，MPL-2.0：补充标签、对比度、ARIA 和键盘问题检查；不能替代人工读屏与交互验收。

## 推荐实施顺序和退出条件

1. **先做两个完整页面原型**：React + Mantine，迁移主播数据与 AI 设置，接入现有真实 view-model 和配置接口。验证 Shadow DOM、菜单、主题、容器断点、键盘、草稿与错误位置；通过视觉评审后确认主路线。
2. **形成共享页面模板**：其余页面逐页替换；每完成一页，移除对应旧模板、节点搬动和旧 CSS 控制路径。迁移期允许不同页面用不同渲染器，同一子树只有一个所有者。
3. **数据与异步能力单独迁移**：TanStack 表格、Zod 边界、Dexie 只读查询、XState 感知会话分别交付与验证；不在一次 UI 改造中重写消息送达和账本确认链。
4. **按数据需求扩展 AI/RAG**：用同一批中文直播问答对比现有检索和 Orama；确认召回率、引用和延迟后切换。AI SDK 先做普通回复和 embedding 适配验证，Omni 实时链路保持专用实现。
5. **最后评估构建迁移**：WXT 与现有 esbuild 对比，保留油猴输出；验证扩展更新和权限行为再替换原开发工具。

## 调研依据与限制

本次读取上述官方文档、公开 README 和 npm 元数据。快照保存在 `output/open-source-research-2026-11-02/`。GitHub API 仓库元数据受公共限流，没有核实仓库活跃度排名；不以星数或“最流行”作为结论。

快照中的部分最新版（WXT、p-queue、AI SDK 及 Alibaba provider）声明 Node >=22，而当前项目声明 Node >=20。选型不等于直接安装 latest；需锁定兼容版本或单独升级工具链，并核对选定版本的具体许可证、CSP、Shadow DOM、bundle 体积与运行时兼容性。Orama 的云服务、Web Awesome Pro、Stately 的托管服务等不属于这里建议安装的免费开源核心包。

本文没有安装库、读取密钥、调用模型、修改数据库或重载 Chrome。没有运行 crapper、dryer、mutator；命令及当前工具目录均未提供这些检查。
