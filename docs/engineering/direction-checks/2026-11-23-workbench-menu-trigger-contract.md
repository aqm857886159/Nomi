# 方向检查：`WorkbenchMenu` 虚拟触发器脱离真实触发元素导致 14 天连修（2026-11-09 → 11-23）

> 独立复盘（未参与 `WorkbenchMenu` 或 PR `#1628` 任何一轮编码，仅基于公开提交 `5f4ee1fa6` 仓内代码、证据图与原话撰写）。行号未标提交号的均为 `5f4ee1fa6`。

**这一处的全图在哪**：表外（`docs/engineering/seams.json` 无菜单 / `WorkbenchMenu` 条目）。概念主人：`ui.anchored-popup-placement`（`docs/engineering/concept-owners/ui.anchored-popup-placement.json`，主人 `src/design/menu.tsx#WorkbenchMenu`，含 4 个文件：`menu.tsx`、`AnchoredPopover.tsx`、`anchoredPopoverPlacement.ts`、`ToolbarActionMenu.tsx`；只登记了「不压触发钮与所在排」的几何定位）。**触发元素与菜单之间的状态绑定（打开态高亮 `data-state="open"`、真实触发器焦点归还）及菜单项皮肤锁定，目前均无概念主人。** 自写登记未命中（`self-written.json` 无 `WorkbenchMenu` 条目）。

---

### 0. 一句话根因

`WorkbenchMenu`（`src/design/menu.tsx:374-382`）把 Radix 的 `<DropdownMenuPrimitive.Trigger>` 一律替成了一个挂在 `document.body` 里的 0×0 隐形假按钮，彻底切断了 Radix 原本由真实触发器一体承担的四项契约（锚点几何、键盘焦点归还、触发元素 `data-state="open"` 态、受控外观边界）；此后每撞出其中一项缺口，就往 `menu.tsx` 上叠一层手写补丁，而触发行高亮、焦点归还与样式覆写冲突不断回潮。

---

### 1. 归类表：bug → 直接原因 → 类

| 提交 / 现象 / 日期 | 创作者看到了什么 | 直接原因（file:line） | 类 |
|---|---|---|---|
| `997bdbd9f`（10-06，历史前置，`FB-20261006-qa2-menu-covers-toolbar`） | 节点贴画布上沿时点「改图 ▾」，菜单翻边后整块压住触发钮和整条浮条 | `menu.tsx` 早期只收 `point`（0×0 假触发器），按钮点开时把按钮边缘算成点传入，Radix 翻边绕 0×0 点翻回按钮上；后被迫补 `anchorRect` 复制按钮矩形 + `menu.structure.test.ts:28-33` | A 虚拟触发器脱离真实触发元素 |
| `6d413f39d`（11-22，14 天第 1 个 `fix`） | 键盘开菜单后按 Esc 或回车选一项，焦点掉到 `document.body`，要从头 Tab | Radix 默认 `onCloseAutoFocus` 把焦点还给 `triggerRef`（`node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs:115`），但 `menu.tsx:375` 的 Trigger 是 0×0 假按钮，只能 `preventDefault()`；后手写 40 行 `openerRef` + `keyboardCloseRef` + `:focus-visible` 状态机（`menu.tsx:354-422`） | A 虚拟触发器脱离真实触发元素 |
| `53750a05b`（11-23，PR `#1628` 内，14 天第 2 个 `fix`） | 迁入 `DocumentListSidebar` 后「删除方案」红字被盖成深灰 | `menu.tsx:38-44,154` 留了自由覆写口子 `itemClassName`，调用方传 `text-nomi-ink-80`（`DocumentListSidebar.tsx:260`）按 CSS 顺序压过 `DANGER_ITEM_CLASS`；后加 `data-danger` 把权重抬到 `(0,2,0)`（`menu.tsx:188,315`） | B 自由样式逃生口破坏组件契约 |
| `#issuecomment-7084017734`（11-23，拟第 3 个 `fix`，`compare-01-doc-list.{zh-CN,en}.jpg`） | 文稿列表右键非当前行（「未命名项目」）后，菜单开着时该行灰底高亮与行内图标一起消失，看不出菜单作用于哪一行；而 `compare-02`/`03` 仍亮 | **订正原猜测**：并非 Radix 关了页面 `pointer-events`（`menu.tsx:369` 已传 `modal={false}`）。实因是：① 迁前旧菜单是不抢焦点的裸 `<div>`，右键后该行仍靠 `focus-within:bg-nomi-ink-05` + `group-focus-within:opacity-100`（`DocumentListSidebar.tsx:286,336,345`）撑着灰底；② 迁后 Radix 开菜单把焦点移进 Portal 里的 `[role="menu"]`（`@radix-ui/react-menu` `contentRef.current?.focus()`），`:focus-within` 立刻失效，且菜单左上角紧贴指针 `(218,108)` 覆盖了 `:hover`；③ Radix 的 `data-state="open"`（`dropdown-menu/dist/index.mjs:72`）挂在 `body` 的 0×0 假按钮上，真实行拿不到。`compare-02`（`designActive=true`）与 `compare-03`（`active=true`，`NodeItem.tsx:63`）只是碰巧右键了**已选中行**；右键任意未选中节点/分类/子组/导演台轨道行（`CategoryItem.tsx:121`、`NodeItem.tsx:63`、`GroupItem.tsx:165`、`TrackList.tsx:103,250`）同样零高亮 | A 虚拟触发器脱离真实触发元素 |

