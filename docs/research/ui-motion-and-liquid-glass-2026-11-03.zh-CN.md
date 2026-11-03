# 扩展工具动效与液态玻璃：选型、设计及验证

调研日期：2026-11-03。目标环境：React 19 / Mantine 9、嵌套 Shadow DOM、Chrome MV3 扩展和独立油猴脚本。本文的“最适合”针对这个项目，不代表存在客观公认、适用于所有产品的最佳动画库。

## 结论

采用 **Motion 14.9.0（MIT）** 统一 React 界面的交互动画，使用 `LazyMotion + domAnimation + m` 按需加载。继续由已有、经过手势测试的解析弹簧负责浮窗位置、开合和拖拽吸附。两者分别拥有外部窗口与内部组件的几何通道，不能同时修改同一个 transform。

保留 Mantine 的语义、键盘操作、输入与表格组件，保留 Lucide 图标子集；不更换整个组件库，不再叠加第二套 UI 框架。Motion 是行为层，现有液态玻璃是材料层，主题色是状态层。图标跟随真实操作轻微缩放/位移，展开箭头旋转；没有持续摆动、每次数据刷新重播入场或装饰性转圈。

## 调研依据和成熟度

直接查阅 Apple HIG 的 Motion / Materials 正文数据、WWDC《Animate with springs》讲稿、各项目官方 README、npm 包元数据及 GSAP 许可正文。Motion 文档网站的自动请求返回 403，因此具体 API 以所安装版本的公开导出、类型和实际构建/浏览器验证为准，没有把无法读取的网页当作已读证据。GitHub 仓库统计 API 返回限流 403，不引用未经核实的星数和维护时间。

npm 公共 API 返回的最近月统计窗口为 **2026-10-04 至 2026-11-02**：

| 包 | 下载量 | 如何解读 |
| --- | ---: | --- |
| motion | 99,815,742 | 当前入口包，本身依赖 framer-motion |
| framer-motion | 198,864,746 | 包含直接和间接安装；不能与 motion 相加当作独立用户数 |
| gsap | 24,077,066 | 时间线/网页动画的成熟候选 |
| @react-spring/web | 20,600,661 | React 弹簧动画的成熟候选 |
| animejs | 3,711,059 | 通用 JavaScript 动画候选 |

下载量仅辅助判断生态规模，包含 CI、缓存及传递安装，不证明体验质量、性能或“行业公认最好”。实际效果取决于状态建模、参数、渲染层级和使用场景。

## 方案对比

| 方案 | 优势 | 在本项目中的代价 | 许可与选择 |
| --- | --- | --- | --- |
| **Motion** | React 声明式状态、弹簧、hover/tap、布局/存在动画、减少动态效果；可通过 LazyMotion 裁剪功能 | 自动高度需要测量布局；应避免全量引入拖拽/布局投影；Shadow DOM 与玻璃采样仍需实测 | MIT；本次选择。能在原组件上补充行为，接入面最小 |
| **GSAP 3.15.0** | 精确时间线、复杂 SVG/路径和编排；跨框架，适合宣传页及复杂演出 | React 中需额外处理引用、清理、状态反向和手势语义；本工具主要是状态交互，时间线优势不突出 | 当前 npm 元数据为 Standard “no charge” 许可，并非 MIT/OSI 开源许可；官方条款含与 Webflow 可视化动画构建能力竞争的限制。免费与开源不能混同；不选 |
| **@react-spring/web 10.1.2** | 以弹簧为中心、可组合的物理数值动画，适合手势驱动数值/画布 | 手势及通用 UI 存在/布局策略需要更多自行组合；已有浮窗弹簧，再引入一套物理状态管理收益有限 | MIT；非常合适的备选，但本项目覆盖广度和改动成本更偏向 Motion |
| **Anime.js 4.5.0** | JS/SVG 动画、时间线和较灵活的命令式组合，跨框架 | 输入语义、React 生命周期、减少动态效果、可中断开合需要更多项目层协议 | MIT；适合图形演出，不作为本工具统一交互层 |

