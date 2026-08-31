# 资源库样张设计复审（设计视角 × 用户视角）

日期：2026-08-30
范围：`docs/prototypes/library-discovery.html`、Nomi 设计系统、真实素材库组件。
性质：只读评审；不修改生产代码，不把样张当成已实现功能。

## 结论先行

当前方向可以继续：资源仍从左侧已有入口进入；点击详情居中，不压缩画布；素材按媒体真实比例展示；分类是主要发现手段。

需要先收敛一个原则：素材库是“看图、认出、拿走”，不是资料管理表。网格卡片只保留缩略图、文件名和最少类型线索；描述、标签、来源、收藏和删除不应全部平铺。分类保留为一行高频入口，低频类型筛选收进一次点击菜单。这样才符合用户“加分类就行、不要再加很多字”的反馈。

本轮没有发现必须阻断方案的 P0；有 3 个 P1 应在生产实现前修正，另有 3 个 P2 可随实现收口。

## 两个视角的判断

### 设计视角

- **层级正确**：左侧资源栏是 L1 入口；分类属于素材库内部的 L2/L3 发现控件；详情属于情境浮层，不应变成常驻右栏。设计系统要求每个面不超过约 5 个常驻功能簇，且“同一功能一个家”（`docs/design/nomi-design-system.md:100-139`）。
- **素材应让内容占主角**：设计系统明确禁止动作压在图像/视频内容上（同文档 `:137-147`）。卡片右上收藏、卡片底部主按钮、`⋯` 菜单同时出现，会让素材变成按钮集合而不是可识别的媒体。
- **中央详情的形态是对的**：弹窗应使用 `rounded-nomi-lg`、`bg-nomi-paper`、`shadow-nomi-lg` 等现有 modal token（同文档 `:338-357,443-447`），生产版优先复用 `DesignModal`/现有 `AssetPreviewDialog`，不要在各库另造抽屉。
- **原型与生产视觉不能混用**：样张 CSS 使用了原始 hex 和任意尺寸（`docs/prototypes/library-discovery.html:12-17,39-53`），作为 throwaway 原型可以接受，但生产代码必须回到 `src/design` 和 `nomi-*` token（设计系统 `:31-35,381-399`）。

### 用户视角

用户进入素材库通常只有一件事：在当前项目或全部项目中找到一个看得出来的图/视频/音频，然后拖入或导入。其旅程是：

`进入素材 → 用分类缩小 → 通过真实画面认出 → 点击/拖拽使用`

用户不需要在列表里先读“描述、标签、来源、状态、主按钮、更多操作”才能判断素材。详情只在“看不清/需要确认”时出现，且应以预览为主；素材本身不需要一段说明文字才能使用。

## P0 / P1 / P2

### P0：本轮无

没有发现会让方案完全不可用或造成数据损失的设计阻断。素材导入、删除和跨项目物化仍须沿用现有写入边界，属于生产实现验收，不在本次样张审查宣称已完成。

### P1：生产实现前必须处理

| 编号 | 问题与证据 | 用户影响 | 可执行修改 |
| --- | --- | --- | --- |
| P1-1 | 样张的素材卡由 `card()` 统一渲染标题、meta、最多两个 tag、收藏、主动作和 `⋯`（`docs/prototypes/library-discovery.html:135`）。素材分支仍继承这些字段；与用户要求“不要增加字”冲突。 | 用户视线先扫按钮和小字，反而不容易比较真实媒体。 | 素材网格默认只显示：真实缩略图/首帧/波形、文件名、一个媒体类型图标/角标。移除卡片内描述、tag、状态、收藏和每张卡的导入按钮；拖拽/点击是主路径，导入/删除等动作放到选中后的单一情境工具条或 `⋯`。工作流/提示词/Skill 卡片可保留自己的主动作，不要把规则套到所有库。 |
| P1-2 | 样张 `.asset-grid .thumb` 强制 `aspect-ratio: 4 / 3`，只有 audio 改为 `2.2 / 1`（`docs/prototypes/library-discovery.html:44`）；`thumb()` 也只画占位色块（`:134`），并没有证明真实比例。生产非 compact `AssetGridCell` 还使用 `aspect-square`（`src/workbench/assets/AssetLibraryPanelParts.tsx:354-375`），compact 图片虽 `h-auto`，视频仍固定高度 96px（`src/workbench/assets/AssetLibraryPanelParts.tsx:313-347`）。 | 竖图、横图、长图会被统一框裁切；用户可能认错素材。 | 资产内容区改为 intrinsic ratio：图片 `width:100%; height:auto; object-fit:contain`；视频 poster 使用实际宽高比，音频用固定高度的波形条。若要保持虚拟列表性能，先只改现有侧栏的 `compact` 分支，避免一次重写普通节点网格；所有比例异常素材都用 `object-contain`，不做中心裁剪。样张应至少放 2:3 竖图、16:9 视频、4:3 图和音频条验证。 |
| P1-3 | 样张素材库同时平铺“全部/最近/收藏”、搜索、“分类”菜单、“类型”菜单和“排序·最近使用”（`docs/prototypes/library-discovery.html:138,145-153`）。已有真实组件还同时有来源 tab、上传、搜索、删除选区、新建文件夹、媒体类型筛选（`src/workbench/assets/AssetLibraryPanel.tsx:134-193,520-667`）。 | 在窄侧栏内用户不知道先点什么，分类和类型的心智重复。 | 资产库 L1 只保留“来源范围（全部项目/当前项目） + 搜索 + 分类 chips（全部/人物/场景/声音/其他）”。`最近/收藏/排序`先不做常驻；媒体类型用卡片角标识别，确有需要时从一个“更多筛选”进入，不再同时显示两个筛选按钮。文件夹是项目整理能力，继续在“当前项目”范围内生效，不和语义分类混成一套。 |

