# 方向检查：项目库工具栏空维度筛选与卡片动作压封面

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

触发：`node scripts/fix-churn.mjs src/workbench/library/ProjectLibraryPage.tsx` 命中目录口径（`src/workbench/library/` 近 14 天已有 2 个 fix 提交、仅涉 2 个文件，本次准备落项目库交互改动计为第 3 个；`ProjectLibraryPage.tsx` 文件本身近 14 天 fix 数为 0）。`src/workbench/library/` 位于 `docs/engineering/self-written.json:652` 的 `domainRoots`，不涉及通用区自写登记条目。

**这一处的全图在哪**：表外（`docs/engineering/seams.json` 无 `src/workbench/library/` 条目；设计契约见 `docs/design/nomi-design-system.md:161-244` 与 `docs/design/boards/2026-10-08/Library.board.json`）。

### 0. 一句话根因

项目库页没有把「工具栏维度显隐」绑定到数据集真实维度，也没有把「项目卡管理动作」收口到标题行共享菜单契约，导致单来源库仍常驻死角筛选，且破坏性删除被压在封面缩略图右上角、与标题行安全操作分裂。

### 1. 归类表：bug → 直接原因 → 类

先如实说明目录热点的噪声成分：近 14 天命中 `src/workbench/library/` 的 2 个 fix 提交均未改动 `ProjectLibraryPage.tsx`，属全仓治理顺带触及同目录其它文件；真正构成同类的证据在 `ProjectLibraryPage.tsx` 现状与兄弟库对比中。

| 提交 / 现象 | 直接原因 | 类 |
|---|---|---|
| `e1c2dfd35`（11-22，`LibraryPicker.tsx`） | 全仓悬停提示与悬停卡分家，顺带迁移拾取器预览 | 无关（目录口径噪声） |
| `e3884abe8`（11-21，`WorkflowLibraryContent.tsx`） | 全仓素材入项目材料化收口，顺带迁移工作流模板 | 无关（目录口径噪声） |
| 无外部文件夹时工具栏仍常驻 `全部 N \| 本地 N \| 文件夹 0`（`ProjectLibraryPage.tsx:335-357`） | 仅按 `!firstRun` 渲染静态三段胶囊，未校验 `projects` 是否包含多来源；且计数取自搜索后 `searchedProjects`（`:187-194`），切到 `文件夹 0` 后无清除筛选出路（`:498-514`） | 静态照搬样张控件，缺少数据驱动显隐与状态复位边界 |
| 悬停项目卡时封面右上角（`top-[9px] right-[9px]`）浮出红底垃圾桶，而改名与打开文件夹在标题行（`ProjectLibraryPage.tsx:560-576, 607-698`） | 历史实现把删除塞进封面遮罩层（仅 `group-hover`、缺键盘聚焦露出、`9px` 脱 4px 栅格），未接入 `WorkbenchMenu` / `WorkbenchContextMenu`，也未像兄弟库 `PromptCard.tsx:26,77-98` 那样保持封面纯净 | 卡片动作跨层分裂 + 破坏性操作压内容区 |

### 2. 为什么这一类会一直出现

`ProjectLibraryPage.tsx` 早于 10-24 兄弟库排版重构（`PromptCard.tsx` 已落「封面上不压任何字和动作，编辑 / 删除在标题行悬停或聚焦露出」）与 11-23 `WorkbenchMenu` 真触发器契约（`src/design/menu.tsx`）。项目库页一直沿用旧组件内联拼装：

1. **工具栏无维度守卫**：10-08 静态样张（`docs/design/boards/2026-10-08/preview/Library.html:95-99`）演示的是「2 本地 + 1 外部文件夹」的多来源库，组件把三段写死，没有「单来源即隐去、外部文件夹清空时自动复位 `sourceFilter='all'`」的不变量，违背 §1.5.2 第 5 条（删掉它创作者不会做错的，就删）。
2. **卡片动作无唯一落点**：点击封面是「打开项目」主路径，却在封面右上角叠了一颗破坏性删除钮，同时违背 §1.5.3「动作不许压在内容上」与可误触隔离原则；而「打开项目文件夹」挂在标题行右侧（`:677-697`）、「改名」藏在标题双击（`:637-644`），同一对象的管理动作散落三处。

#### 三条体验铁律

