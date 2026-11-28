# 7 大替换第⑤刀：`outsidePress.ts` 迁 `@floating-ui/react` 并同提交删旧

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：7 大替换第⑤刀（`@floating-ui/react` `useFloating` + `useDismiss` 替换 `src/design/outsidePress.ts`）  
实现线：`t8-r5-impl`  
验收线：`t8-r5-verify`  
类别：`[长跑][新界面][其他]`（路径触及 `TaskCenterPanel.tsx` / `src/design/`，用户可见外观与布局零改动 `internal-no-visible-change`）

## ★0 先查别人

- `https://floating-ui.com/docs/useDismiss` · `@floating-ui/react` 的 `useDismiss` 默认以 `outsidePressEvent: 'pointerdown'` 且 `capture.outsidePress: true` 在 `document` 捕获阶段监听按下，并在事件目标上瞬时结算以配合 `getFloatingProps()` 的 `onPointerDownCapture` 识别 React 合成树内的 Portal 子节点、自动跳过滚动条拖拉 · **确认了**将手写 `listenOutsidePress` 整体替换为 `@floating-ui/react@0.27.20`（与现有 `@mantine/core@8.3.18` 及 `@floating-ui/dom@1.8.0` 同版本同内核），在零新增传递包的前提下覆盖全部 9 个消费者。
- `https://www.radix-ui.com/primitives/docs/components/popover#content` · Radix `DismissableLayer` 绑定在 Radix 自身原语内部，不向自管开合的非模态抽屉（`ShellRail`）、常驻浮卡（`TaskCenterPanel`）或画布框菜单暴露独立 hook · **确认了**动作菜单继续归 `src/design/menu.tsx`（Radix），富内容浮层与自管面板统一走 `src/design/overlayLayers.ts` 的 `useFloatingOutsideDismiss`（`@floating-ui/react`）。
- `https://mantine.dev/hooks/use-click-outside/` 与 `docs/fixes/2026-10-23-outside-press-capture.root-cause.json:1` · Mantine `useClickOutside` 监听冒泡 `mousedown` + `touchstart`，会被画布平移面 `d3-zoom` 的 `mousedown` `stopImmediatePropagation` 吞掉导致浮层点画布不收 · **改了** `src/design/outsidePress.structure.test.ts:1`：在锁死 `src/design/outsidePress.ts` 已删除与 `src/design/` 零手写按下监听的同时，继续拦住全仓 `mousedown` / `touchstart` 全局监听与 `useClickOutside`。
- 出口：`src/design/AnchoredPopover.tsx:175` · 浮层收起保持「点外面（`useDismiss` 捕获 `pointerdown`）+ `Escape`（各层既有层级仲裁）+ 显式关闭按钮」三条退出通道，且调用方忙时拒关后用户按 `Escape` 或点选浮层内按钮仍可正常关闭并归还焦点（`tests/ux/anchored-popover-focus.test.mjs:29`） · **确认了**本次纯内部实现替换不新增、不扩大任何挡人保护。

## ★1 用户怎么用

- **用户故事**：当创作者在生成画布、创作工作台、剪辑时间轴或内置素材浏览器中打开锚点浮层、任务中心、顶栏布局菜单、左栏抽屉或右键小菜单后，点击浮层外的画布空白处（含 `d3-zoom` 平移面）或卡片时，浮层立即收起且不把悬停提示塞回触发钮；点击浮层内部、触发钮自身或更高层弹出的下拉菜单时，不会误关或发生「按下先关、松手又重开」的二次翻转。
- **真实操作流（6 步）**：
  1. 进入项目生成画布，点开顶栏「任务中心」浮卡；
  2. 点击画布中央平移面空白处，任务中心立即收起；
  3. 点开左栏「文稿 / 素材」抽屉，在抽屉内展开操作菜单不误关抽屉，点击画布空白处抽屉收起；
  4. 切到剪辑预览工作区，点开顶栏「布局」菜单，连续切换多个面板多选框菜单保持打开；
  5. 再次点击「布局」触发钮或点击下方时间轴/画布空白处，菜单干净收起；
  6. 打开画布左下控制浮层（`AnchoredPopover`），点击画布空白处收起且触发钮不残留 Tooltip，按 `Escape` 收起则焦点回到触发钮。