### P2：可随实现收口

| 编号 | 问题与证据 | 用户影响 | 可执行修改 |
| --- | --- | --- | --- |
| P2-1 | 详情弹窗对所有资源都输出“复制时会带上/内容/素材/安全边界”明细（`docs/prototypes/library-discovery.html:142`）。这对工作流有用，对一张图片或一段音频是额外阅读。 | 点击预览后仍要读技术说明，打断“看一眼就拿走”。 | 详情按资源域分支：素材只显示大预览、文件名和一个上下文主动作；工作流再显示结构/素材/写入边界。生产统一使用 `AssetPreviewDialog`（`src/workbench/assets/AssetPreviewDialog.tsx:15-92`）或 `DesignModal`，不造第二套 overlay。 |
| P2-2 | 样张收藏和 `⋯` 都是卡片上的常驻动作（`:135,155-159`），素材实际组件还用 hover 才显示删除（`src/workbench/assets/AssetLibraryPanelParts.tsx:247-269`）。 | 触屏/键盘用户难以发现 hover 动作；常驻动作又增加噪声。 | 素材卡把“预览/使用”作为唯一默认动作；删除、改名、归档走选中后的 `⋯` 或明确工具条。任何禁用动作补 `title`/就近原因，遵守设计系统 C1/C4（`docs/design/nomi-design-system.md:154-170`）。 |
| P2-3 | 非 compact 素材格使用 `aspect-square`，compact 使用 CSS 多列瀑布流，而虚拟列表的 `gridCols` 按 compact=2、普通=3 计算（`src/workbench/assets/AssetLibraryPanel.tsx:242-250`），compact 分支却直接写 `columnCount: 3`（`:727-744`）。两种路径的密度与顺序可能不同。 | 不同入口看到的素材形态不一致，筛选后滚动位置也可能跳动。 | 第一阶段只统一实际使用的 compact 侧栏路径；为瀑布流明确“内容顺序不保证行对齐”，筛选后回到顶部。若未来启用普通网格，再单独留下性能基线，不要为了视觉统一机械改虚拟化。 |

## 推荐交互合同（可直接给原型和实现）

1. 进入素材库后，第一行是来源范围（全部项目 / 当前项目），第二行是搜索；分类 chips 紧跟搜索，最多 4–5 个常用分类。
2. 用户先按分类，再扫真实缩略图；卡片默认无长描述、标签和多按钮。
3. 单击素材：在当前上下文选中；双击或预览图标：打开中央预览。中央预览支持遮罩、右上关闭、`Esc`，不出现右侧常驻详情栏。
4. 画布侧拖入是主动作；需要物化跨项目素材时，在选中状态出现一个“导入当前项目”动作。写入成功后沿用现有 toast/刷新信号，不在卡片上重复放导入按钮。
5. 分类必须是确定性字段：媒体类型、现有文件夹、用户已有标签；不调用 AI 猜分类，不要求用户先填写描述。
6. 空态只解释当前范围与恢复动作；沿用 `DesignEmptyState`，不在空态堆筛选教程。

## 生产落点与验收

- **入口**：复用 `ProjectExplorerSidebar` 现有 asset-library tab（`src/workbench/explorer/ProjectExplorerSidebar.tsx:42,124-168,320-331`），不新增“概览”或第二个素材库入口。
- **分类/来源**：复用 `AssetLibraryContent` 的 `sourceFilter`、`activeFolderId` 和 kind filter（`src/workbench/assets/AssetLibraryPanel.tsx:134-193,526-667`），把常用分类呈现为少量 chips；文件夹仍只在当前项目范围管理。
- **媒体展示**：复用 `AssetGridCell`、`NomiImage`、`AssetVideoCover` 和 `AssetThumb`（`src/workbench/assets/AssetLibraryPanelParts.tsx:223-355`），修正比例策略，不新造媒体卡片体系。
- **预览**：复用 body-portal `AssetPreviewDialog`（`src/workbench/assets/AssetPreviewDialog.tsx:15-92`），工作流/提示词等非媒体详情再复用 `DesignModal`。
- **token 与控件**：生产实现只用 `src/design` 导出的 `DesignSearchInput`、`WorkbenchButton`/`WorkbenchIconButton`、`DesignModal` 以及 `nomi-*` token；样张中的 raw hex、任意字号和 7/9px 间距不能搬入组件。

验收至少覆盖：

- 2:3 竖图、16:9 视频、4:3 图片、音频在同一素材库中保持可辨比例；不被中心裁切。
- 仅显示分类/来源/搜索核心控件时，用户能从全部项目找到并导入一项素材；导入和预览动作不混淆。
- 点击、双击、键盘 Enter/Esc、遮罩关闭均有效；详情不会挤压画布。
- 资源卡无描述/tag 时仍能靠缩略图、文件名和类型识别；长文件名有 tooltip 或可访问名称。
- 当前项目空态、全部项目空态、搜索无结果分别可恢复；筛选不留下不可点击的结果。

## 给下一轮的决定

本审查建议采用“少文字 + 真实媒体 + 分类优先”的版本继续推进。不要再为素材库增加概览、单独详情侧栏或更多卡片字段。先按 P1-1/P1-2/P1-3 修改样张，再把同一交互映射到现有 `AssetLibraryContent`/`AssetGridCell`/`AssetPreviewDialog`；工作流库的完整复制合同和画布分组复制仍是独立实现，不应被素材库 UI 绑架。
