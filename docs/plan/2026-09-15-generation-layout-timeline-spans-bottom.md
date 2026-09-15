# 生成面外壳布局修回旧设计：时间轴横贯底部、AI 面板被顶上去

> 📎 方案 · 2026-09-15 · 对应 TODO `T-RL-06` + `T-ED-01`（同一面）＋ `T-DS-10` 里只属于这一面的那条
> 用户 09-14 拍板 **A = 修回旧设计**，不需样张；停靠列 B（面板顶到底、时间轴只占中间）留下一版、本次不做。

## 1. 用户摩擦（D1，原话）

09-13 19:27 截图 + 原话：「打开右侧 AI 栏和中间的时间轴之后页面被切割」「不小心点了下面的时间轴收不回去了，本来我记得可以收回，而且排版都错了，怎么右下角缺了一大块，本来不是他在右面通过去吗，另外就是拉上来太大了，这里核心是拖动后面可以预览，主要有两个轨道一个图片一个视频可以预览就行」。

截图证据：`docs/roadmap/sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg`（Nomi-core-materials 分支）。量出来的事实：时间轴右边界停在画布列右缘（x≈1018），AI 面板下边界 y≈690，**面板下方到窗口底边那一块（约 400×195）什么都没有**——就是他说的「右下角缺了一大块」。

## 2. 旧设计就是规格（迁移前代码）

`git show 8f9365aeb:src/workbench/generation/GenerationWorkspace.tsx`（2026-08-27，React Flow 迁移前）里三者的容器关系：

| 角色 | 网格落位 | 关键行 |
|---|---|---|
| 工作区容器 | `gridTemplateColumns: minmax(0,1fr) var(--generation-assistant-width)`、`gridTemplateRows: minmax(0,1fr) <时间轴高度>` | 8f9365aeb:83 |
| 画布 | 第 1 行第 1 列 | 8f9365aeb:108 |
| AI 面板（aside） | 第 1 行第 2 列，`border-b` 收边 → **底边 = 时间轴顶边** | 8f9365aeb:147 |
| 时间轴 | 第 2 行 **`col-span-full`** → 横贯两列 | 8f9365aeb:177 |

所以「时间轴横贯整个底部 + 面板被顶上去 + 右下角不空」在旧代码里是**一个 CSS 声明**（`grid-column: 1 / -1`）的结果，不是一套布局机制。

## 3. 根因（P2）

`d2bb622c1`（2026-09-10）把这一行从 `col-span-full` 改成 `col-start-1`，理由写在代码注释里：「agent 面板弹簧动画改宽时时间轴跟着左右伸缩、盖住画布内容」。

- 这条理由**不成立**：`col-span-full` 下时间轴宽度 = 两列之和 = 工作区宽，与 `--generation-assistant-width` 无关，动画期间也是常量。真正会随面板宽度伸缩的是**改成 `col-start-1` 之后**的那一版（宽度 = 第 1 列）。
- 同一晚落地的走查至今还写着「生成画布的时间轴是 `col-span-full`，宽度不随助手面板变」（`tests/ux/timeline-toolbar-row.walk.mjs:266`）——代码和它自己的走查注释当场对不上，而没有任何一处断言量过这条关系，所以漂了 5 天没人发现。
- **类根因**：外壳三件（画布 / 面板 / 时间轴）的容器关系没有任何结构测试或走查断言锁住；它是一串 Tailwind 类名，改错不会红。分类 `recurring`。

## 4. 同一面的其余三条

1. **收不回去**：面板内的收起钮自 09-10 起就有（`src/workbench/timeline/TimelinePanel.tsx:402`），但它是行尾一颗**无文字的 chevron**，排在十几颗同款 icon 钮之后，而且住在 `overflow-x-auto` 的滚动区里——行放不下时它第一个被滚出视口。属「说坏了其实是找不到」那一族（`docs/lessons/group-says-broken-usually-means-undiscoverable.md`）。修法：把「?」与收起钮移出滚动区，钉在行尾固定槽里，收起钮补上现役文案 `timelineEditor.collapsePanel`（「收起时间轴」）。
2. **默认高度**：`TIMELINE_PANEL_DEFAULT = 188` 是拍出来的数（注释自称对齐旧 `--workbench-timeline-height`）。188 装不下两条主轨——用户必须先拖高才看得到视频轨，拖过头就成了「拉上来太大了」。修法：由内容派生 = 面板内边距 + 工具条行 + 标尺行 + **两条主轨行**。
3. **跟着面板左右跳动**：`col-span-full` 恢复后时间轴宽度与面板开关解耦，这条随 §3 一起消。