近 14 天本文件及概念 4 文件共 4 个提交（`2b9a1fe4d`、`6d413f39d`、`def848125`、`53750a05b`），2 个 `fix` + 本次拟修共 3 处，其中 2 处直指 A 类（连同历史 `997bdbd9f` 共 3 次），1 处属 B 类。

---

### 2. 为什么这一类会一直出现

1. **一刀切用虚拟触发器抹平了三种不同触发形态**：当前全仓 17 处生产 `<WorkbenchMenu>` 调用点里，**9 处是普通按钮下拉**（`NomiOverflowRow`、`ShellTopBar`、`AgentPanelV4Panel`、`CreationDocumentSwitcher`、`StoryboardAnchorRow`、`GenerationListSectionHeader`、`TextNodeComposer`、`ToolbarActionMenu`、`LibraryCategoryNav`，全在手写 `getBoundingClientRect()` 传 `anchorRect`），**4 处是普通行/列右键**（`DocumentListSidebar`、`CategoryTree`、`DirectorTimeline` 行右键、`ShotTableNode`），只有 **3 处真正有复杂手势或无触发元素**（`NodeContextMenu` 的 `pointerup` 平移和弦、`NodeDeriveMenu` 连线落空、`workbench/timeline/TimelineContextMenu` 四目标命中；另 `DirectorTimeline.tsx:219-248` 的轨道「+」按钮误走 `point` 绕过了 `menu.structure.test.ts:30`）。为了照顾 3 处无触发元素的场景，剩下 14 处全部被迫放弃 Radix 真实 Trigger。
2. **「谁被右键了」的高亮契约散落在调用方、且默认借 `:hover` / `:focus-within` 蒙混过关**：旧手写菜单不管理焦点，恰好没把 `:focus-within` 拿走；一旦换成符合 WAI-ARIA 的 Radix 菜单（开菜单即移焦点入菜单），所有借 `:focus-within` 撑视觉的触发行瞬间暴露。
3. **外观逃生口（`className` / `itemClassName`）允许调用方覆盖组件内语义色**：导致语义态（`danger`、`disabled`、`highlighted`）必须与调用方任意 Tailwind 类打优先级仗。

#### 三条体验铁律对照

