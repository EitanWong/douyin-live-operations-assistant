# 扩展图标：开播对话

![开播对话](../../extension/icons/128.png)

以带播放键负空间的对话气泡作为唯一主体：播放代表直播，对话代表互动助手。深黑圆角底与白色主体保证明暗背景下的辨识度；少量青、红错位边缘呼应抖音视觉元素。图标内不放文字，避免缩到工具栏尺寸后模糊。

## 资产与接入

- 可编辑源文件：`extension/icons/icon.svg`，128 × 128 坐标系。
- 浏览器资产：`16.png`、`32.png`、`48.png`、`128.png`；独立展示或宣传使用 `512.png`。
- 背景 `#15161C`，主体 `#F6F5F2`，青色 `#25F4EE`，红色 `#FE2C55`；圆角之外透明。
- 扩展管理页由 manifest 的 `icons` 指定；工具栏由 `action.default_icon` 指定 16 / 32px，覆盖常见 1× / 2× 显示。
- 构建从 manifest 的 `icons` 读取需复制的 PNG；开发构建的版本摘要包含这些资产，图标更新也能触发既有重载流程。

## 重新导出

SVG 是唯一设计源；修改后重新导出所有 PNG，检查 16px 原尺寸以及明暗背景。现有 `sharp` 运行依赖可用于导出，无需新增包：

```sh
node --input-type=module <<'NODE'
import sharp from 'sharp';
for (const size of [16, 32, 48, 128, 512]) {
  await sharp('extension/icons/icon.svg', {density: 1152})
    .resize(size, size).png().toFile(`extension/icons/${size}.png`);
}
NODE
```

此任务仅更新扩展图标和打包配置；工作台页面、组件布局和弹窗正文没有改动。亮暗工具栏示意属于视觉预览，不代表实际浏览器扩展已重载。使用新图标需在 Chrome 扩展管理页重新加载当前扩展。