`T-DS-10` 里「右上功能栏遮挡」的时间轴那半已由 09-10 合同 `docs/fixes/2026-09-10-timeline-toolbar-overlay.root-cause.json` 修掉；本次只在走查里把它量出来当回归网，**不扩到三栏统一**（那条等 T-DS-01）。

## 先查别人（R27）

- **框架原生（CSS Grid）**：「让底部一行横跨所有列」的原生写法就是 `grid-column: 1 / -1`（Tailwind `col-span-full`）——MDN `grid-column` 明确 `-1` 指向显式网格的最后一条线，https://developer.mozilla.org/en-US/docs/Web/CSS/grid-column 。不需要测量、不需要 JS、面板宽度动画期间也是常量。本次就用它，不引任何布局库。
- **生态 npm（已在依赖里）**：`react-resizable-panels@^4.12.3`（`package.json:284`）提供的是**可拖拽分栏组**，剪辑面已经在用（`src/workbench/preview/PreviewWorkspace.tsx:192` 的 `Group orientation="vertical"`）。它解决的是「拖动分割线」，解决不了「哪一行跨几列」——本次需求是后者，所以**不**把生成面也换成 PanelGroup（那是重排，且会把 A 方案变成 B 方案）。
- **生态开源近邻**：OpenCut 的编辑器外壳把时间轴当**全宽底部行**、和上方舞台行并列，而不是塞进某一列：https://github.com/OpenCut-app/opencut-classic/blob/main/apps/web/src/timeline/components/index.tsx （同一份出处在 09-10 合同里已核对过工具条形态）。旧 Nomi 与它同形。
- **我们自己（仓库里已有）**：① 迁移前的现成实现 `git show 8f9365aeb:src/workbench/generation/GenerationWorkspace.tsx:177` = `col-span-full`，本次等于把它抄回来；② 高度界与折叠偏好的换算层已经抽好，`src/workbench/timeline/timelinePanelBounds.ts:24` 与 `src/workbench/timeline/timelinePanelPrefs.ts:15`，默认高度只需改成派生、不需要新文件；③ 走查夹具与几何量法照抄 `tests/ux/timeline-toolbar-row.walk.mjs:122`（带阳性对照的相交判据）。
- **结论**：全部用已有——一行 CSS 恢复旧规格 + 在现成换算层里把默认高度改成派生 + 照抄现成走查量法；新增的只有「锁住这条关系」的断言（结构测试 + 走查），因为缺的正是它。

## 6. 范围 / 不动项 / 回滚 / 验收门

**改**：`src/workbench/generation/GenerationWorkspace.tsx`（时间轴回 `col-span-full`）、`src/workbench/timeline/TimelinePanel.tsx`（行尾固定槽 + 收起钮带文案）、`src/workbench/timeline/timelinePanelBounds.ts`（默认高度派生）、新增结构测试与走查。

**不动**：剪辑面 `PreviewWorkspace`（它本来就是停靠列形态，B 方案那一版本次不做）；画布底栏与胶囊落位（`3cb9b5a3f` 刚定）；三栏统一（T-DS-01）；轨道行高与时间轴视觉（要动就得出样张）。

**回滚**：三处改动互不依赖，任一处 revert 不影响其余；无数据迁移（折叠偏好与高度都是本机偏好，键名未变）。

**验收门**：① 新结构测试锁住容器关系；② 新走查四态量真实矩形（只开面板 / 只开时间轴 / 两个都开 / 收起）；③ `pnpm run gates` 绿。