| 铁律 | 适用性与证据 |
|---|---|
| ⑩ 说的=摆的 | 不适用（非 Agent 意图抽取与草稿参数） |
| ⑪ 能选到 | 不适用（非模型档案参数清单） |
| ⑫ 点了=以为的 | **适用**：右键某一行，用户预期「菜单开着时能一眼看清作用在哪一行、键盘开关焦点不丢」。`tests/ux/full-walk/catalog.mjs` 目前仅覆盖 `tb-menu-near-top`（`:153`）与 `row-menu-open`（`:339`），缺少「非当前行右键打开菜单时触发行保持打开态高亮」的预期与观察。 |

---

### 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| 1. 即使这次在 `DocumentListSidebar`/`CategoryTree`/`TrackList` 手动补了「打开态高亮」，下一次迁入其余右键菜单（如 `NomiBrowserDialogView` 标签/收藏右键、`BrowserAssetPopoverView` 资源右键、`WhiteboardLeaferCanvas`）仍会忘记接目标行高亮或各自写一套颜色 | 在 `CategoryTree` 右键**未选中**的分类/节点/子组（`CategoryItem.tsx:121`、`NodeItem.tsx:63`、`GroupItem.tsx:165`）或在 `DirectorTimeline` 右键未选中轨道行（`TrackList.tsx:250`），实测当前 `5f4ee1fa6` 下均无任何打开态高亮 |
| 2. 按钮触发菜单通过中间适配层转传 `point={{ x: clientX, y: clientY }}` 会绕过 `menu.structure.test.ts:30` 的单文件静态检查，重演「压住触发钮」 | 实测 `DirectorTimeline.tsx:248` → `TimelineContextMenu.tsx:36`：点击轨道行「+」按钮（`TrackList.tsx:277`）实际传的是点击坐标 `point` 而非按钮 `anchorRect`，`menu.structure.test.ts` 全绿未报 |
| 3. 若继续保留 `itemClassName` 自由覆写，调用方传 `bg-*` / `hover:*` / `text-*` 会继续与 `data-[highlighted]`、`data-[disabled]`、`data-[danger]` 发生 Tailwind 声明顺序覆盖 | 传 `itemClassName="text-nomi-ink-60 bg-nomi-paper"` 给 `WorkbenchMenu`，检查禁用项灰字与悬停底色是否被盖掉 |

---

### 4. 靶子独立性检查

- **计数放大核实**：`scripts/fix-churn.mjs` 按 commit 标题前缀 `fix` 计次，`53750a05b` 是 PR `#1628` 合入前的自修提交，尚未进 `main`；但加上 `6d413f39d`（11-22）与 `997bdbd9f`（10-06），A 类根因（虚拟触发器脱离真实触发元素）在 6 周内真实命中 3 次，并非误报。
- **两把尺子都漏了「触发行状态」**：
  1) `docs/evidence/2026-11-23-t8-r1-context-menus/style-diff.json`（与生成它的脚本）只量了**菜单面板自身**的 rect / fontSize / padding / color，完全没量触发行（`[data-document-row]` / `[data-node-id]`）在菜单开着时的背景色与状态属性，所以机器报告全绿，靠协调人眼看 `compare-01` 才抓出回归；
  2) `src/design/contextMenusMigration.characterization.test.tsx`（1007 行）用自写 `FakeElement`（`:70-90`）跑在无 CSS 引擎、无真实浏览器焦点/悬停的 Node 环境里，既抓不出 `itemClassName` 压掉危险红（`53750a05b`），也抓不出焦点移入菜单后触发行丢 `:focus-within` 高亮（`compare-01`）。
- **修对了反而掉分的先例**：本次未发现；`menu.structure.test.ts` 只检查单文件 `point` + `getBoundingClientRect`，不构成误杀，但存在上述跨文件漏判。

---

### 5. 这一整块归谁（P0）

