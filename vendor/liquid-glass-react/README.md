# Liquid Glass React

- 来源：https://github.com/rdev/liquid-glass-react
- 取用日期：2026-11-03
- 许可：MIT，见 LICENSE。
- 参考：src/index.tsx 的背景折射层 / 清晰内容分层，src/utils.ts 的 standard displacementMap。

src/ui/liquid-glass.js 将 SVG 背景折射适配到 Shadow DOM；滤镜只作用于悬浮窗的背景层，文字、图表、输入框不进入滤镜。材质、高光和控件表面由共享基础样式提供。无需远程资源、Tailwind 或逐控件鼠标监听。背景层尺寸跟随窗口，避免上游以 window.resize 测量尺寸对浮窗缩放的限制。

默认材质为 Liquid Glass，用户明确保存的 Solid Glass / 实色偏好继续生效。不支持背景滤镜时退化为实色；减少透明度或强制颜色时关闭折射与模糊。引用上游位移图的完整许可内联保留于构建后的用户脚本。
