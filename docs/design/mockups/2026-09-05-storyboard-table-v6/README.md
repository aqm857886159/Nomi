# 分镜表 v6 样张（方向 A · 用户已拍板 2026-09-05）

> docs-only。这四张样张是可直接浏览器打开的静态 HTML（inline style，无 `support.js`/`x-dc` 包裹），配套设计合同见
> [`../../2026-09-05-storyboard-table-v6-design-contract.md`](../../2026-09-05-storyboard-table-v6-design-contract.md)。
> 方向 B（参考槽进提示词框头部）与方向 C（兜底照搬节点参数框）已讨论但未采纳，不收进本目录；
> 判断记录见设计合同 §8「不做项」。

## 文件

| 文件 | 是什么 | 对应渲染图 |
|---|---|---|
| `Main.html` | **全表整页**：顶栏 + 编辑器外壳 + 批量条 + 锚区收起态 + 5 行分镜（覆盖编辑态/完成态/失败态/首尾帧模式/全能参考模式）+ footer | `preview-Main.png`、`preview-Main-fan.png`（参考叠放扇形特写） |
| `AnchorsExpanded.html` | **锚区展开态**：4 张锚（已锁定/生成中/空/文字）用和镜头行完全同一套解剖（画面格 / 参考列 / 提示词框+底栏）直接生成 | `preview-AnchorsExpanded.png` |
| `SlotMatrix.html` | **参考列随模型 × 模式变化**：Seedance 2.5 的 4 个模式 + Veo 3.1「帧」+ Nano Banana 2「编辑」，共 6 行真实档案声明 → 参考列长什么样 | `preview-SlotMatrix.png` |
| `RowOps.html` | **镜头的增删改查**：行间插入线、⋯ 菜单、拖拽落点线、多选浮条（纸白胶囊）、键盘图例 | `preview-RowOps.png`、`preview-RowOps-bar.png`（多选浮条特写） |

## 拍板日期与来源

- **2026-09-05**，用户在讨论中对「方向 A」拍板，并追加了参考列两条规则（一个槽一个格 + 固定单行三格 200px）、参考叠放扇形手法、锚区两态细节、多选浮条样式核对。原始画板见
  `canvas.json`（会话内产物，未收进仓库；关键文字已转写进设计合同 §2/§4/§9）。
- 取证与约束全文：分镜表 v6 设计简报（会话内 `brief.md` + `user-constraints-addendum.md` + `token-sheet.md`，关键内容已摘录进设计合同）。
- 现役实现对照的 file:line 与旧分镜表 15 条功能对账见设计合同 §5。

## 怎么看

直接双击 `.html` 文件用浏览器打开即可（零依赖、零网络请求）。四张图都用真实 token 的近似 hex 值（见设计合同 §6），不是 oklch 原值渲染，色彩在广色域屏上会比样张更饱和——这是已知的可接受偏差，不是需要修的 bug。