这一整块：菜单的触发器与弹层状态绑定（按钮下拉与右键菜单的锚点定位、焦点归还、触发元素 `data-state="open"` 打开态反映与语义外观契约）。
归谁：Radix UI Primitives `@radix-ui/react-dropdown-menu` `2.1.24`（`package.json:333`，https://www.radix-ui.com/primitives/docs/components/dropdown-menu ）与 `@radix-ui/react-context-menu`（https://www.radix-ui.com/primitives/docs/components/context-menu ），经全站唯一菜单壳 `src/design/menu.tsx:333` 对外暴露 Nomi 皮肤与统一触发态契约。
我们哪里绕开了它：`src/design/menu.tsx:374-382` 对全部 17 处调用点一律用 `createPortal` 渲染一个 0×0 隐形 `<DropdownMenuPrimitive.Trigger tabIndex={-1} />` 顶替真实触发元素，导致 Radix 原生 `data-state="open"`（`node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs:72`）与原生焦点归还（`index.mjs:115`）全部落在看不见的假节点上，继而被迫在 `menu.tsx:354-422` 手写 40 行 `openerRef` 焦点状态机、在调用方各自手量 `anchorRect` 并用 `:hover`/`:focus-within` 冒充菜单打开态；同时 `menu.tsx:152-159` 允许调用方用 `itemClassName` 覆盖项内文字色，绕开了组件自身的 `danger`/`disabled` 状态样式。

---

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价（含老用户） | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 保留 `menu.tsx:375` 0×0 假触发器；在 `menu.tsx` 加一个可选 prop（如 `triggerElement` 改写其 `data-state`）或导出共享类名常量，再给 `DocumentListSidebar` / `CategoryTree` / `TrackList` 各自把 `menuOpen` 传进每一行补灰底高亮。**顺答协调关于 `ContextMenu` 的问题**：保留 `DropdownMenu + 坐标锚点` 并在 PR 正文写明理由（未装 `@radix-ui/react-context-menu`、且画布/剪辑时间轴 3 处有领域手势约束）。 | 最小（1 个小提交、不改 `package.json`、不碰老用户数据）。创作者体感：本次 3 处非当前行右键高亮立即可用且一致。 | **会**。① 下一批迁入的右键菜单（浏览器标签/收藏/素材、白板）若忘了传 `triggerElement`/高亮标记仍会丢高亮；② 按钮点开菜单仍需每处手写 `getBoundingClientRect()` + `anchorRect`（已漏掉 `DirectorTimeline` 的 `+` 钮）；③ `menu.tsx:354-422` 的 40 行手写焦点归还机与 `itemClassName` 覆写口仍在。 | 补丁越叠越多，下一次再碰 `menu.tsx` 仍会撞热点 | 否（仅在严禁动 `package.json` 且只收口 PR `#1628` 时作过渡） |
| 换一种做法 | **把 `src/design/menu.tsx` 收成全站唯一菜单家里的两条标准入口（共用同一份 `renderNodes` 与菜单皮肤，不另起炉灶）**：① **真实触发器入口**——普通行右键接入标准 `@radix-ui/react-context-menu`（`ContextMenu.Trigger asChild` 包住行，`modal={false}`），按钮下拉支持真实 `DropdownMenu.Trigger asChild`，由 Radix 原生把 `data-state="open"` 直接写到真实触发行/按钮上，并由 `menu.tsx` 导出唯一触发态高亮样式（如 `WORKBENCH_MENU_TRIGGER_OPEN_CLASS = 'data-[state=open]:bg-nomi-ink-05'`，调用方只用这一处，不再靠 `:hover`/`:focus-within`）；② **受控点位入口（`point`）** 明确只留给 3 处真正无单一触发元素或带 `pointerup` 和弦的菜单（`NodeContextMenu`、`NodeDeriveMenu`、`workbench/timeline/TimelineContextMenu`），顺手把 `DirectorTimeline` 的 `+` 按钮从 `point` 改回真实触发器/矩形锚点，并把 `itemClassName` 自由文本色覆写收敛为有限预设（密度/宽度档）。分两小步实施：先在 `#1628` 用 `menu.tsx` 唯一触发态契约收口本次 3 处右键行（如装 `@radix-ui/react-context-menu` 需注意在 Apple Silicon 宿主机上改 `package.json` 会触发 x86_64 `makensis` 预检，可安排在 CI 或单独小 PR 落地），再分批把 9 处按钮菜单迁向真实 Trigger 并删掉 `openerRef` 焦点补丁。 | 中。需装 `@radix-ui/react-context-menu`（约 1 个轻量 Radix 包，共享已装 `@radix-ui/react-menu` 内核，几乎零新增体积）并调整 3 处右键行包壳（不改 DOM 视觉布局；`CategoryTree` / `DocumentListSidebar` 每行只在打开时惰性拼 `items`）。老用户无持久化数据迁移，外观仅统一「右键任意未选中行时保持灰底高亮」。 | **普通右键行与按钮菜单这一类不会再出现**：Radix 原生写 `data-state="open"` + 原生锚点几何 + 原生焦点归还，写不出脱离真实触发元素的菜单。仅 3 处受控点位菜单（画布/剪辑时间轴/连线落空）保留虚锚点，其触发态高亮须显式声明。 | 需验证列表行数大（如 200 节点 `CategoryTree`）时每行挂 `ContextMenu.Root` 的渲染耗时（走现有 perf 场景校验）；且修改 `package.json` 需规避本机无 Rosetta 2 的 `makensis` 钩子 | **是** |
| 删掉 | 最小可删单位：删掉 `menu.tsx` 里的 `itemClassName` 自由覆写（`menu.tsx:154`）及 `DocumentListSidebar.tsx:286` 靠 `:focus-within` 冒充菜单打开态的脆弱依赖，把菜单外观收成唯一默认套，不再允许调用方传文字色/背景色类。 | 小。会触发既有 `docs/plan/2026-09-08-menu-primitive-inventory.md` §4.3 拍板差异（时间轴/侧栏/画布三种字号与圆角是否统一，需用户重新拍板）。老用户无数据影响，但 3 处右键菜单视觉字号与圆角会微调到画布默认套。 | 仅消灭 B 类（样式覆盖危险红），**不解决 A 类**（0×0 假触发器仍导致打开态高亮与焦点归还脱离触发元素）。 | 违背 `#1628`「只换实现、视觉零漂移」边界，且主因 A 仍在 | 否 |

