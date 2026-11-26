有条件通过：外壳折行契约、20 扇调用门核查、真 Chromium 380px 排版与回退必红反例全部实测通过；样片模式英文深色 1100×690 等桌面对照截图按派活单由协调审查补截确认。

- 验收线：v-fmodal-title
- 验收 HEAD：da738062bb660af20a6a7dbf0f0738a3045a2c42
- 阻断：无
- 基线提交：`a05ca5219`（仅测试提交：`6d8059b1683c9ed27a0cd43ea267e56339db1079`）
- 盲验依据：派活单、`docs/plan/2026-11-26-direction-check-spend-confirm-title.md`、分支源码与实跑输出（未读任何实现线交付文档）

## 1. 范围与禁区核查

`git diff --stat a05ca5219..da738062bb660af20a6a7dbf0f0738a3045a2c42` 共改动 9 个文件（`+435 / -18`）：

| 核查项 | 结论 | 实证 |
|---|---|---|
| 外壳唯一收口折行与首行顶对齐 | 通过 | 仅 `src/design/overlays.tsx`（`DesignModal`）统一定义 `title: cn(callerClassNames.title, 'min-w-0 whitespace-normal break-words')`、`header: cn('shrink-0', callerClassNames.header, '*:min-w-0', titleWrapped && 'items-start')`、`close: cn(callerClassNames.close, 'shrink-0')`；通过 `ResizeObserver`（React 19.3.0 原生支持 ref cleanup）观测 `Modal.Title` 高度，单行维持 `items-center`，折行后切换 `items-start` 并经 `header(titleElement, rowAlignment)` 传递至前置图标行。 |
| 未改任何弹窗标题字号、字重、颜色 | 通过 | `overlays.tsx` 未设置字号/字重/颜色；`SpendConfirmDialog.tsx` 保持 `text-title font-medium text-nomi-ink`；`CustomCallTitle.tsx` 保持 `text-body font-semibold text-nomi-ink`；`SelectionPromptSaveController.tsx` 保持 `text-body font-semibold text-nomi-ink`；`HandbookPanel.tsx` 保持 `text-title font-bold text-nomi-ink`。 |
| 未写非设计系统任意值 | 通过 | `SpendConfirmDialog.tsx` 还将旧的 `leading-[inherit]` 收敛为 Tailwind `leading-normal`；`node ./scripts/check-design-tokens.mjs` 通过（4 类棘轮 0/0/0/0）；`node ./scripts/check-dangling-tailwind.mjs` 通过（悬空类 0）。 |
| 未碰 i18n 文案、拍板图或 `feat/sd-sample-mode` | 通过 | diff 零改动 `src/i18n/`、`docs/design/` 及任何拍板图文件。 |
| 两处单行截断同提交删净 | 通过 | `da738062b` 同提交删除 `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` 的 `truncate` 与 `src/ui/onboarding/CustomCallTitle.tsx` 的 `whitespace-nowrap`（并去掉 `shrink-0`）。 |
| 热点提交 `Direction-Check` trailer 合规 | 通过 | `da738062bb660af20a6a7dbf0f0738a3045a2c42` 提交信息含 `Direction-Check: docs/plan/2026-11-26-direction-check-spend-confirm-title.md`，且目标文档存在于分支中。 |
| 类型与根因合同门禁 | 通过 | `pnpm run typecheck` 5 份并发全绿（`tsc app/electron/electron-pi/fixtures` + `check:test-types`）；`node ./scripts/check-root-cause-contracts.mjs` 通过。 |

## 2. 全量调用方核查（20 扇门）

实跑 `node scripts/door-map.mjs DesignModal`：扫描 3214 个非测试源码文件，写入口 0 扇、读入口 **20 扇**（40 处出现；19 个生产文件 + 1 个 devlab 样张 `src/devlab/designLab/primitivesSurfaces/states/02-overlays.tsx`）。逐扇门源码复核结果：

- **13 扇默认标题门（无 `classNames.title` / 无自定义标题样式）**：`src/design/confirmDialog.tsx`、`src/devlab/designLab/primitivesSurfaces/states/02-overlays.tsx`、`src/ui/community/FeedbackShareHost.tsx`、`src/ui/onboarding/ModelSettingsDetailDialog.tsx`（`header: 'sr-only'`）、`src/ui/onboarding/OnboardingWizard.tsx`（注：第 678 行 `<h2 className="truncate">` 属于 `presentation === 'page'` 的 `ModelSettingsPageSurface`，非 `DesignModal` 标题栏）、`src/workbench/ai/ProjectAgentResidentShell.tsx`、`src/workbench/generationCanvas/nodes/director/panels/dialogs/ActionSelectModal.tsx`、`src/workbench/generationCanvas/nodes/director/panels/dialogs/HelpDialog.tsx`、`src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx`、`src/workbench/generationCanvas/nodes/director/panels/dialogs/SettingsDialog.tsx`、`src/workbench/library/WorkflowLibraryContent.tsx`、`src/workbench/settings/SettingsDialog.tsx`、`src/workbench/timeline/TimelineShortcutsDialog.tsx`。以上均无标题单行截断，统一继承外壳折行与顶对齐。
- **7 扇带 `header` 插槽或 `classNames.title` 的门**：
  1. `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`：`truncate` 已删，图标行接入 `rowAlignment`；Agent 副标（`text-micro text-nomi-ink-60`）未误伤。
  2. `src/ui/onboarding/CustomCallEditor.tsx`（经 `src/ui/onboarding/CustomCallTitle.tsx`）：`CUSTOM_CALL_NAME_CLASS` 已删 `whitespace-nowrap` 与 `shrink-0`；相邻模型名 `{label}` 保留 `min-w-0 flex-1 truncate text-caption text-nomi-ink-60`，省略策略未被误伤。
  3. `src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx`：无标题截断，logo 行接入 `rowAlignment`。
  4. `src/workbench/onboarding/HandbookPanel.tsx`：无标题截断，图标/字标行接入 `rowAlignment`。
  5. `src/ui/app-shell/UpdateDialog.tsx`：无标题截断，图标行本身 `flex items-start gap-3`，副标未误伤。
  6. `src/ui/browser/prompt/BrowserPromptExtractionSettingsModal.tsx`：无标题截断，路径副标未误伤。
  7. `src/workbench/skillLibrary/SkillDetail.tsx`：无标题截断，作者标签保留 `max-w-40 truncate`，未误伤。

