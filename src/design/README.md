# Design

`src/design/` 是共用视觉积木的入口：`import { ... } from '../../design'`（即 `index.ts`）。
形态规格住在 `docs/design/nomi-design-system.md` §3；这里只回答「有哪些、各自的采纳现状是什么」。

> **这份清单按 `index.ts` 的真实导出写，不写路线图。**
> 2026-09-07 之前它推销过 `PanelCard` / `InlinePanel` / `DesignSelect` 三个**不存在**的组件，
> 照着写会直接编译失败。以后加/删组件必须同一 commit 改这里——一份错的清单比没有清单更伤。

## 现役积木

**动作** `actions.tsx`
- `WorkbenchButton` / `WorkbenchIconButton` —— 工作区原生按钮，密集面（画布 / 时间轴 / 节点 / 侧栏）。主力（35 / 15 个文件在用）。
- `DesignButton` / `IconActionButton` —— Mantine-backed，设置 / 模型管理 / 分享这类 Mantine 面（22 / 10 个文件）。
- `ActionCard` —— 起始页页面级主入口大卡（1 个文件）。

**表单与选择**
- `DesignTextInput` / `DesignTextarea` / `DesignNumberInput` / `DesignCheckbox` / `DesignSwitch` / `DesignSegmentedControl`（`forms.tsx`）—— Mantine-backed。
- `NomiSelect`（`NomiSelect.tsx`）—— 选择面板主力（27 个文件）。**没有 `DesignSelect`，用这个。**
- `NomiSegmented`（`NomiSegmented.tsx`）—— 原生分段控件（5 个文件）；与 `DesignSegmentedControl` 是近重复，合并归属 D 档刀 4。
- `DesignSearchInput`（`searchInput.tsx`）—— 搜索框（7 个文件；另有 3 处更小的内嵌过滤框没收口，理由见该文件注释）。

**状态与空态** `status.tsx` / `emptyState.tsx`
- `DesignProgress`（4 个文件）、`NomiSkeleton`（项目库 loading 态）。
- `DesignEmptyState` —— 面板级空态（9 个文件；画布节点族另有 3 份并行结构，理由见该文件注释）。
- `DesignBadge` / `StatusBadge` —— ⚠️ **生产代码 0 调用点**，保留是因为画布侧有 5 份手写徽章待迁（见 `status.tsx` 注释）。

**浮层** `overlays.tsx` / `AnchoredPopover.tsx` / `tooltip.tsx` / `confirmDialog.tsx` / `portal.tsx`
- `DesignModal` —— Mantine Modal + token 外壳（8 个文件）。
- `confirmDialog` / `alertDialog` / `promptDialog` + `ConfirmDialogHost` —— **禁用原生 `window.confirm/alert/prompt`**，一律走这套。
- `AnchoredPopover` —— 锚点浮层（2 个文件）。⚠️ 全仓浮层定位实有四套，它不是唯一的那套，见该文件注释。
- `Tooltip` / `TooltipTrigger` / `TooltipContent` / `TooltipProvider` —— Radix tooltip 换肤。
- `BodyPortal`、`NOMI_OVERLAY_Z_INDEX` / `hasOpenDialogAbove`（`overlayLayers.ts`）、`useOverlayEscape`。

**品牌身份** `identity.tsx` / `NomiIdentityIcon.tsx`
- `NomiWordmark` / `NomiLogoMark` / `NomiBrand` / `NomiLoadingMark` / `NomiStepper` —— 品牌不变量的唯一真相源，禁止手画 svg 或手写 `No<span>m</span>i`。
- `NomiAILabel`、`NomiIdentityIcon` —— ⚠️ 生产代码 0 调用点（2026-09-07 实测），未处置。

**其他** `media.tsx` 的 `NomiImage`（19 个文件）、`tokens.ts` / `theme.ts`（token 与 Mantine 主题入口）、
`previewHost.tsx` 的 `NomiPreviewHost`（App 之外的预览宿主，消费者是 `design-sync.config.json` 的 `provider`）。

## 2026-09-07 删掉的（全仓零调用，含设计实验室格与基线）

`DesignPagination`（全仓无分页界面）、`DesignTable`（分镜表另有自己的 `TableStage`）、
`DesignPageShell`（4 个 Tailwind 类的 div）、`DesignDrawer`（全仓无抽屉形态）、
`DesignAlert`（且透传裸 Mantine `color`，绕过 tone 词表）、`DesignFileInput`
（全仓 13 处走的是「隐藏 input + 按钮」，与 Mantine 可见文本框形态不是一回事）。
同批删掉 20 个全仓零 CSS 定义的 `tc-*` 钩子类；只留 `tc-action-card`（两条 e2e 走查拿它当锚点）。

## 纪律

- 新的共用视觉积木先加在这里，不要在功能页里复制样式逻辑。
- 加/删导出必须同 commit 更新本文件与 `docs/design/nomi-design-system.md` §3。
- 组件的采纳现状变了（0 调用 → 有调用，或反过来）也要在这里改过来。