- **不做什么 + 已知坑**：不改任何浮层的视觉样式、尺寸、定位算式（`resolveAnchoredPopoverPlacement` + `@floating-ui/dom` `autoUpdate` 保持像素级一致）；不把各浮层专属的 `Escape` 层级仲裁混进 `useDismiss`（固定 `escapeKey: false`，避免破坏 `hasOpenDialogAbove` / `hasOpenPopupAbove` 与 `ShellRail` 预览灯箱让路）。
- **真实任务与指标量具**：
  1. 画布任务中心与锚点浮层点击画布平移面收起：目标「画布手势面不吞外点」→ 信号「外点一次即收起且无残留 Tooltip」→ 指标「真浏览器特征集 + 焦点归还集通过率 100%」，量具：`src/design/floatingDismiss.characterization.test.tsx`、`tests/ux/anchored-popover-focus.test.mjs`。
  2. 顶栏布局菜单与素材筛选按钮开合：目标「触发钮自管切换不二次翻转」→ 信号「开着时点触发钮 `aria-expanded` 变为 `false`」→ 指标「触发钮切换成功率 100%」，量具：`src/design/floatingDismiss.characterization.test.tsx`。
  3. 关闭态零常驻监听护栏：目标「常驻挂载但未打开的面板零全局按下监听」→ 信号「`opened=false` 时 `document` 新增按下监听数为 0」→ 指标「空闲监听增量 = 0；全局监听登记表 `35 → 34`」，量具：`src/design/floatingDismiss.characterization.test.tsx`、`src/workbench/modalInputLayerCensus.test.ts`。
- **★1b 连带界面**：无新增或变更的文案、通知、Agent 回执、任务状态或错误卡（`internal-no-visible-change`）。
- **★1c 老用户**：不适用：纯前端瞬时交互监听替换，不读写任何项目文件、本地存储、模型配置或用户快捷键习惯；升级或回退上一版均零迁移、即开即用。

## ★2 谁说了算

- **唯一概念与主人**：`ui.outside-press-dismiss`（`docs/engineering/concept-owners/ui.outside-press-dismiss.json`）→ 唯一写口 `src/design/overlayLayers.ts::useFloatingOutsideDismiss`（底层委托 `@floating-ui/react` 的 `useFloating` + `useDismiss` + `useInteractions`）。
- **门表对账（`node scripts/door-map.mjs src/design/outsidePress.ts`）**：扫描 `3,176` 个文件，原 `src/design/outsidePress.ts` 共有 **9 个生产消费者文件、12 处调用**：
  1. `src/design/AnchoredPopover.tsx`（1 处）
  2. `src/ui/app-shell/shell/ShellRail.tsx`（1 处）
  3. `src/ui/browser/dialog/NomiBrowserDialog.tsx`（2 处：`tabContextMenu`、`bookmarkContextMenu`）
  4. `src/ui/browser/popover/NomiBrowserAssetPopover.tsx`（3 处：主浮窗 + `PROMPT_EXTRACTION_SETTINGS_DIALOG_SELECTOR`、筛选浮层 + `filterButtonRef`、素材右键菜单）
  5. `src/workbench/assets/AssetLibraryPanel.tsx`（1 处：`filterMenuRef` + `filterButtonRef`）
  6. `src/workbench/generationCanvas/components/useCanvasFrameActions.ts`（1 处：`[data-frame-menu="true"]`）
  7. `src/workbench/preview/EditingLayoutMenu.tsx`（1 处）
  8. `src/workbench/preview/TimelinePreview.tsx`（1 处：含 `!textMenuRef.current` 挂载前帧保护）
  9. `src/workbench/taskCenter/TaskCenterPanel.tsx`（1 处：含 `[data-task-center-trigger]` 排除）
- **靠什么保持唯一（「1」）**：
  - 旧文件 `src/design/outsidePress.ts` 同提交 `git rm`；
  - `src/design/outsidePress.structure.test.ts` 锁死 `src/design/outsidePress.ts` 不存在、`src/design/` 内零手写 `document`/`window` 按下监听、全仓零 `mousedown`/`touchstart` 全局监听与零 `useClickOutside`；
  - `scripts/boundary-owners-ledger.json` 将 `2026-10-23-outside-press-capture.root-cause.json` 的共享边界改锚至 `src/design/overlayLayers.ts::useFloatingOutsideDismiss`，由 `check:boundary-owners` 与 `check:concept-owners` 双重核验；
  - 不靠元素消失猜意图，显式接收 `@floating-ui/react` `onOpenChange(false, event, 'outside-press')` 原因码。

## ★3 一致与复用