## 3. 定向单测与真 Chromium 浏览器实测

均以 `VITEST_MAX_WORKERS=2` 指定文件实跑通过：

1. `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/design/overlays.structure.test.tsx src/design/dialogName.browser.test.ts src/design/modalAccessibleNames.test.tsx src/workbench/generationCanvas/spend/SpendConfirmDialog.test.tsx`
   - 结果：**4 个测试文件 / 25 条用例全部通过**（总耗时 17.60s）：
     - `src/design/overlays.structure.test.tsx`：7/7 通过（含 AST 全仓扫描「DesignModal 调用方不能把标题限制为单行」，3723ms）。
     - `src/design/dialogName.browser.test.ts`：9/9 通过（真实 Chromium + `@mantine/core/styles.css` + PostCSS/Tailwind 编译生产样式，17098ms）：
       - 380px `SpendConfirmDialog` 挂载 60 字符英文标题（`Create another high definition version of this sample draft?`，实测长度 60）后：宽度精确 380px，`whiteSpace !== 'nowrap'`，`textOverflow !== 'ellipsis'`，真实折成 `2` 行，零水平/垂直裁剪（`clipped === false`），前置图标与关闭键 `boundingBox().y` 与标题首行顶齐。
       - 短标题单行（`Generate reference images?`）：`fontSize === '16px'`、`fontWeight === '500'`、保留 `text-title font-medium text-nomi-ink`，图标与关闭键继续与单行标题垂直居中（零误伤）。
     - `src/design/modalAccessibleNames.test.tsx`：7/7 通过。
     - `src/workbench/generationCanvas/spend/SpendConfirmDialog.test.tsx`：2/2 通过。
2. 关联回归特征测试：`VITEST_MAX_WORKERS=2 pnpm exec vitest run src/design/dialogMigration.structure.test.ts src/design/dialogAnchorFreeze.test.ts src/workbench/generationCanvas/spend/SpendConfirmHost.test.tsx`
   - 结果：**3 个测试文件 / 18 条用例全部通过**（871ms）。

## 4. 破坏必红反例（实跑验证）

在不移动 `HEAD` 的前提下，分别将工作区回退至（A）仅测试提交 `6d8059b16` 完整快照，与（B）保留 `HEAD` 测试但将 5 个生产文件回退至修复前 `a05ca5219` 写法，随后立即完整还原并确认 `git status` 干净：

- **反例 A（仅测试提交 `6d8059b16`）**：
  - `src/design/overlays.structure.test.tsx`：**真实变红失败（exit 1）**
    ```text
    FAIL src/design/overlays.structure.test.tsx > DesignModal 调用方不能把标题限制为单行
    AssertionError: expected [ …(2) ] to deeply equal []
    Received: [
      "src/ui/onboarding/CustomCallTitle.tsx: whitespace-nowrap",
      "src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx: truncate",
    ]
    ```
  - `src/design/dialogName.browser.test.ts`：**真实变红失败（exit 1）**
    ```text
    FAIL src/design/dialogName.browser.test.ts > 380px 花钱确认卡的标题排版 > 60 字符的英文标题完整折行，关闭键和图标靠首行
    AssertionError: expected 'nowrap' not to be 'nowrap' // Object.is equality
    ```
- **反例 B（`HEAD` 测试 + 修复前生产文件）**：
  - `src/design/overlays.structure.test.tsx`：**真实变红失败（exit 1）**，同样检出 `CustomCallTitle.tsx: whitespace-nowrap` 与 `SpendConfirmDialog.tsx: truncate` 两项违规。
  - `src/design/dialogName.browser.test.ts`：**真实变红失败（exit 1）**，同样在 60 字符长标题用例报 `AssertionError: expected 'nowrap' not to be 'nowrap'`。

## 5. 待协调补截确认项与非阻断观察

- **待协调审查补截（按派活单范围约定）**：样片模式「第二次出高清」英文深色 1100×690、短标题弹窗、自定义调用标题三处桌面端改前改后对照截图，由协调审查补截后交用户确认再合入。
- **非阻断观察**：按派活单「不改任何弹窗标题字号/行高/外观、单行一像素不变」的明确边界，13 扇未传 `classNames.title` 的弹窗仍沿用 Mantine 默认 `line-height: 1`；后续统一弹窗标题字号与行高出样张拍板时一并收口即可。
