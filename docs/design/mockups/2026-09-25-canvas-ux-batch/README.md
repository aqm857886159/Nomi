# 画布手感三改 · 样张 v1（2026-09-25）

状态：**待拍板**（Claude Design 样张，未实现产品 UI）。在线版：https://claude.ai/artifact/8PAKadacB2uZ8WbxJWScMC

来源：用户 2026-09-25 反馈三条（方向已拍板）：

1. 参数浮框固定贴在节点正下方、宽度固定、被挡就挡；提示词框右上角加「展开」。
2. 单个节点生成不弹「开始生成」确认；预计花费显示在发送按钮旁；多个 / 超金额 / Agent 发起才确认。
3. 程序不再主动平移 / 缩放画布；新建和导入的东西落在屏外时在画布边缘提示，点了才过去。

## 文件

- [index.html](index.html)：样张源文件（token 内嵌副本抄自 `src/theme/nomi-tokens.css` 与 `tailwind.config.ts` 暗色块；图标是 Tabler outline 路径）。
- [build.mjs](build.mjs)：把 `evidence/*.jpg` 内联成 data URI，产出可发布的 `dist/index.html`。
- `evidence/`：现状真机截图（`origin/main d8824a0c5` 构建，Windows，zh-CN，`used` 夹具 1280×800）。由一次性探针拍摄，探针已删除。

## 可体验

- ① 切节点位置（中间 / 靠右 / 靠底）和缩放（60 / 100 / 140%），看浮框不躲、不翻、不变宽；点提示词右上角展开。
- ② 切模型报价（0.3 点 / 未标价 / 12 点）、一次几个、谁发起，点 ↑ 看这一下弹不弹。
- ③ 点「模拟」按钮看新东西落点；屏里放不下时边缘出提示，点提示才移动；自己拖画布把它们拖进屏里提示消失。

## 重建

```sh
node docs/design/mockups/2026-09-25-canvas-ux-batch/build.mjs
```