Lottie / Rive 更适合设计师制作的独立矢量角色、插画和状态资产；它们不能替代表单语义、真实 DOM 高度变化及窗口玻璃采样。当前没有需要此类资产的交互，不增加资源文件/运行时。第三方演示组件可以参考表达方式，但不复制整套组件来替换可用的 Mantine 交互。

## Apple 规范如何落实

HIG Motion 要求有目的、简短准确、可取消的反馈，并明确反对为了动画而动画，也提醒谨慎对待高频操作。WWDC 讲稿强调位置与速度连续；弹簧不等于反复弹跳，无明显回弹的弹簧同样是系统常用行为。

因此采用轻微、阻尼较高的弹簧：

| 通道 | 参数/幅度 | 意图 |
| --- | --- | --- |
| 常规按钮 | stiffness 520 / damping 34 / mass .6；hover 1.015，press .975 | 短促按压反馈；disabled/loading 不响应交互缩放 |
| 全宽导航、折叠标题 | hover 保持 1，press .99；图标 hover 1.06 / 上移 .5px | 防止整行文字横移、边缘溢出，保留精细反馈 |
| 折叠内容和窄窗菜单 | stiffness 380 / damping 38 / mass 1；真实高度 0 ↔ auto | 内容参与排版，可在中途反向，不用假 max-height |
| 侧栏宽度与分组标题高度 | stiffness 420 / damping 40 / mass 1；64 ↔ 184px，标题 0 ↔ 24px | 固定图标轨道，间距与布局连续变化 |
| 页面/子页切换 | 内容上移 5px 归位；透明度 160ms | 只提示内容替换，不保留第二份可操作旧页面，不阻塞点击 |
| 状态通知 | 上移 3px 归位；短淡入 | 初次出现反馈；稳定 key 的消息不因轮询重复入场 |
| 输入、开关、滑块、标签页、表格 | 短颜色/焦点过渡；小幅按压，滑块拖动光环 | 高密度工具中的局部反馈；不动画数值所代表的事实 |
| 窗口与启动器 | 保留既有解析临界阻尼、速度继承、橡皮筋边界、拖拽吸附 | 不打断已有拖动与快速开合；不与内部 Motion 争用几何 |

几何使用物理弹簧；颜色、阴影和透明度采用短缓动。颜色不是弹簧质量块，不把“所有通道均为物理模拟”当作质量目标。网页视觉反馈也不等于设备触觉反馈。

减少动态效果时：浮窗立即到终态并停止帧循环，React 几何与透明度立即切换，CSS 过渡/装饰动画关闭；箭头方向、选中态、焦点环和文本状态仍保留。偏好变化在运行时响应，不仅在初次加载时读取。安装版本的 `useReducedMotion` 实际只快照初始值；测试复现运行时切换后 opacity 仍约 .65，因此由工作区单次订阅媒体查询，并显式停止/设置各动画控制器到终态，避免仅改变 transition 而目标不变时旧动画继续运行。

HIG Materials 区分功能导航层的 Liquid Glass 与内容层的标准材料；regular 材料会模糊并调整亮度来保证文字可读性。项目采用一层共享窗口模糊/折射和主题 tint，内部卡片只用轻薄底色，不反复叠加多层强折射。不把文字本身做 blur/filter，也不让主题切换走整窗透明度动画。保留减少透明度和强制颜色回退。

## 展开时模糊突变的根因

原先每帧执行 `shell.style.opacity = presence`。当玻璃的祖先 opacity < 1 时，祖先形成 backdrop root，玻璃的背景采样范围发生变化；到 opacity 恢复 1 才再次采样外部页面，因此看起来先清透再突然模糊。MDN 的 backdrop root 说明覆盖了这一行为。

