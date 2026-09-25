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

## 拍板结果（2026-09-25，5 题全按默认）

浮框定宽 560 · 单次 ≥ 10 点才确认 · 打开项目只在「本来有内容且没有可用视角」时摆一次全貌 · Agent 跨分类不自动切（边缘提示点了才切）· 「展开」不给 Agent 付费卡。

## 实现后逐项对账（真机：打包 Electron，Windows，used 夹具 1280×800，zh-CN + en）

| 样张里的承诺 | 真机结果 | 证据 |
|---|---|---|
| 浮框钉在节点正下方，不躲、不翻、不压节点 | 选中靠下的节点：浮框顶 = 节点底 + 14，中线对齐；伸出屏幕与被「画面小窗」挡住的那截就挡着 | 探针量值 `cardTop 330.5 = nodeBottom 316.5 + 14`，[截图](evidence/after-zh-01-composer-low-node.jpg) |
| 宽度恒 560，与缩放、模型、语言无关 | 100% 与 80% 缩放、图片 / 视频、zh / en 都是 560 | 探针量值 `cardWidth 560` |
| 提示词装不下才出现展开钮，点开原地变高、再点收起 | 5 行装得下时不出现；6 遍长提示词时出现，展开后 `data-prompt-expanded=true` | [展开后](evidence/after-zh-04-long-prompt-expanded.jpg) |
| ↑ 左边常驻点数，未标价写「未标价」 | `🪙 0.3`；×2 变 `🪙 0.6`；未标价模型显示「未标价 / Unpriced」 | [zh](evidence/after-zh-05d-footer-cost.png) · [en](evidence/after-en-05d-footer-cost.png) |
| 单个、不贵、自己点 → 不弹 | 点 ↑ 后 1.5s 内无确认框，节点直接进入生成（夹具供应商随后报错是夹具不支持查询，与本改动无关） | 探针 `dialog count 0` |
| 一下跑 ≥2 个 → 弹 | ×2 点 ↑ 弹「开始生成 · 将生成 2 张画面 · 0.6 点」 | [截图](evidence/after-zh-05c-variant-two-dialog.jpg) |
| 新建不挪画布 | 工具条新建、⌘D 复制前后 `.react-flow__viewport` transform 不变 | 探针量值 |
| 落在屏外 → 边缘提示，点了才过去，看见了自己消失 | 「新节点在下方 ↓」「2 个新节点在下方 ↓ / 2 new nodes below」；点后画布框住新节点、提示消失 | [新建](evidence/after-zh-02-new-node-no-pan.jpg) · [⌘D zh](evidence/after-zh-06-duplicate-hint.jpg) · [⌘D en](evidence/after-en-06-duplicate-hint.jpg) · [点提示后](evidence/after-zh-07-after-hint-click.jpg) |

与样张不同的一处：样张里提示胶囊贴边位置是示意；实现中下方那颗抬在底部停靠区之上（`bottom-20`），左侧那颗让开左缘工具条（`left-16`）。
