# 侧边栏、图标与可复用界面组件

调研与实现日期：2026-10-23。

## 开源方案

| 方案 | 适用点 | 本次取舍 |
| --- | --- | --- |
| [Lucide](https://lucide.dev/guide/) / [源码](https://github.com/lucide-icons/lucide) | 统一描边 SVG、支持原生 JavaScript、可按需使用 | 采用 20 个 SVG 图标，静态内嵌，无运行时请求。来源固定到提交，ISC / MIT 许可随产物分发 |
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | 无样式的可访问组件，适合 React 设计系统 | 本项目无 React 运行时；不为现有简单控件引入框架。沿用原生按钮、选择器与 details |
| [Shoelace](https://shoelace.style/) | 与框架无关的 Web Components，覆盖表单、标签导航等组件 | 当前工具已有 Shadow DOM 和主题 token。此次保留原生组件，避免再引入一套样式与自定义元素运行时；复杂新控件可独立评估 |

视觉原则继续参考 [Apple HIG — Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) 和 [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)：持续展示主要入口，选中状态清晰，动效保留用户对空间的理解。

## 行为

工具宽度达到 1000 像素时，导航变为侧栏，同时展示互动和设置两组；小于该宽度自动恢复顶部分类导航。同一份标签与页面节点贯穿所有布局，切换不重建表单。

侧栏默认在左，可在“设置 → 外观 → 侧边栏位置”改为右侧。右侧模式镜像排列标题、分组名、菜单文字与图标。顶部按钮用于折叠 / 展开：展开宽 172 像素，折叠为 56 像素的图标栏。功能名称仍通过可访问名称、原生悬停提示提供。两种偏好分别保存在当前站点 localStorage，不随主播规则导出，不新增权限。

折叠复用同一个 `Spring`，改变目标时保留位置与速度，所有静止后停止帧循环。真实改变侧栏宽度以让内容重排；按帧合并，系统要求减少动态效果时立即到达目标。内容区域有独立查询容器：图表和多栏断点使用扣除侧栏后的可用宽度，折叠也能释放内容空间。

侧栏与正文分别滚动。垂直导航用上下方向键，顶部导航用左右方向键，各组支持 Home / End；禁用功能保持隐藏。布局变化隐藏了聚焦导航时，将焦点交给当前选中入口。

## 工程边界

- `src/ui/icons.js`：图标渲染与公共图标按钮装饰；更新按钮文字只替换标签节点，保留图标。
- `src/ui/navigation.js`：声明式菜单表、导航模板、左右位置与折叠状态；组合已有 `Spring`。
- `src/ui/navigation-styles.js`：顶部、左右侧、图标栏样式。
- `src/ui/adaptive-layout.js` / `adaptive-styles.js`：正文密度和分组默认展开状态。
- `src/ui/floating-window.js`：外窗位置、尺寸、手势；不处理具体导航与业务页面。
- `src/ui/panel.js`：组合上述组件，并连接业务页签、配置与数据更新。

没有增加运行时 npm 依赖。图标来源、固定提交与完整许可在 `vendor/lucide/`；构建脚本把许可追加到扩展和用户脚本配套的 `THIRD_PARTY_LICENSES.txt`。

验证包含左右对齐、展开 / 折叠、连续反向、减少动态效果、偏好存储失败、窄窗口恢复、禁用功能、键盘导航、短窗口侧栏滚动，以及现有完整回归测试。
