结论：通过 · 验收线：mo1-verify · 验收 HEAD：bddd789172c8bc71eebf70fd22b91d5f92204abe

- 验收线：mo1-verify
- 实现线：mo-motion-slice1
- 验收 HEAD：bddd789172c8bc71eebf70fd22b91d5f92204abe
- 对应设计卡：`docs/plan/2026-11-24-mo-motion-slice1-tokens-and-gate.md`
- 方向复盘：`docs/engineering/direction-checks/2026-11-24-motion-token-reader.md`
- 验收结论：通过（无阻塞缺陷）

## 1. 范围、设计与隐私核查

- **单一真源与三层保护**：`src/design/motion.ts`（概念 `ui.motion-scale`）统一拥有 6 档动效时长（`instant 0ms`、`micro 110ms`、`fast 150ms`、`normal 220ms`、`spatial 360ms`、`morph 550ms`）、单一 `× 2/3` 退场公式（`fast-exit 100ms`、`normal-exit 150ms`、`spatial-exit 240ms`、`morph` 退出 `370ms`）、文字与发送按钮按压微缩 `scale(0.97)` 与三层 `prefers-reduced-motion` 保护；`src/theme/nomi-tokens.css` 静态镜像与运行时变量逐项由 `check:tokens` 校对。
- **跨审查收口核验（`bddd78917`）**：`BrowserCaptureFlyouts.tsx` 进入沿用 `NOMI_DURATION_MS.morph`（550ms），退出按 `exitDurationMs(NOMI_DURATION_MS.morph)`（370ms）与 `NOMI_EASE.in` 派生；`DesignButton` 忙态在视觉加载图标外维护独立本地化 `status` 区并保持按钮标签与宽度稳定；`motionTokenScan` 覆盖数值 duration utility、未授权 press scale、原始 shorthand、CSS 镜像漂移与 Motion 时长逃逸。
- **隐私与干净度核查**：`origin/main..HEAD` 全部提交信息及非 PNG 新增 diff 行扫描本机绝对路径、临时目录路径与私有工作树前缀均 **0 命中**。

## 2. 视觉证据、窗口探针与性能对照核验

已通过 `read_file` 亲眼核对 `docs/evidence/2026-11-24-mo-motion-slice1/` 下的并排录像帧与报告：

- **并排真实桌面帧目视通过（`window-frames.png`）**：6 组 BEFORE vs AFTER 真隔离 Electron 窗口画面覆盖 `zh-CN / light · text`、`zh-CN / dark · send`、`en / light · agent`、`en / dark · toolbar`、`en / light / 1100×690 · agent`、`zh-CN / light / reduce · send`，三阶段顶栏、画布节点工具条、生成框发送键及 Agent 面板在亮/暗、中/英、窄窗与减弱动态下均清晰完整、无裁切或视觉回归。
- **窗口与组件实测核验（`window-acceptance.md`）**：
  - 正常模式下 5 轨文字钮与发送钮按压比例稳定为 `1.000 → 0.970`，普通节点工具图标保持 `1.000 → 1.000`，computed `transitionDuration` 为 `0.15s → 0.11s`；
  - 减弱动态轨（`zh-CN / light / reduce`）文字钮与发送钮均保持 `1.000 → 1.000`，过渡时长归零（`0.15s → 0s`），React Flow 适应视图由 11 个中间姿态收口为 1 个直达落点姿态；
  - `WorkbenchButton` 与 `DesignButton` 进 loading 后宽度零跳动（`126.390625px` / `128.890625px`），`role="status"` 与 `aria-busy="true"` 完好；12 条录像媒体付费请求均为 `0`。
- **同机成对性能核验（`performance.md` & `perf.json`）**：
  - 同台 Apple M5 / 16GB 后台窗口 5 轮成对测量下，最终构建相对修改前全部持平或改善：`canvas-drag-20-nodes` `25.6 → 20.1 ms`（预算 `33 ms`）、`timeline-scrub` `32.8 → 24.5 ms`（预算 `33 ms`）、`window-narrow-drag` `18.9 → 18.9 ms`（预算 `33 ms`）、`chat-scroll-500` `17.6 → 17.3 ms`（同机静止对照中位 `17.5 ms`，系宿主机刷新基底限制），4 场景长任务均为 `0 / 0`。
- **诚实未验证边界**：Windows 真机、真实付费供应商生成与屏幕阅读器语音朗读沿设计卡如实记为 `unverified`。

## 3. 定向门岗与核心单测独立复跑（全部 `EXIT=0`）

严格按资源纪律在隔离验收工作树独立串行复跑定向检查（未跑全量 `gates` / `gates:contracts` / `check:design-lab`）：

- `pnpm run check:tokens`：**PASS**（4 类棘轮 `0/0/0/0`，`color-mix` / `:root` 作用域 / `motionTokenScan` 与静态镜像全绿）；
- `pnpm run check:filesize`：**PASS**（0 新增红牌）；
- `pnpm run check:controls`：**PASS**（0 违规）；
- `pnpm run check:root-cause-contracts`：**PASS**；
- `pnpm run check:self-written`：**PASS**（177 个领域目录 · 68 项登记 · 新增代码文件 6 个 · 0 个未认领）；
- `pnpm run check:boundary-owners`：**PASS**（27/27 自测通过，声明 2159 条：在位 1890）；
- `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`：**PASS**（46 个改动文件，0 错误，0 新增警告）；
- 5 套定向 Vitest（`VITEST_MAX_WORKERS=2`：`src/design/motion.test.ts`、`src/design/actions.test.tsx`、`src/ui/browser/BrowserCaptureFlyouts.test.tsx`、`scripts/motionTokenScan.test.mjs`、`src/workbench/generationCanvas/nodes/useReducedProcessMotion.test.ts`）：**5/5 文件，36/36 passed**。

## 4. ★9 真实变异故障注入验证（2/2 必红 → 还原必绿）

| 编号 | 故障注入方式 | 门岗拦阻实测（必红） | 还原验证 |
|---|---|---|---|
| M1（业务组件硬编码动效） | 在 `src/ui/browser/BrowserCaptureFlyouts.tsx:24` 临时混入 `duration-300 active:scale-[0.97]` | `pnpm run check:tokens` 退出码 `1`，双命中报错 `duration-300 — use src/design/motion.ts` 与 `active:scale-[0.97] — use src/design/motion.ts` | `git checkout --` 还原后复绿 |
| M2（CSS 退场镜像漂移） | 在 `src/theme/nomi-tokens.css:86` 临时将 `--nomi-duration-fast-exit` 从 `100ms` 改为 `120ms`（偏离 `exitDurationMs(150) = 100ms`） | `pnpm run check:tokens` 退出码 `1`，精确报错 `✗ motion mirror: --nomi-duration-fast-exit expected 100ms, got 120ms` | `git checkout --` 还原后 `check:tokens` 退出码 `0` |