**关于协调所问「为何用 `DropdownMenu + 坐标锚点` 而非 `ContextMenu`」的客观回答**：
- `src/design/menu.tsx` 确实已是全站唯一的菜单家（17 处生产调用点全收在里面），但目前**并未接入 `@radix-ui/react-context-menu`**（`package.json` 未装），而是把所有右键菜单和按钮菜单**强行塞进了同一套 `DropdownMenu + body 0×0 虚拟触发器`**。
- 当初不装 `ContextMenu` 的理由（`menu.tsx:18-30`）只对 **3 处特殊手势/无触发元素菜单**（画布 `pointerup` 平移和弦、连线落空、剪辑时间轴四目标命中）成立；对 `DocumentListSidebar`、`CategoryTree`、`DirectorTimeline` 行右键这类**普通 DOM 行右键**并不成立——把它们也硬塞进 0×0 虚拟触发器，正是导致 Radix 原生 `data-state="open"` 拿不到、焦点归还拿不到、不得不反复手写补丁的直接结构原因。

---

### 7. 用户要权衡的核心

要不要给全站唯一菜单家 `src/design/menu.tsx` 补上 Radix 真实触发器能力（引入 `@radix-ui/react-context-menu` 给普通右键行 + 开放 `DropdownMenu` 真实 Trigger 给按钮菜单，只把 0×0 虚拟点位留给画布/时间轴等 3 处特殊手势），一次根治「打开态高亮丢失 / 焦点归还手写状态机 / 按钮误传点位」三类反复修补；还是接受继续留在 `DropdownMenu + 虚锚点` 上，每次迁移新右键菜单时人工补传目标行高亮状态？

