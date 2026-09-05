# 分镜表 v6 · 2026-09-06 用户反馈返工

> 状态：🚧 进行中（视觉基线待用户拍板）；任务分支 `feat/storyboard-v6-lab-first-20260906`，PR #518。
> 设计规则的唯一真相源仍是 [v6 设计合同](2026-09-05-storyboard-table-v6-design-contract.md)；本文件只记反馈、处理与验证。

| 反馈 | 处理 | 同步合同章节 | 验证状态 |
|---|---|---|---|
| 1. 删除行展开区，台词和转场也删除 | 删除展开按钮、展开组件、台词/转场字段与分镜数据投影；参考和生成设置各保留现有唯一入口。剪辑面负责字幕轨与接缝 | §2.3、§5、§6、§7、§8、§9 | 已实现：composerBarLayout + 参数网格测试 |
| 2. 参数行覆盖画幅后错位 | 固定七列：模型、模式、画幅、时长、清晰度、音频/尾帧、生成；继承画幅留空格，统一容器断点换行；纯布局函数测试 | §2.3、§2.4.1、§6.2、§9.1 | 已实现：几何函数 + 1–30 张测试 |
| 3. 全能参考堆遮挡相邻槽 | 三张代表卡的每张 8px 偏移计入占位，三槽统一宽度和间距；最多 30 张只画代表卡，计数完整可见 | §2.6、§4.1、§4.2、§6.3、§9.1 | 已实现：共享叠放宽度函数覆盖 1–30 张 |
| 4. 每场播放、播放全部 | 扩展现有 portal 播放器，按行序播产物；图片按行时长/默认 3s，视频播至 ended，附属音频同播；进度保留灰色未生成镜；左右键换镜、ESC 关闭；三种状态入实验室 | §2.1、§2.6、§3、§8、§9 | 已实现：场/整片共用播放清单与 portal 播放器；播放中/跳过/全空三态已登记 |
| 5. 剧本连接与提示词来源（仅设计） | 展示来源段落 chip、未改/已改状态及回跳高亮设计；不接生产文稿读写链 | §2.7、§3、§8、§9 | 已实现：两种行状态入实验室；真实文稿读写仍明确不接 |

## 返工二轮（2026-09-06 用户看图后打回）

用户在实时展示（1440 宽）里逐格看过第一轮返工，两处**没做对**——第一轮把「换行错位」换成了
「截断重叠」，更糟。这一轮修的是根因，不是观感：

| 用户看到的 | 根因 | 修在哪 |
|---|---|---|
| 参数行「模式 首帧」被模型图标压住、「画幅」「清晰度」被截、「返回尾帧」被「生成」盖住（`sb-row-01/02`） | 底栏写死 `grid-cols-[minmax(0,1fr)_auto×6]`：七格自然宽合计 570px + 6 个 gap，塞进 492px 的提示词块，`1fr`/`auto` 轨道被压到 min-content 以下就开始截断与溢出重叠 | 列宽与断点从内容量出来：`shotRow/composerGridLayout.ts`（纯几何 + 单测）+ `shotRow/ComposerGridScope.tsx`（**全表共用**列宽最大值与断点）+ `shotRow/useComposerGridMetrics.ts`（在内层 `w-max` 节点上量自然宽度）；装不下就整表一起换成两行四列：`模型｜模式｜画幅｜时长` / `清晰度｜生成音频·返回尾帧｜生成` |
| 全能参考的叠放堆压到「白膜预览」上、盖住「参考」caption（`sb-slot-04`） | 叠放卡用 `absolute inset-0` 撑满 80×56 的容器再旋转 13°/26°，扇面实际扫到 96.5×85.4——**槽按卡片尺寸占位，没按旋转后的包围盒占位** | `shotRow/shotReferenceStackGeometry.ts` 改成真算旋转包围盒（44×56 的卡扇开 = 65×72），槽按包围盒占位、三槽同高对齐 caption、间距 8px；参考列 `scrollWidth` 从 216 回到 200（不再溢出） |
| 场组头的 ▶「播放本场」在实验室里看不到 | 按钮在 `StoryboardShotTable.tsx:267` 靠 `onPlayGroup` 才渲染，实验室没传这个 prop → 形态从未被取景钉住（假绿） | `states/03-zone.tsx` 的 `TableStageWithPlan` 补传 `onPlayGroup`；`sb-zone-05/06/07/08` 四格现在都能看到这枚按钮 |

**顺带修掉的假证据路径**：`tests/ux/design-lab/walkScreen.mjs` 起 dev server 时只 `fetch` 探活，
撞端口时会连上**别的 worktree 的 vite** 并照常截 35 张、拼接触表（2026-09-06 实测：5199 被隔壁
worktree 占着，走查拿回来的是 Agent 面板的 45 个状态）。现在以子进程存活为前提，撞了当场炸，
并支持 `DESIGN_LAB_PORT` 覆盖端口。

**验证**：`tests/ux/shots/storyboard-v6-rework/`（1440 宽逐格实拍）+ 本日接触表原路径覆盖。

## 返工三轮（2026-09-06 用户看 1440 实时展示后打回，两条）

用户原话两条，都是**"看着乱/不齐"**，但根因是两处几何写在了错的层级：

