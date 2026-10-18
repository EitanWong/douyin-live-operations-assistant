# Solid Glass

- 来源：https://github.com/deeplethe/solid-glass
- 取用日期：2026-10-18
- 许可：MIT，见本目录 LICENSE。
- 参考源文件：`src/solid-glass.css`、`src/components/ui/panel.tsx`、`src/components/ui/tag.tsx`。

`src/ui/solid-glass.js` 将上游亮暗色材质变量和 Panel、Tag、控件的样式适配为原生 DOM / Shadow DOM，保留边缘高光、三层表面与统一选中状态；无需 React、Tailwind 或在线资源。仅最外层悬浮面板使用背景模糊，内容表面使用本地叠色，避免重复模糊影响直播页性能。

面板直接导入共享样式。构建脚本将同一份样式输出为扩展的 `solid-glass.css`，供 popup 使用，并在扩展和独立用户脚本中保留许可。修改共享材质后运行 `npm run build`（开发模式由监听器重建）。


颜色模式默认跟随 `prefers-color-scheme`，也可在「设置 → 外观」或扩展弹窗中固定为亮色／暗色。`src/ui/theme.js` 独立保存工具外观，不混入主播的互动配置；扩展使用 `chrome.storage.local` 同步各面板与弹窗，用户脚本和本地演示使用同源 `localStorage`。订阅存储变化后可即时同步，面板销毁时取消订阅。

配色以抖音红 `#fe2c55` 和青色 `#25f4ee` 为来源：主按钮使用满足白字对比度的深红，选中项使用红色浅叠层，连接状态使用青色。亮色模式对彩色文字单独加深，玻璃的边缘高光、表面透明度和阴影随主题切换。