---

## 特征测试清单（动结构前先锁住）

- **已钉住**：
  - `src/design/menuFocusReturn.browser.test.ts`（17 条真浏览器 Playwright 测试：键盘开+Esc/回车归还焦点、鼠标开不抢回、选项自管焦点不抢回、触发钮卸载不报错）；
  - `src/design/menu.structure.test.ts`（2 条静态普查：单文件内给 `point` 不得同时 `getBoundingClientRect()`）；
  - `src/design/contextMenusMigration.characterization.test.tsx`（3 处右键菜单的菜单项构建、危险项 `data-danger`、禁用 `title`、Esc 层级与动作回调；注意其为 `FakeElement` 假 DOM，不测真实 CSS 计算色与焦点转移）；
  - `tests/ux/design-lab-primitives-menu.walk.mjs`、`tests/ux/timeline-context-menu.walk.mjs`、`tests/ux/canvas-node-context-menu.walk.mjs`（菜单本体呈现与点击闭环）。
- **尚未钉住（本次修补 / 换结构前必先补红再转绿）**：
  1. **真浏览器/真实样式下的触发行打开态高亮**：在 `DocumentListSidebar`（右键**非当前**文稿行）、`CategoryTree`（右键**未选中**分类/节点/子组行）、`DirectorTimeline`（右键**未选中**轨道行）三处，断言菜单开着时触发行带 `data-state="open"` 且计算背景色非透明、关菜单后恢复原态；
  2. **跨文件按钮误传 `point` 守卫**：覆盖 `DirectorTimeline.tsx:248` 这类经包装组件给按钮菜单传点击坐标的路径（不压住触发按钮）；
  3. **真实 CSS 级联下危险项 / 禁用项保色**：在真浏览器（如 `menuFocusReturn.browser.test.ts` 同套 Playwright 环境）验证 `itemClassName` 传常规文字色时 `danger` 项仍为危险红、`disabled` 项仍为禁用灰。


---

## 与原方案对照（写完上面独立复盘后，再与实现线原拟 `targetElement` 补丁对照）

- **原拟补丁做了什么**：实现线按 `#issuecomment-7084017734` 在 `src/design/menu.tsx` 新增可选 `targetElement?: HTMLElement | null`，用 `useLayoutEffect([open, targetElement])` 手动给目标行写 `data-state="open"` 并在无激活底色时 `classList.add('bg-nomi-ink-05')`、关闭时移除（已在隔离工作树实测通过并重拍 `compare-01`，提交时被 `commit-msg` `fix-churn` 合法拦下，遂按 P1 停手启动本独立复盘）。
- **一致处**：两边都确认 `compare-01` 灰底消失的真实根因不是 `pointer-events: none`（`modal={false}`），而是旧菜单不抢焦点保留了行的 `:focus-within`，迁入 Radix Portal 后焦点移入 `[role="menu"]` 且菜单盖住指针导致 `:focus-within` 与 `:hover` 同时失效；两边都确认规则只能住在 `src/design/menu.tsx` 唯一主人里，不能在调用方各写一份。
- **核心分歧（为什么 `fix-churn` 这次拦得准）**：
  1. 原拟 `targetElement` 补丁本质上仍是「沿原方向修」——继 `997bdbd9f`（手传 `anchorRect` 替 Radix 量按钮）和 `6d413f39d`（手写 40 行 `openerRef` 替 Radix 还焦点）之后，**第三次围绕 `document.body` 里的 `0×0` 隐形假 `Trigger` 手写复刻 Radix `Trigger` 本就自带的 `data-state="open"` 能力**。
  2. 独立复盘额外抓出了原拟补丁未覆盖的同源漏洞：`DirectorTimeline.tsx:248` 的轨道「+」按钮经包装组件传点击坐标 `point`，绕过了 `menu.structure.test.ts` 单文件守卫；且 `style-diff.json` 与 `FakeElement` 单测均未测量真实浏览器下触发行的计算样式。
  3. *注*：独立复盘第 6 节提到的「本机改 `package.json` 触发 `makensis`」已在 `#1626`（`6881dc673`）解决，因此在本机接入 `@radix-ui/react-context-menu` 已无工程阻碍。