| 用户说的 | 根因 | 修在哪 |
|---|---|---|
| 「参数框为啥那么多？我们画布上的图片节点本身参数没那么多。能不能变成**一行**、再简洁些，最右边就是「生成」。现在很乱。」 | 底栏摆了**九枚**控件：模型 / 供应商 / 模式 / 画幅 / 时长 / 清晰度 / 生成音频 / 返回尾帧 / 生成，每枚还带一个前缀小标签。而画布节点（`InlineParameterBar`）底栏只有**三枚**：模型芯片 + 变体 + 一枚摘要 pill，全部参数收在 pill 点开的面板里。上一轮没解决"太多"，只是把溢出从"截断重叠"换成了"整表换两行"——行高开始抖 | ① 摊开的只剩 select（**值**才有扫视价值），boolean 开关收进行尾 ⋯：`shotRow/composerBarModel.ts` 的 `composerBarPlan`；② 去掉每枚胶囊的前缀小标签（「模型 Seedance 2.5」→「Seedance 2.5」），语义进 `aria-label`/`title`，与画布摘要 pill 的读法一致；③ **换行整套删除**（P1）：`composerGridLayout.ts` / `useComposerGridPlan.ts` / `useComposerGridMetrics.ts` / `ComposerGridScope.tsx` 与其测试全删，底栏改成 `flex-nowrap`，窄了只让 `NomiSelect` 的值 `truncate`（前缀与 ▾ 是 `shrink-0`，`title` 挂全名）；④「生成」`ml-auto` 钉最右 |
| 「不同画幅的行一放进来整个框就不齐。前两列——产物列和参考列——不同比例时排版要齐；至少大家都同一个比例（比如从上到下都 16:9）时，单个分镜行要排得很好、对齐。」 | 两列都按**这一行/这一槽自己的内容**算尺寸：产物列 `frameMediaBox(该行画幅)`（9:16→76×135、16:9→136×77），参考列 `referenceSlotWidth/Height(该槽张数)`（0 张 56×56、3 张 65×73）。合同 §2.4 原话"列宽固定就够齐了"在混排下不成立——**人眼读的是盒子，不是列**。参考列还额外写了 `min-h-[135px] justify-center`，16:9 的行画面格只有 77 高、参考卡却仍落在 135 的中线上，两列从此错开 | ① 产物盒升到**表级**：`shotFrameGeometry.tableFrameMediaBox(aspects)`——全表同画幅 → 盒 = 该画幅的框（缩略图铺满、无黑边）；混排 → 全表一只 136×108 的盒（宽=列宽上限、高=短边上限，两个数都是合同已有的封顶），画面 `object-contain` letterbox 居中，不拉伸不裁切。`StoryboardShotTable` 算一次发给所有行，行不再自己算；② 参考槽改**固定盒** `REFERENCE_SLOT_BOX`（= 扇面全开的包围盒 65×73）：0 张 / 1 张 / 30 张 / 红虚框全同尺寸、同顶线，caption 落一条线；③ 参考列去掉 `min-h`/`justify-center`，与画面格共用顶线；④ 列宽从盒 derive：`REFERENCE_COLUMN_WIDTH = 65×3 + 8×2 = 211`，行网格 `STORYBOARD_ROW_GRID_TEMPLATE` 从 `FRAME_COLUMN_WIDTH` / `REFERENCE_COLUMN_WIDTH` 拼出来——合同里那个写死的 `200px` 是样张估值，盒一变就溢出，所以列宽改成结果而不是常数 |

**同步进合同**：§2.3（底栏形态：一行、不换行、只缩文字、生成钉右；开关的家是 ⋯）、§2.4（媒体盒升表级 + letterbox）、§4.1（参考列宽 derive、槽用固定盒）。

**单测**：`composerBarModel.test.ts` 增「select 摆出/boolean 收起」与 **P4 交叉断言**「与画布节点 composer 同一集合，差集只有画幅（另有 owner）」；`shotFrameGeometry.test.ts` 增表级盒五条（全同 / 等价写法 / 混排装得下 / 与行数无关 / 空表兜底）；`shotReferenceStackGeometry.test.ts` 改成固定盒 + 列宽 derive 的断言。

**新增实验室状态**：`sb-zone-12-uniform-16-9`、`sb-zone-13-uniform-9-16`（全表同一画幅五行），与既有 `sb-zone-05-scene-groups`（16:9 / 1:1 / 竖版混排）三格构成对齐规则的证据。三格 1440 宽实拍在 `tests/ux/shots/storyboard-v6-rework/`。

## 已确认的现场与边界

- 现役接触表为 37 个分镜状态（返工三新增两格全同画幅）；底栏使用 `flex-wrap`，参考旋转超出 56px 占位。修在共享布局边界，镜头与锚行都经过同一套参考列。
- 已有 `AssetPreviewDialog` 的 body portal 和顺播链，复用并补齐场作用域与未生成进度，不新增弹层机制。
- `check:design-lab` 在 macOS 包含像素基线比对，并要求新增状态有基线。**基线只在用户拍板后更新**——第一轮曾把 31 张 storyboard 基线逐文件同步掉（`git log --stat -- tests/ux/design-lab/__baselines__/storyboard`，commit `eedf73cf`），那一步越权了；返工二轮**一张基线都没动**，`check:design-lab` 因此会对被修正的格子报红，红即预期，拍板后再统一处理。
- 验收图输出到 `tests/ux/shots/storyboard-v6-rework/`（忽略目录）；接触表覆盖本日原路径。