| 铁律 | 类根因要回答的问题 | 最小证据 |
|---|---|---|
| ⑫ 点了=以为的 | ① 从未挂载外部文件夹时，用户看到 `文件夹 0` 点下去只得空态、无一键退回；② 用户悬停 / 点击项目封面准备打开项目，封面右上角却弹出红色删除钮，与标题行安全操作割裂，且键盘聚焦封面无法触达该按钮。 | `ProjectLibraryPage.tsx:335-357,498-514,553-576,677-697`；`tests/ux/full-walk/catalog.mjs:408` 记明 P03（项目重命名 / 删除）尚无剧本，待补断言与 `userExpectation` / `actualObservation` 对照。 |
| ⑩ 说的=摆的 / ⑪ 能选到 | 不适用：不涉及 Agent 意图抽取或模型档案参数清单。 | — |

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 若只按 `sourceCounts.folder > 0` 隐藏筛选条，当用户已有外部文件夹但搜索词只命中本地项目时，筛选条会在输入中突然消失；且删除最后一个外部文件夹后若当前停留在 `folder` 档，页面会锁死在空态 | 单测渲染 `ProjectLibraryPage`：① 含 1 本地 + 1 外部项目时输入仅匹配本地的搜索词，断言筛选条仍在；② 处于 `sourceFilter='folder'` 时移除该外部项目，断言自动回到 `all` 并显示本地项目 |
| 项目卡后续新增「复制 / 导出 / 显式改名」动作时，因封面遮罩与标题行并存两个动作位，还会继续往封面四角或标题行堆散装按钮 | 检查 `ProjectLibraryPage.tsx` 封面容器内 `<button>` 数与 `WorkbenchMenu` 唯一菜单工厂；断言封面内无破坏性或管理按钮 |
| 仅靠 `group-hover:opacity-100` 显示的封面删除钮在纯键盘 Tab 导航下永远不可见 | 用键盘聚焦卡片及子按钮，检查删除入口在 `focus-within` / 菜单打开态下的可见性 |

### 4. 靶子独立性检查

- **热点尺子偏噪**：`fix-churn.mjs` 按目录计 2 个旧 fix（`e1c2dfd35`、`e3884abe8`）均不涉 `ProjectLibraryPage.tsx`，不能把目录计数直接当成本页高频回归证据；真正问题来自页面现状与设计系统契约的直接对照。
- **既有靶子锁住了旧摆放**：`docs/design/boards/2026-10-08/Library.board.json:331-348`（`library.card.delete`）注明 10-08 样张原本未画删除钮，是 10-23 回收站改动时按 `change: "keep"` 补录旧位置；`tests/ux/shell-redesign.walk.mjs:177-180`、`tests/ux/project-location-owner.walk.mjs:243-244`、`tests/system/walks-never-trash-projects.test.mjs:103` 均按「悬停卡片直接点 `library.deleteNamedProject` 按钮」断言。若把删除收进标题行 `⋯` 菜单，必须同步更新板清单与这三处走查靶子，否则「修对却红测试」。

### 5. 这一整块归谁（P0）

