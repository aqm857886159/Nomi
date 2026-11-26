结论：通过 · 验收线：ux3-verify · 验收 HEAD：e7bdf227959be3ff0de0d8c2b9fd1b9cd4bae4e9

- 验收线：ux3-verify
- 实现线：ux-preview-ux3
- 验收 HEAD：e7bdf227959be3ff0de0d8c2b9fd1b9cd4bae4e9
- 对应设计卡：`docs/plan/2026-11-24-ux-simple-preview-ux3.md`
- 方向复盘：`docs/engineering/direction-check/2026-11-24-preview-ux3.md`
- 验收结论：通过（无阻塞缺陷）

## 1. 范围、设计与隐私核查

对照 `origin/main...e7bdf227959be3ff0de0d8c2b9fd1b9cd4bae4e9` 全部改动（`5e4d5db14`、`197d19edd`、`bdee0ad01`、`e7bdf2279`）：

- **预览首段自动画幅与手选持久化**：`src/workbench/preview/previewAspectRatios.ts` 以对数比例距离 `matchFirstVisualAspect` 在空视觉轴首次入轨时自动匹配最接近画幅（`9:16`、`1:1`、非标比例均兼容），明确保护 `aspect?.source === 'manual'` 与已有视觉片段的既有画幅；项目 schema/normalize/content/liveness 普查同步覆盖 `previewAspect`，老项目缺省保持原 `16:9` 兼容；图片比例探测收敛至既有 `src/media/videoDurationProbe.ts`。
- **空轴禁用导出与完成 Toast 回执**：`src/workbench/preview/previewExportRequest.ts` 提供唯一资格判定 `canExportPreviewTimeline`（`computeTimelineDuration(timeline) > 0`，纯文字/配乐/字幕有正时长仍可导出），`ShellTopBar.tsx` 在空轴时挂原生 `disabled` 与单一 App tooltip（无原生 `title` 叠影），有时长时提示导出画幅与分辨率；`previewExportFeedback.ts` 签发带项目与相对路径归属的完成 Toast，点击「打开文件夹」经既有 `exports.showInFolder` IPC 揭示成品。
- **片库横排短词条与双语轨道文案**：收起态 32px 窄轨采用横排短词条 `片库` / `Clips`，`zh-CN` 与 `en` 键对齐且无裁字。
- **隐私与干净度核查**：`origin/main..HEAD` 全部提交信息及非 PNG 新增 diff 行扫描本机绝对路径、临时目录路径与私有工作树前缀均 **0 命中**。

## 2. 视觉证据与性能核验

已通过 `read_file` 亲眼核对 `docs/evidence/2026-11-24-ux-preview-ux3/` 下的代表性真隔离 Electron 窗口截图与 `perf-summary.json`：

- `zh-light/after-empty-tooltip.png` & `zh-light/after-empty-collapsed.png`：空轴态顶栏「导出 MP4」原生禁用且悬停呈现单一 App tooltip「先往时间轴放入至少一段素材」；空舞台给出点选与拖入双指引；收起态窄轨清晰横排显示「片库」。
- `zh-light/after-first-clip.png` & `en-dark/after-first-clip.png`：首段竖屏 `360×640` 视频入轨后预览舞台立即全屏切至 `9:16`（零黑边），顶栏导出按钮同步启用。
- `zh-light/after-export-complete.png`：真实本地导出完成后呈现成功 Toast「MP4 已导出」与「打开文件夹」动作钮。
- `en-narrow/after-empty-collapsed.png`：`1100×690` 英文暗色窄窗下收起态横排 `Clips` 完整落于 32px 轨内，`Export MP4` 禁用清晰、无溢出遮挡。
- `en-light/after-first-square.png`：`360×360` 方形素材首次入轨精确匹配 `1:1` 满画幅舞台。
- **性能收据核验（`perf-summary.json`）**：`"dirty": false`、`timeline-scrub`（96 节点 / 24 视频片段）5 轮帧间隔 p95 中位数 **23.4 ms** / 跨轮 p95 **24.9 ms**（低于预算 `33 ms`，优于同机基线 `23.6 ms / 26.3 ms`），5 轮长任务均为 **0**。
- **诚实未验证边界**：Windows 真机与远程付费供应商生成沿设计卡如实记为 `unverified`。

## 3. 首轮定向门岗与核心单测独立复跑（`197d19edd`，全部 `EXIT=0`）

- `pnpm run check:filesize`、`pnpm run check:self-written`、`pnpm run check:board-parity`、`pnpm run check:root-cause-contracts`（55/55）、`pnpm run check:controls`（0 违规）、`pnpm run check:i18n`（23/23 + 6743 键）、`NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`（38 文件 0 错）、`pnpm run check:test-types`、`./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：**全绿**。
- 5 套定向 Vitest（`previewAspectOnInsert.test.ts`、`previewExportFeedback.test.ts`、`previewUxLabels.test.tsx`、`ShellTopBar.previewExport.test.tsx`、`projectLivenessContent.census.test.ts`）：**5/5 文件，24/24 passed**。

## 4. ★9 运行时故障变异验证（2/2 必红 → 还原 9/9 必绿）

| 编号 | 故障注入方式 | 变异实测（必红） | 还原验证 |
|---|---|---|---|
| M1（忽略 `manual` 手选画幅保护） | 在 `src/workbench/preview/previewAspectRatios.ts:45` 移除 `aspect?.source === 'manual'` 守卫 | `previewAspectOnInsert.test.ts` 退出码 `1`（`preserves even a deliberate choice of the default across reopening and insertion` 失败：`expected '1:1' to be '16:9'`） | `git checkout --` 后复绿 |
| M2（空轴禁用导出失效） | 在 `src/workbench/preview/previewExportRequest.ts:22` 将 `canExportPreviewTimeline` 退回恒返回 `true` | `ShellTopBar.previewExport.test.tsx` 退出码 `1`（`disables native click on an empty timeline` 失败：按钮缺少 `disabled=""`） | `git checkout --` 后两套复跑 **9/9 必绿（`EXIT=0`）** |

## 5. 交叉审查 3 项边界修复增量复核（`bdee0ad01e5625fefb242de05f884b62c98fa8ea`）

- **增量代码审阅（`197d19edd..bdee0ad01`，5 文件 `+96/-20`，0 本机路径泄露）**：`workbenchProjectSession.ts` 项目恢复重置 `timelineHistory` 与 `detachedTimelineClips`、`adoptGenerationNode.ts` 串行 `appendChain` 并按实时轴重算落点帧、`previewAspectRatios.ts` + `workbenchStore.ts` 在 `travelTimeline` 时自动还原/恢复 `auto` 画幅且保持 `manual` 不动、`previewAspectOnInsert.test.ts` 清除违规直写。
- **独立复跑全绿（`EXIT=0`）**：`pnpm run check:adoption-bridge`（PASS）、2 套 Vitest（`21/21 passed`）、`pnpm run check:test-types`（PASS）、`./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`（0 错）。

## 6. 概念 owner 登记增量复核（`e7bdf227959be3ff0de0d8c2b9fd1b9cd4bae4e9`）

- **增量核查**：相对 `bdee0ad01` 仅新增 `docs/engineering/concept-owners/preview.{aspect-choice,export-eligibility,export-receipt}.json` 3 个登记文件（`+80` 行，生产代码 0 改动，0 本机路径泄露）。
- **独立复跑全绿（`EXIT=0`）**：`CONCEPT_OWNERS_BASE_REF=origin/main node ./scripts/check-concept-owners.mjs` 通过（**411 个概念：converged 407 / pending 4 · 写接口 1083 个 · 第二写口 0 新增**）。