- **主管综合判断**：支持独立复盘的推荐项——**选「换一种做法」**：不往 `0×0` 假触发器上叠第 3 层 `useLayoutEffect` 补丁，而是在全站唯一菜单家 `src/design/menu.tsx` 内直接接入 `@radix-ui/react-context-menu`（`ContextMenu.Trigger asChild`）并开放 `DropdownMenu.Trigger asChild`（共用同一份 `renderNodes` 与菜单皮肤），让 Radix 原生把 `data-state="open"`、几何锚点与焦点归还挂在真实触发元素上，把 `point` 虚锚点严格收敛给画布/剪辑时间轴/连线落空那 3 处无单一触发元素的特殊手势。

---

## 落地记录（2026-11-23 · PR `#1628`）

1. **统一菜单家两条入口**：钉死 `@radix-ui/react-context-menu@2.3.7`（`pnpm why @radix-ui/react-menu` 核实与 `@radix-ui/react-dropdown-menu@2.1.24` 共用全仓唯一 `@radix-ui/react-menu@2.1.24` 内核）；`src/design/menu.tsx` 抽出原语字典共用一份 `renderNodes`、改用 `--radix-popper-available-height`、导出唯一 `WORKBENCH_MENU_TRIGGER_OPEN_CLASS = 'data-[state=open]:bg-nomi-ink-05'`，新增真触发器行右键 `WorkbenchContextMenu`（惰性 `items` 工厂）与按钮下拉 `WorkbenchMenu trigger`。
2. **迁完本次三处右键行 + 导演台「+」按钮并删旧包装**：`DocumentListSidebar.tsx`、`CategoryTree.tsx`（含 `CategoryItem`/`NodeItem`/`GroupItem`）、`DirectorTimeline.tsx` + `TrackList.tsx` + `TrackLanes.tsx` + `ClipBar.tsx` 全部改挂真触发器，同提交删除 `src/workbench/generationCanvas/nodes/director/timeline/TimelineContextMenu.tsx` 的 `point=` 适配壳。
3. **真机重拍 `compare-04` 时顺手抓出并根治页内全屏层捕获穿透**：从画布 `DirectorNode` 打开 `DirectorEditor`（经 `GenerationPageLayer` `createPortal` 挂到画布舞台外侧同级容器）后，右键时间轴轨道行在 `origin/main` 上一直被底下画布舞台的 React 捕获期（沿 Fiber 树穿透 Portal）抢去 `setPointerCapture` 平移并误弹画布空白菜单；已在 `useGenerationCanvasReactFlowPointer.ts` 与 `useCanvasContextNodeMenu.ts` 入口收口「只认 `stage.contains(event.target)` 的舞台内 DOM 事件」。
4. **结构与真浏览器双重门岗**：`src/design/menu.structure.test.ts` 锁死生产代码传 `point` 白名单（3 处永久手势 + 1 处存量冻结 `ShotTableNode.tsx`）与跨文件 `onClick` 转传点击事件禁令；`src/design/menuTriggerAndCascade.browser.test.ts`（14 条真 Chromium + 编译后 `public/tailwind.generated.css` 测试）锁死未选中行打开态高亮、已选中行保底色、导演台「+」不压按钮、语义色级联优先级及 `GenerationPageLayer` Portal 右键隔离。