这一整块：项目库页的数据驱动工具栏筛选与项目卡对象级管理动作承载。
归谁：对象动作菜单与右键菜单归 `src/design/menu.tsx:669` 的 `WorkbenchMenu` / `WorkbenchContextMenu`（底层为 Radix `@radix-ui/react-dropdown-menu` ^2.1.24 与 `@radix-ui/react-context-menu` 2.3.7，见 https://www.radix-ui.com/primitives/docs/components/dropdown-menu ）；分段筛选控件归 `src/design/NomiSegmented.tsx:48`；卡片与工具栏层级规矩归 `docs/design/nomi-design-system.md:231`（§1.5.3 动作不许压在内容上）与 `docs/design/nomi-design-system.md:436`（§1.8.1）；项目库页唯一宿主归 `src/workbench/library/ProjectLibraryPage.tsx:129`。
我们哪里绕开了它：`src/workbench/library/ProjectLibraryPage.tsx:335` 绕开数据集维度判断常驻渲染三段手写筛选胶囊（计数取自 `:187` 搜索后子集且未复用 `NomiSegmented`）；`src/workbench/library/ProjectLibraryPage.tsx:560` 把破坏性删除按钮手写压在封面遮罩 `top-[9px] right-[9px]`（仅 hover 露出），绕开 §1.5.3 与 `src/design/menu.tsx:669`，导致管理动作与 `:677` 标题行打开文件夹钮、`:637` 双击改名分裂。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 仅在 `:335` 加 `sourceCounts.folder > 0` 隐藏筛选条，把封面垃圾桶改淡或挪位置并补 `focus-within` | 改动最小，既有走查零改动 | 会：搜索时筛选条闪隐、`folder` 档清空后卡死空态；封面仍压破坏性动作，后续卡片管理动作仍无统一的家 | 持续违背 §1.5.3，且引入搜索闪跳新 bug | |
| 换一种做法 | 由 `ProjectLibraryPage` 实现线在本轮按两项收口：① **筛选由原始列表驱动**：按 `hasFolderProjects = projects.some(p => p.source === 'folder')` 决定显隐（单来源不渲染；`!hasFolderProjects` 自动复位 `sourceFilter='all'`），并改接 `NomiSegmented`（`src/design/NomiSegmented.tsx:48`，`fit="content"`）；② **封面彻底清零管理动作，管理动作归标题行唯一入口**：同提交删掉封面右上角红底垃圾桶，接入 `WorkbenchMenu`（`trigger`）+ `WorkbenchContextMenu`（`src/design/menu.tsx:669`，Radix DropdownMenu ^2.1.24 / ContextMenu 2.3.7），由同一份 `items` 工厂承载「重命名 / 打开项目文件夹 / 分隔线 / 危险项删除（或移除）」，标题双击留作加速器；同步更新 `Library.board.json` 与 3 处走查断言 | 中等：改 1 个主组件、补单测、同步板清单与 3 处走查选择器；若严格照 §1.8.1（≤3 动作直排图标）也可取子方案 2B（把垃圾桶迁到标题行与打开文件夹并排，不加 `⋯`） | 工具栏单来源死角和「动作压封面」两类问题结构消失；唯一余面是其它旧卡片（如素材库卡）需后续另查 | ① 收进 `⋯` 使删除与打开文件夹多 1 次点击，与 §1.8.1「≤3 个直接摆图标」存在张力（但删除属 L4 破坏性操作，且显式补齐「重命名」后共 3 项，放菜单可兼顾防误触与右键一致性）；② 需同步翻 3 处既有测试选择器 | **推荐（2A 统一菜单为主推，2B 标题行直排图标为备选）** |
| 删掉 | 最小删减单位：删掉「无外部文件夹时的筛选胶囊渲染」与「封面右上角删除按钮（`ProjectLibraryPage.tsx:560-576`）」。保住用户结果：多来源库挂载外部文件夹后筛选自动恢复，老用户仍可在标题行入口删除 / 移除项目（含找不到文件夹的灰卡） | 不能单独删掉删除入口，必须同提交由标题行入口承接 | 删除压封面路径彻底消失；单来源死角消失 | 若误删多来源筛选会损害外部文件夹用户 | 并入推荐项 |

P1 例外口径说明：本次 `fix-churn` 仅命中目录口径、`ProjectLibraryPage.tsx` 文件本身近 14 天 fix 数为 0，且推荐路线是换与删（不新增特例分支）。但 **2A（收进 `⋯` + 右键菜单）** 改变了 `Library.board.json` 已登记的 `library.card.delete` 交互（删除多 1 次点击，并触及 §1.8.1「≤3 动作直排」与 §1.5.1 L4 破坏性收纳的取舍）；若走 **2B（仅把删除钮从封面迁到标题行并排 + 单来源隐筛选）** 则不增点击、不改菜单形态。建议在 2A / 2B 之间明确拍板后再落实现。

### 7. 用户要权衡的核心

项目卡删掉封面右上角红垃圾桶和无外部文件夹时的空筛选条没有争议，唯一要权衡的是：把项目卡的「改名 / 打开文件夹 / 删除」统一收进标题行 `⋯` 菜单 + 卡片右键菜单（防误触、改名可见、多 1 次点击、需同步改板与走查），还是留在标题行做悬停直排图标（0 额外点击、贴合 §1.8.1，但删除仍是一点即弹确认且无右键菜单）。

## 特征测试清单（动结构前先锁住）

- 已有现状测试：
  - `src/workbench/library/ProjectLibraryPage.folderMissing.test.tsx`（钉住找不到文件夹 / 清单损坏 / 正常三类卡片的标题行提示与打开文件夹按钮显隐）。
  - `tests/ux/library-delete-copy.test.mjs`（钉住 `Library.board.json` 与词典、删除流程的中英文案一致性）。
  - `tests/ux/shell-redesign.walk.mjs`（#47 / #48）、`tests/ux/project-location-owner.walk.mjs`（行 243-244）、`tests/system/walks-never-trash-projects.test.mjs`（行 103）钉住现有悬停删除按钮与打开文件夹按钮的交互入口。
- 尚缺的特征测试（动结构前应先补在 `ProjectLibraryPage` 单测中）：
  1. `projects` 全部为本地项目时，当前仍渲染 `aria-label="library.sourceFilter"` 且含 `folder` 项（改后翻转：单来源不渲染；有多来源时搜索仅命中本地仍保留；外部文件夹清空后自动复位 `all`）。
  2. 封面遮罩层内当前含删除 `<button>`（改后翻转：封面容器内 0 个管理 / 删除按钮，标题行菜单或图标在 hover 与键盘聚焦下均可达）。