- **前序拍板核对**：`docs/engineering/self-written.json` 中 `"outside-press-listener"`（`status: "to-replace"`）明确写定 `revisitWhen`：「`AnchoredPopover` 换到 `@floating-ui/react`（`useFloating` + `useDismiss`）时删除本文件，其余消费者随之迁移」；`docs/engineering/direction-checks/2026-10-23-outside-press-and-rich-text-controls.md` 亦确认听法对齐 `useDismiss` 默认值。
- **三条路选择**：选**换现成库并同提交删自写**（P0 + P1）。`@floating-ui/react@0.27.20` 已存在于 `pnpm-lock.yaml`（`@mantine/core` 传递依赖，底层共用 `@floating-ui/dom@1.8.0`），直接显式固定精确版本 `"0.27.20"` 接入，删除 `src/design/outsidePress.ts` 与 `self-written.json` 的 `"outside-press-listener"` 条目（`to-replace` 计数 `-1`）。

## ★4 全状态

- **空 / 关闭态**：浮层未打开或 `AnchoredPopover` 未传 `onClose` 时，`useDismiss` 处于 `enabled: false`，`document` 新增按下监听数为 `0`。
- **加载 / 忙碌态**：浮层内异步任务进行中（如节点上传忙拒关 `onClose`）时，外点触发一次 `onClose` 被调用方拒绝后浮层保持可见，后续在浮层内点击或按 `Escape` 仍正常复位焦点标志并关闭。
- **成功态（打开 / 正常收起）**：浮层打开即挂载捕获阶段 `pointerdown` 监听；外点立即收起并卸除监听，不抢回触发钮焦点。
- **失败 / 取消中 / 过期 / 能力不可用**：不适用：纯本地 DOM 指针收起原语，无网络请求、无外部模型/硬件依赖、无计费或异步取消状态；界面文案零改动（`check:i18n` 通过）。

## 5 中途表

| 状态 \ 打断 | 用户停手 | 关窗 / 卸载组件 | 断网 | 重启应用 | 快速连点触发钮或画布 |
|---|---|---|---|---|---|
| 浮层关闭态 | 无监听，看到原界面 · 不扣费 · 无回执 | 正常卸载 · 不扣费 · 无回执 | 本地交互无影响 · 不扣费 · 无回执 | 恢复关闭初态 · 不扣费 · 无回执 | 点触发钮正常打开，不漏事件 · 不扣费 · 无回执 |
| 浮层打开态 | 保持打开，0 轮询 · 不扣费 · 无回执 | `useDismiss` effect cleanup 自动解绑 `document` 监听 · 不扣费 · 无回执 | 本地收起无影响 · 不扣费 · 无回执 | 重启后浮层默认收起 · 不扣费 · 无回执 | `reference` 排除保证触发钮只走自身 `onClick` 单次切换，不发生 `pointerdown`+`click` 二次翻转 · 不扣费 · 无回执 |
| 调用方忙拒关态 | 浮层保持可见 · 不扣费 · 调用方既有忙碌提示 | 卸载即解绑监听 · 不扣费 · 无回执 | 与外点无关 · 不扣费 · 无回执 | 重启回初态 · 不扣费 · 无回执 | 再次点浮层内或按 `Escape` 复位 `closedByOutsidePressRef` 并正常还焦点 · 不扣费 · 无回执 |

## 6 外部数据与失败

- **外部输入源**：浏览器 / Electron 原生 `PointerEvent`（可能落在 Shadow DOM、SVG 子节点、React Portal 节点或滚动条轨道上）。
- **规范与防护**：`https://floating-ui.com/docs/useDismiss`；`useDismiss` 内部通过 `composedPath()` 处理 Shadow DOM、通过 `clientWidth`/`offsetX` 忽略滚动条点击，我们的 `isInside` 补充跨组件 Portal 选择器与附加触发钮边界，非 `Element` 文本节点安全回退 `parentElement`，绝不抛未捕获异常。

## ★7 性能

- **① 涉及操作**：浮层打开挂载、浮层内点击、触发钮点击、画布平移面外点收起。
- **② 最坏规模**：生成画布 100+ 节点 + 常驻挂载 `TaskCenterPanel` / `ShellRail` / `NomiBrowserAssetPopover`。
- **③ 预算与实测改进**：
  - 常驻关闭面板在 `document` 上的按下监听增量：**`0` 个**（真浏览器探针实测）；
  - 全仓手写全局输入监听登记文件数：**`35 → 34`**（移除 `src/design/outsidePress.ts`）；
  - 自写待替换台账 `to-replace` 条目：**`-1`**（移除 `outside-press-listener`）；
  - 操作到收起反馈同步在单次 `pointerdown` 事件栈内完成（`< 5ms`，远低于 `≤ 100ms` 预算，交互期间 `> 50ms` 长任务 `0` 个）。
