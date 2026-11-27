有条件通过：合并提交 `4678085a6f12fd3091ccb3dca852a259035011a9` 的独立盲验中，全部代码逻辑、20 扇调用方核查、锁文件冲突解决核查、真实渲染单测/浏览器布局实测与破坏必红反例均通过；桌面端三处改前改后截图按派活单约定留待协调审查补截确认。

- 验收线：v-fmodal-title-r4
- 验收 HEAD：4678085a6f12fd3091ccb3dca852a259035011a9
- 基线对比：`origin/main`（`be925b9e0`）..`4678085a6f12fd3091ccb3dca852a259035011a9`
- 阻断：无
- 待补条件：桌面端三处改前改后截图（按派活单约定本轮不截，交协调审查补截确认）

## 1. 范围与实现核查

1. **外壳兜底与顶对齐机制（`src/design/overlays.tsx`）**
   - 使用 `useResolvedStylesApi<ModalFactory>({ classNames, styles, props })` 统一解析对象与回调两种写法的 `classNames` / `styles`。
   - 对 `caller.title` 过滤所有变体前缀 / `!` 修饰符组合的截断类（`truncate`、`text-ellipsis`、`text-nowrap`、`whitespace-nowrap`、`whitespace-pre`、非 `none` 的 `line-clamp-*`、`overflow*-hidden|clip`、`break-normal`）及任意属性声明（`[white-space:...]`、`[text-overflow:...]`、`[overflow*:...]`、`[line-clamp:...]` 等），同时保留调用方合法的字号、字重、字体、颜色类，并附加 `min-w-0`。
   - 对 `resolvedStyles.title` 过滤 `titleFlowStyles`，强制设置 `whiteSpace: 'normal'` 与 `overflowWrap: 'anywhere'`，并保留其余排版内联样式（如 `letterSpacing`）。
   - `header` 附加 `*:min-w-0`，`close` 附加 `shrink-0`；通过 `ResizeObserver` 独立观测 `Modal.Title`（`h2`）高度是否超过 `Math.ceil(lineHeight)`，仅在标题实际折行时把 `Modal.Header` 与 `header(titleElement, rowAlignment)` 同步切至 `items-start`，单行时维持 `items-center`。

2. **全部调用方核对（`node scripts/door-map.mjs DesignModal`）**
   - 扫描 3214 个非测试文件，共检出 20 扇读入口（40 处引用）。
   - 19 个生产弹窗调用方全部在 `src/design/__tests__/modalTitleCallers.test.tsx` 中真实挂载渲染并注入超长标题验证；第 20 扇门 `src/devlab/designLab/primitivesSurfaces/states/02-overlays.tsx` 为设计实验室陈列页，直接使用无自定义标题类/插槽的 `<DesignModal>` 默认外壳，由 `DesignModalDefault` 覆盖。
   - 正当排版类零丢失核对：
     - `src/ui/app-shell/UpdateDialog.tsx`：`block m-0 text-title font-semibold text-nomi-ink` 原样保留；
     - `src/ui/onboarding/CustomCallEditor.tsx`（经 `src/ui/onboarding/CustomCallTitle.tsx`）：`text-body font-semibold text-nomi-ink` 原样保留，已删净 `shrink-0 whitespace-nowrap`（旁侧 `label` 改为 `min-w-0 flex-1 truncate`）；
     - `src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx`：`text-body font-semibold text-nomi-ink` 原样保留，前置标志行接入 `rowAlignment`；
     - `src/workbench/onboarding/HandbookPanel.tsx`：`text-title font-bold text-nomi-ink` 原样保留，前置图标行接入 `rowAlignment`；
     - `src/workbench/skillLibrary/SkillDetail.tsx`：`m-0 font-nomi-display text-h1 font-medium leading-8 text-nomi-ink` 原样保留；
     - `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`：`block text-title font-medium leading-normal text-nomi-ink` 原样保留字号/字重/颜色，已删净 `truncate`，前置图标行接入 `rowAlignment`。
   - 核查 `src/design/`、`tests/`、`scripts/` 无旧 AST 静态扫描测试残留，真相完全由真实渲染与浏览器布局测试守住。

3. **合并锁文件核查**
   - `git diff origin/main..4678085a6f12fd3091ccb3dca852a259035011a9 -- package.json` 仅新增 `"jsdom": "27.2.0"`。
   - `git diff origin/main..4678085a6f12fd3091ccb3dca852a259035011a9 -- pnpm-lock.yaml`（+297 / -4）仅包含 `jsdom@27.2.0` 及其传递依赖、`vitest@4.1.8` 的 `jsdom@27.2.0` peer 组合键更新，以及 `iconv-lite@0.6.3` 因 `whatwg-encoding@3.1.1` 引入而移除 `optional: true`，无冲突残留或无关依赖变更。
   - `pnpm install --frozen-lockfile --prefer-offline` 退出码 0（`Lockfile is up to date, resolution step is skipped` / `Already up to date`）。

## 2. 自动化验证结果

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 锁文件离线冻结校验 | `pnpm install --frozen-lockfile --prefer-offline` | 通过（exit 0） |
| 入口普查 | `node scripts/door-map.mjs DesignModal` | 20 扇门全数核对完成 |
| 渲染单测与构建依赖单测 | `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/design/__tests__/DesignModal.test.tsx src/design/__tests__/modalTitleCallers.test.tsx src/design/modalAccessibleNames.test.tsx src/design/overlays.structure.test.tsx scripts/viteOptimizeDeps.test.mjs` | 5 文件 41/41 通过（`DesignModal` 6、`modalTitleCallers` 20、`modalAccessibleNames` 7、`overlays.structure` 6、`viteOptimizeDeps` 2） |
| 真实浏览器布局与读屏实测 | `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/design/dialogName.browser.test.ts` | 9/9 通过（含 380px `SpendConfirmDialog` 60 字符英文 2 行折行无裁切+首行顶对齐、单行 `16px`/`500` 居中对齐） |
| 设计 token 门岗 | `node scripts/check-design-tokens.mjs` | 通过（4 类棘轮 0/0/0/0） |
| 设计实验室 mirrors 校验 | `node scripts/check-design-lab.mjs --mirrors-only` | 通过 |
| 根因合同校验 | `node ./scripts/check-root-cause-contracts.mjs` | 通过 |

## 3. 破坏必红反例记录

- **临时破坏方式**：不移动 `HEAD`，执行 `git checkout origin/main -- src/design/overlays.tsx src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx src/ui/onboarding/CustomCallTitle.tsx`，将外壳防护与两处截断旧写法恢复回 `origin/main`。
- **变红实测**：运行 `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/design/__tests__/DesignModal.test.tsx src/design/__tests__/modalTitleCallers.test.tsx`，退出码 `1`，2 个测试文件共 7 条用例失败：
  - `src/design/__tests__/DesignModal.test.tsx` 5/6 失败（对象/回调 `classNames`、对象/回调 `styles`、类与内联样式同时覆盖全部被抓红，仅断言自检用例保持绿）；
  - `src/design/__tests__/modalTitleCallers.test.tsx` 2/20 失败（`CustomCallEditor 的超长标题` 捕获 `whitespace-nowrap`，`SpendConfirmDialog 的超长标题` 捕获 `truncate`）。
- **还原与复绿**：执行 `git checkout HEAD -- src/design/overlays.tsx src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx src/ui/onboarding/CustomCallTitle.tsx` 还原，确认工作区源码 100% 干净后复跑全部 5 份单测（41/41 通过）。