修复保持玻璃祖先 opacity 为 1，几何从启动器锚点的收拢状态随开合弹簧变化，防止去掉整体淡出后突然出现近乎完整的玻璃面板；用 CSS 变量仅淡入前景兄弟内容。共享背景伪元素的 backdrop-filter 始终有效，没有通过延迟创建滤镜、延长动画或提高不透明度遮掩问题。新建玻璃效果时也不要给其祖先添加 opacity 动画、filter、mask 或 clip-path。

先加入回归测试并看到失败：第一帧祖先 opacity 为 `0.06589273699410514`，期望 1。修复后逐帧断言和实际浏览器帧采样同时通过。最终浏览器采样第一帧约 5ms 时，几何 scale 与内容 opacity 约 .01，但玻璃祖先 opacity 已为 1，`url(#assistant-liquid-refraction) blur(10px) saturate(1.45) brightness(.45)` 从第一帧持续到终态。

## 集成边界及成本

- Motion 精确锁定版本；本地构建，无 CDN、远程动画代码、运行时网络请求或新增权限。
- React 界面用 LazyMotion 的 domAnimation，不加载本轮不需要的拖拽/布局投影功能。浮窗已有手势行为继续由原控制器负责。
- `motion`、`framer-motion`、`motion-dom`、`motion-utils` 的许可加入独立脚本和扩展第三方声明；既有 tslib 声明保留。
- 生产目标为 Chrome 111 的同配置 esbuild/minify/gzip 对比：修改前 product UI 为 1,465,480 bytes / gzip 417,980 bytes；最终按需加载版本为 1,552,816 bytes / gzip 448,671 bytes，增加 **30,691 bytes（约 30 KiB）gzip**。这是该构建入口实际增量，不是 npm 解包大小，也不表示整体扩展总大小。
- 不对整棵树启用 layout 动画，不在直播数据轮询时重播页面入场，不保留常驻动画循环。自动高度和侧栏宽度会触发布局，这是为真实排版选择的成本；不承诺所有设备恒定 60/120fps。

## 验证与边界

采用三类证据：可复现的逐帧浮窗行为测试、React/Mantine 实际交互测试、真实浏览器检查。测试覆盖快速反向开合、收起时 inert/aria-hidden、草稿及同一输入节点保留、单次操作、系统减少动态效果与销毁清理。浏览器检查玻璃第一帧至终态的滤镜/透明度、15 个功能页的横向溢出、导航对齐及窄窗菜单中线。

具体命令、测试计数、截图、最终提交与推送见 [行动日志](../development/action-log.zh-CN.md)。本地逐帧记录和原始调研证据放在忽略目录 `output/ui-motion-2026-11-03/`。jsdom 不具备真实 backdrop 合成能力，其通过不能替代浏览器视觉证据。当前浏览器证据来自 Chromium 内嵌预览，不能当作 Safari、Firefox、真实直播视频背景或低端显卡性能验收；SVG backdrop 折射的跨浏览器表现仍取决于浏览器支持，普通 blur 与已有实色回退保留。

## 官方来源

1. [Apple HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion)；[正文数据](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json)
2. [Apple HIG — Materials](https://developer.apple.com/design/human-interface-guidelines/materials)；[正文数据](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json)
3. [WWDC23 — Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/)
4. [Motion 官方仓库](https://github.com/motiondivision/motion)；[motion@14.9.0](https://www.npmjs.com/package/motion/v/14.9.0)
5. [react-spring 官方仓库](https://github.com/pmndrs/react-spring)
6. [Anime.js 官方仓库](https://github.com/juliangarnier/anime)
7. [GSAP Standard License](https://gsap.com/community/standard-license/)
8. [MDN — backdrop-filter / backdrop root](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)
9. [Liquid Glass React](https://github.com/rdev/liquid-glass-react)
10. [npm 下载统计 API 示例](https://api.npmjs.org/downloads/point/last-month/motion)；以上统计均保存了原始响应，查询窗口会随访问日期变化。