- **④ 量具与场景**：`src/design/floatingDismiss.characterization.test.tsx`（6 项真 Chromium 监听计数与交互契约）+ `tests/ux/anchored-popover-focus.test.mjs`（5 项真 Chromium + React Flow 画布焦点与收起契约）。

## 8 真实条件

- [x] macOS 真隔离 Electron 窗口（`1280×800`，`zh-CN` 与 `en` 双语打开浮层并点画布空白处收起，截图亲眼核验：`docs/evidence/2026-11-24-floating-ui-outside-press/`）
- [x] 键盘与焦点归还全程（`tests/ux/anchored-popover-focus.test.mjs` 5 种关法全绿）
- [ ] Windows 真机：`unverified`（当前环境为 macOS，跨平台指针事件由 Chromium 标准 `pointerdown` + `@floating-ui/react` 统一保证）
- [ ] 真付费：不适用（不涉及任何生成或计费链路）

## 拍板图清单

- 不适用（`internal-no-visible-change`）：本次仅将底层外部按下监听从手写 `src/design/outsidePress.ts` 替换为 `@floating-ui/react` 的 `useFloating` + `useDismiss`，不改任何像素、颜色、字号、间距或文案；既有交互板 `docs/design/boards/2026-10-23-text-format/TextFormatDismiss.board.json` 中记录的 `useDismiss` `pointerdown` 捕获契约原样兑现。

## ★9 验收与回滚

- **两步提交纪律**：
  1. Commit 1（`f065fb62a`）：仅提交 `src/design/floatingDismiss.characterization.test.tsx`，在未改生产代码基线上 6/6 全绿；
  2. Commit 2：9 个消费者全部迁至 `@floating-ui/react`、同提交 `git rm src/design/outsidePress.ts`、同步结构测试与台账，同一套特征测试 6/6 全绿。
- **动手前写定的验收清单与 3 组反例（实现线自验，验收线独立复核）**：
  1. **反例 1（退回冒泡 `mousedown`，模拟画布吞事件回归）**：临时将 `src/design/overlayLayers.ts` 的 `outsidePressEvent` 改为 `'mousedown'` 且 `capture: { outsidePress: false }` → 预期 `floatingDismiss.characterization.test.tsx`（画布 `mousedown` `stopImmediatePropagation` 外点收起）与 `outsidePress.structure.test.ts` 双双变红；恢复后全绿。
  2. **反例 2（破坏触发钮 `reference` 排除，模拟二次翻转回归）**：临时去掉 `src/design/overlayLayers.ts` 中对 `reference` 边界的排除并启用 `referencePress: true`（或让点触发钮触发 `onDismiss`）→ 预期 `floatingDismiss.characterization.test.tsx` 中 `AnchoredPopover` / `EditingLayoutMenu` / `NomiBrowserAssetPopover` 触发钮点击测试变红；恢复后全绿。
  3. **反例 3（新增裸 `document.addEventListener('mousedown', ...)` 旁路）**：临时在任一生产组件加一行 `document.addEventListener('mousedown', () => {})` → 预期 `src/design/outsidePress.structure.test.ts` 立即变红拦截；恢复后全绿。
- **门岗与测试命令**：
  - `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`
  - `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`
  - `node scripts/check-test-types.mjs`
  - `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs`
  - `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`
  - `pnpm run check:boundary-owners`
  - `pnpm run check:concept-owners`
  - `pnpm run check:controls`
  - `pnpm run check:design-lab-mirrors`
  - `pnpm run check:filesize`
  - `pnpm run check:i18n`
  - `./node_modules/.bin/vitest run --maxWorkers=2 src/design/floatingDismiss.characterization.test.tsx src/design/outsidePress.structure.test.ts src/design/anchoredPopoverPlacement.test.ts src/workbench/modalInputLayerCensus.test.ts tests/ux/anchored-popover-focus.test.mjs`
- **回滚**：单 PR 完整闭环，`git revert <merge-sha>` 即可无副作用回退到 `outsidePress.ts`。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
