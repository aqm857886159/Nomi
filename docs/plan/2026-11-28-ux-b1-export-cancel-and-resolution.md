# 设计卡 · 预览顶栏导出外显分辨率规格与进行中原地取消（UX-B1）

```
改动名：预览顶栏导出 MP4 空闲外显分辨率规格 + 导出中单胶囊原地取消（UX-B1 / U-21）    线/负责人：impl-ux-b1    类别：[长跑][可打断]（含改交互与新增功能）
```

> 依据：`docs/plan/2026-11-28-ux-simple-audit-phase1.md`（`U-21` / `B1`）与协调拍板 `#1586#issuecomment-7225334636`。
> 核心约束：① 空闲态顶栏胶囊文字外显当前导出分辨率（`导出 MP4 · 1080p` / `Export MP4 · 1080p`，随 `exportResolution` 在 `1080p` 与 `720p` 间动态切换），同时保持 `aria-label` 为 `导出 MP4` / `Export MP4` 使全仓既有选择器零破坏；② 导出进行中不新增第 2 颗顶栏按钮，同一颗胶囊原地翻面为可点击的 `导出中 42% · 取消` / `Exporting 42% · Cancel`（窄窗收起时悬停提示点击取消），点击即真实终止主进程编码子进程树、清理临时与半截文件、不误下载半截 WebM、不弹红报错、遥测记 `cancel`，并干净回到空闲态可再次发起新导出。

## ★0 先查别人

- https://www.nngroup.com/articles/ten-usability-heuristics/ · Nielsen Norman Group（User Control and Freedom & Visibility of System Status）：长耗时操作必须同时露出当前进度与一键紧急出口，避免用户因误触长任务只能干等或强退软件 · **改了**：将 `ShellTopBar` 导出进行中原本 `loading={true}` 强制 `disabled` 锁死的胶囊改为可点击的单胶囊原地翻面 `导出中 N% · 取消`（仅在收到取消后的短暂收尾期 `cancelling` 禁用防连点重入）。
- https://screen.studio/ 与 https://www.descript.com/ · Screen Studio / Descript 轻量桌面视频导出实践：顶栏导出主按钮在点击前直接露出目标清晰度规格（如 `1080p`），避免创作者每次点开侧边面板确认分辨率 · **确认了**：预览顶栏空闲态胶囊可见文案改为 `导出 MP4 · {{resolution}}`（动态读取 `exportResolution`），不新增顶栏常驻下拉或第 2 颗按钮。
- `electron/export/exportJobIpc.ts:76-82`、`electron/export/exportJobs.ts:383-393`、`electron/export/mediaProbe.ts:120-146`、`src/workbench/preview/previewExportRequest.ts:19-93` · 仓库既有主进程导出取消 IPC（`nomi:exports:cancel` → `cancelExportJob`）、跨平台进程树终止 `terminateProcessTree` 与顶栏双向事件桥 · **改了**：补齐三处断点——① `ffmpegRunner.ts` 默认子进程启动脱离进程组并在 `AbortSignal` 触发时经 `terminateProcessTree` 终止进程树且等 `close` 后再删 `.partial.mp4`；② `exportJobs.ts` 的 `finishExportTempInput` 在已由 `cancelExportJob` 标为 `cancelled` 时不再二次调 `cancelJob` 抛状态机错，统一以 `ExportCancelledError` 收尾；③ `exportApi.ts` 与 `timelineWebmExport.ts` 接入 `AbortSignal` 与单源 `isExportCancelledError` 判据，取消时记遥测 `cancel`、绝不触发 `downloadTimelineBlob` 兜底下载半截 WebM、绝不弹失败报错。
- 出口：electron/export/exportJobIpc.ts:76 · 导出长任务执行期间提供单胶囊原地取消出口，点击即通知主进程终止编码子进程树并清理半成品后解锁重发 · 改了：将预览顶栏忙态原本禁用的导出胶囊改为可点击取消出口，仅在进程终止收尾瞬间防连点禁用，收尾后立即恢复空闲可重发状态

## 设计卡全表（★0 + ★1–★9）

| 格 | 结论 | 证据 |
|---|---|---|
| **★0 先查别人** | 见上方 3 条带出处调研（NN/g 用户控制自由度、Screen Studio / Descript 轻量导出规格外显、仓库既有 `exportJobIpc` / `terminateProcessTree` / `previewExportRequest` 链路）及 `出口：` 行。 | `electron/export/exportJobIpc.ts:76` · `electron/export/mediaProbe.ts:120` · `src/workbench/preview/previewExportRequest.ts:19` |
| **★1 用户怎么用** | 当创作者在预览页准备导出成片或误触长视频导出时，我想在点导出前一眼看清当前是 `1080p` 还是 `720p`，并在导出途中点同一颗胶囊立即取消且不留半截垃圾文件，以便改完字幕或分辨率后马上重导。步骤：① 进预览页见顶栏显示 `导出 MP4 · 1080p`（右侧属性栏切 `720p` 时同步变为 `导出 MP4 · 720p`）→ ② 点击开始导出，胶囊原地翻面为旋转加载标 + `导出中 N% · 取消` → ③ 发现漏改字幕，点击该胶囊触发取消 → ④ 胶囊短暂显示 `正在取消…`（防重入），主进程杀掉 `ffmpeg` 进程树并清理 `.partial.mp4` 与临时输入 → ⑤ 胶囊干净恢复 `导出 MP4 · 1080p`，无报错横幅或错误 Toast → ⑥ 再次点击正常完成完整 MP4 导出。**不做什么 + 已知坑**：不新增第 2 颗顶栏按钮；不改动空时间轴禁用规则；空闲态 `aria-label` 保持 `导出 MP4` / `Export MP4` 不破坏全仓选择器；不在取消时误触发 WebM 兜底下载。**真实任务**：① 1080p 本地视频时间轴导出途中点击顶栏胶囊取消，核验 `exports/` 无残留文件后立即重导成功；② 属性栏切 `720p` 核验顶栏外显 `导出 MP4 · 720p`，并在 `700px` 窄窗下核验自动收成纯图标且悬停可读。**指标与量具**：目标「消除导出前分辨率盲猜与误导长片干等」→ 信号「顶栏直读规格 + 1 击中止无报错恢复」→ 主指标：中途取消后无残留半成品且可立即重导成功率 `100%`（量具：`tests/ux/preview-export-busy.walk.mjs` + `src/workbench/export/exportApi.test.ts`）；质量指标：主动取消误记 `export.completed(result='failure')` 比例 `0%`（量具：`src/workbench/export/exportApi.test.ts` 遥测断言，事件 `export.completed` 记 `result: 'cancel'`）；护栏指标：`1100px` 宽窗 `exportCompact === false`、`700px` 窄窗 `exportCompact === true` 保持率 `100%`（量具：`tests/ux/window-narrow-shell.walk.mjs`）。 | `tests/ux/preview-export-busy.walk.mjs` · `tests/ux/window-narrow-shell.walk.mjs` · `src/workbench/export/exportApi.test.ts` |
| **★1b 连带界面** | ① 顶栏导出胶囊：空闲态显示 `导出 MP4 · 1080p` / `Export MP4 · 1080p`（悬停提示 `导出 MP4 · 16:9 · 1080p`），忙态显示 `导出中 42% · 取消` / `Exporting 42% · Cancel`（悬停与读屏提示 `正在导出（转码封装 · 42%）· 点击取消导出` / `Exporting (Encoding · 42%) · Click to cancel`），取消收尾中显示 `正在取消…` / `Cancelling…`；② 预览播放器底部进度条：忙态继续显示既有阶段文案与 `progressbar`，取消完成后随 `PREVIEW_EXPORT_IDLE` 一并收起；③ 通知与错误条：主动取消不弹 `MP4 已导出` Toast、不弹失败 Toast、不渲染 `[data-preview-export-error]` 红字；④ 任务中心（`TaskCenter`）：主进程作业转入 `status: 'cancelled'`（`outcome: 'cancelled'`，与任务中心点取消同源）；若从任务中心或 Agent 工具取消正在预览导出的作业，`exportApi.ts` 通过 `onEvent` / `ExportCancelledError` 同源识别为取消，顶栏胶囊同样干净回 `idle` 不弹红错。 | `src/ui/app-shell/shell/ShellTopBar.tsx` · `src/workbench/preview/TimelinePreview.tsx` · `src/workbench/taskCenter/exportJobTaskCenter.ts` |
| **★1c 老用户** | **不适用：不改任何持久化项目文件、设置 schema、导出清单 schema 或快捷键**。老项目已存的 `exportResolution`（缺省 `'1080p'`）与 `previewAspect` 打开即原样在顶栏显示，退回上一版无任何字段差异。 | `src/workbench/workbenchStore.ts`（零持久化结构变更） |
| **★2 谁说了算** | 共碰 **5 个概念**：① 导出取消真值判据 `export.cancellation-verdict` → 唯一跨进程 owner `electron/shared/contracts/exportTypes.ts#isExportCancelledError`（新登记，主进程与渲染层共用同一份 `ExportCancelledError` 与 `isExportCancelledError`，消除双进程重复定义，下游 `TimelinePreview` 只问 `isExportCancelledError`）；② 预览顶栏导出与取消通道 `preview.export-cancel-channel` → 唯一 owner `src/workbench/preview/previewExportRequest.ts#requestPreviewExportCancel`（新登记，承载 `requestPreviewExport` / `requestPreviewExportCancel` / `usePreviewExportState`）；③ 可导出资格 `preview.export-eligibility` → 既有 owner `src/workbench/preview/previewExportRequest.ts#canExportPreviewTimeline`；④ 导出完成回执 `preview.export-receipt` → 既有 owner `src/workbench/preview/previewExportFeedback.ts#reportPreviewExportSuccess`；⑤ 子进程树终止 `media.bounded-process` → 既有 owner `electron/export/mediaProbe.ts#terminateProcessTree`。到点/取消后由主进程 `cancelExportJob` + `ffmpegRunner` 负责杀尽进程树、删 `.partial.mp4` 与 `input.webm` 并落定 `cancelled` 终态；不存在靠「状态不见了」猜用户意图，取消一律走显式点击事件 / `AbortSignal` / `nomi:exports:cancel` IPC。门表由 `node scripts/door-map.mjs` 实测（见文末门表）。 | `docs/engineering/concept-owners/export.cancellation-verdict.json` · `docs/engineering/concept-owners/preview.export-cancel-channel.json` · `pnpm run check:concept-owners` |
| **★3 一致与复用** | 核查 `PR-UX3`（`docs/plan/2026-11-24-ux-simple-preview-ux3.md`）与 `WindowNarrow.board.json`（`topbar.export-icon`）：此前忙态因无前端取消通路才把按钮 `loading={true}` 禁用防静默吞点击；现按 `#1586#issuecomment-7225334636` 拍板**沿原双向桥方向扩充**：复用既有单颗 `WorkbenchButton`、既有 `previewExportRequest.ts` 外部存储、既有 `desktop.exports.cancel(jobId)` IPC 与既有 `terminateProcessTree`，不新建顶栏第二颗按钮、不新建全局 store、不引入第三方库。 | `pnpm run check:self-written` · `src/workbench/preview/previewExportRequest.ts` |
| **★4 全状态** | ① **空时间轴**：按钮 `disabled`，显示 `导出 MP4 · 1080p`，悬停提示 `先往时间轴放入至少一段素材`（下一步明确：点左侧镜头或拖素材入轨）；② **空闲可导**：黑底胶囊显示下载图标 + `导出 MP4 · 1080p`（或 `720p`），`aria-label="导出 MP4"`，悬停提示 `导出 MP4 · 16:9 · 1080p`；③ **导出进行中（加载）**：同一胶囊显示旋转 `IconLoader2` + `导出中 42% · 取消`（可点击），`aria-label` 与悬停提示说明当前阶段、百分比与点击取消；④ **取消中（`cancelling`）**：点击取消后立即显示旋转图标 + `正在取消…` / `Cancelling…` 并 `disabled` 防连点，收尾完即回状态②；⑤ **成功**：回状态②并弹既有 `MP4 已导出`（带 `打开文件夹`）；⑥ **失败**：回状态②并按原项目归属呈现内联红字或后台通知；⑦ **部分成功 / 过期**：不适用（单文件原子 `rename` 落盘，要么完整 `.mp4` 要么删除 `.partial.mp4`，无部分成功或过期态）；⑧ **能力不可用**：本机 `ffmpeg` / `ffprobe` 缺失时主进程返回明确重装提示（`MP4 编码组件缺失，请重新安装 Nomi`），素材损坏时点名具体文件名引导替换或重导。**撑开边界**：最长英文忙态 `Exporting 100% · Cancel` 在 `<1100px` 空间不足 12px 时由既有 `useTopbarYield` 第 ① 步自动收成 `28px` 纯图标圆钮（`w-7`），零挤压相邻控件；双语文案全在 `timelinePreview.ts`，零谈钱字眼。 | `src/i18n/locales/timelinePreview.ts` · `pnpm run check:i18n` · 双轨截图 |
| **5 中途表** | 导出全链路均为本机计算，**零模型调用、零额度扣费（所有打断下花费恒为「不扣费」）**：① **空闲态** × 停/关窗/断网/重启/连点：无后台导出；连点第 1 下进入导出、第 2 下触发取消；② **准备探测 / WebM 录制 / 分块上传中** × 点取消：立即触发 `AbortSignal` 停录/停传并调 `desktop.exports.cancel(jobId)` 删 `input.webm`，回空闲无回执；× 关窗/退出：主进程 `abortAllActiveExports()` 中止子进程；× 断网：本机导出不受影响照常完成；× 重启：下次启动 `ExportJobManager.hydrateProject` 将孤儿 active 作业 reap 为 `failed` 解锁新导出；③ **主进程编码中（`filtergraph` / `webm`）** × 点取消：调 `desktop.exports.cancel(jobId)` 经 `terminateProcessTree` 杀进程树、删 `.partial.mp4`，回空闲无报错；× 连点取消：`cancelling` 态按钮 `disabled` 且 `signal.aborted` 幂等忽略；④ **取消收尾中（`cancelling`）** × 关窗/重启/连点：按钮禁用忽略连点，子进程退出即删净 `.partial.mp4` 解锁。 | `electron/export/exportJobs.busy.test.ts` · `src/workbench/export/exportApi.test.ts` · `tests/ux/preview-export-busy.walk.mjs` |
| **6 外部数据与失败** | 外部输入仅本机项目媒体文件与打包随附的 `@ffmpeg-installer/ffmpeg` / `@ffprobe-installer/ffprobe` 子进程（规范：FFmpeg `-progress pipe:2` 行协议与 POSIX 进程组 / Windows `taskkill /T /F`）：① 用户主动取消：子进程非零退出但 `signal.aborted` 为真 → 归一为 `ExportCancelledError`，绝不误报编码器损坏；② 真实编码失败 / 磁盘满（`ENOSPC`）/ 素材损坏：保持原错误分类如实提示，不甩锅 API Key。 | `electron/export/ffmpegRunner.ts` · `electron/export/exportAssetProbe.ts` |
| **★7 性能** | **不适用（不新增画布/列表规模相关高频循环，仅单颗顶栏胶囊状态切换与既有异步 IPC 调用）**：① 新增操作：点击导出中的顶栏胶囊发起取消；② 最坏规模：含多段 1080p 视频与字幕轨的时间轴正在后台 `ffmpeg` 编码；③ 预算：点击取消到胶囊呈现 `正在取消…` 禁用态为纯内存 `useSyncExternalStore` 同步广播（`< 16ms`，渲染主线程 >50ms 长任务 `0` 个），主进程 `terminateProcessTree` 异步杀进程不阻塞 UI 线程；顶栏空闲分辨率读取 `useWorkbenchStore(s => s.exportResolution)` 标量选择器，播放头每帧推进不重渲顶栏；④ 性能场景：不新增独立性能场景（PR 正文 `perf-scenario` 写明不适用及具体理由，并在 `preview-export-busy.walk.mjs` 实测取消恢复闭环）。 | `src/ui/app-shell/shell/ShellTopBar.tsx` · `tests/ux/preview-export-busy.walk.mjs` |
| **8 真实条件** | ✅ macOS 隔离真窗口中文亮色（`zh-CN / light / 1280x800`）改前/改后对比截图（自己 `read_file` 核验）；✅ 英文界面暗色（`en / dark / 1280x800`）改前/改后对比截图（自己 `read_file` 核验）；✅ 最小窗口 `700x720` 与宽窗 `1100x800`（`tests/ux/window-narrow-shell.walk.mjs` 双轨实跑）；✅ 真实本机 1080p 视频经真 `ffmpeg` 导出 → 中途点击取消 → 立即重导成功（`tests/ux/preview-export-busy.walk.mjs`）；`unverified`：Windows 真机进程树 `taskkill`（由单测 `mediaProbe.test.ts` 覆盖桩验证）、干净安装包签名、真付费（本功能纯本地零付费）。 | 仓库外双轨截图 + `tests/ux/preview-export-busy.walk.mjs` + `tests/ux/window-narrow-shell.walk.mjs` |
| **拍板图清单** | 认领既有 `WindowNarrow` 板已实现元素 `topbar.export-icon`（`docs/design/boards/2026-11-07-window-narrow/WindowNarrow.board.json`，`1100px` 带字、`700px` 收成纯图标），不修改任何 `.board.json` 文件；双态胶囊交互由 `#1586#issuecomment-7225334636` 明确裁定。 | `pnpm run check:board-parity` · `tests/ux/window-narrow-shell.walk.mjs` |
| **★9 验收与回滚** | 独立验收由协调指派另一条线按下方 **C1–C10 验收清单与反例** 逐项盲验（先验「什么都不做」目标测试必红，注：本功能本身提供取消出口，「全部拦下」会阻断正常导出，故正常导出成功对照同在 C4/C8 必测）。回滚：单提交 `git revert <commit>` 即可无损退回（零持久化数据迁移）。 | 单测 + 真 Electron 走查 + 独立验收报告 |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## 验收清单与反例（动手前写全）

| 编号 | 检查项 / 反例 | 预期结果 | 自验命令 / 证据 |
|---|---|---|---|
| **C1** | 空闲态分辨率外显与动态跟随（`1080p` / `720p`）且不破坏既有 `aria-label` | 空闲且宽窗（`!exportCompact`）时按钮可见文案为 `导出 MP4 · 1080p` / `Export MP4 · 1080p`，切 `'720p'` 后变为 `导出 MP4 · 720p` / `Export MP4 · 720p`；`aria-label` 恒为 `导出 MP4` / `Export MP4`；空时间轴仍 `disabled` | `ShellTopBar.previewExport.test.tsx` · `preview-export-busy.walk.mjs` |
| **C2** | 导出忙态单胶囊原地翻面可点击（不新增第 2 颗顶栏按钮） | `[data-shell-topbar]` 内导出按钮始终只有 1 颗；`exportBusy && !cancelling` 时不 `disabled`，渲染旋转 `IconLoader2` + `导出中 N% · 取消` / `Exporting N% · Cancel`，点击发出取消请求并立即进入 `cancelling`（`正在取消…` + `disabled` 防连点） | `ShellTopBar.previewExport.test.tsx` · `preview-export-busy.walk.mjs` |
| **C3** | `filtergraph` 主路径中途取消真杀进程与清半成品 | `finishTempInput` 阻塞等待主进程 `ffmpeg` 期间触发 `signal.abort()` / `cancelExportJob`：立即调用 `desktop.exports.cancel(jobId)`，主进程经 `terminateProcessTree` 终止 `ffmpeg` 进程树、等进程退出后删净 `.partial.mp4`，`finishExportTempInput` 以 `ExportCancelledError`（而非 `"is cancelled and is not cancellable"`）拒绝，`exportApi` 记遥测 `'cancel'`（不记 `'failure'`） | `exportApi.test.ts` · `ffmpegRunner.test.ts` · `exportJobIpc.test.ts` |
| **C4** | **反例（WebM 降级路径中途取消绝不兜底下载半截 WebM）** | `backend === 'webm'` 在录制帧途中、分块 `writeTempInput` 途中、或 `finishTempInput` 转码途中触发取消：立即停录/停传并调 `desktop.exports.cancel(jobId)`，`downloadTimelineBlob` 调用次数 `= 0`，遥测记 `'cancel'`，而真实磁盘满错误仍保留 WebM 兜底下载与 `'failure'` 遥测 | `exportApi.test.ts` · `timelineWebmExport.test.ts` |
| **C5** | **反例（跨入口同源取消：任务中心 / Agent 取消正在预览导出的作业）** | 未点顶栏按钮、直接经 `desktop.exports.cancel(jobId)`（任务中心或 Agent `cancel_job`）取消当前导出时，`exportApi` 经 `onEvent` 快照 / `ExportCancelledError` 同源识别为取消，`TimelinePreview` 静默回 `PREVIEW_EXPORT_IDLE`，绝不弹红报错条或错误 Toast | `exportApi.test.ts` · `ShellTopBar.previewExport.test.tsx` |
| **C6** | **反例（`startJob` 探测窗口期极早点取消 + 取消后立即重发下一轮不串扰）** | 在 `startJob` 尚未返回 `jobId` 时点取消，待 `startJob` 返回后立即补调 `desktop.exports.cancel(jobId)` 释放同项目 active 锁；取消收尾完成后立即发起第 2 轮导出，第 1 轮收尾不覆盖第 2 轮状态且第 2 轮成功产出 MP4 | `exportApi.test.ts` · `preview-export-busy.walk.mjs` |
| **C7** | 窄窗让位护栏（`1100px` 宽窗 vs `700px` 窄窗） | `1100px` 下 `exportCompact === false`（带完整文字且与居中步骤器间距 ≥ 12px）；`700px` 下 `exportCompact === true`（收成 `28px` 纯图标圆钮，忙态显示旋转加载标且悬停 `BarTooltip` 提示点击取消） | `tests/ux/window-narrow-shell.walk.mjs` |
| **C8** | 真实 Electron 全链路走查（空闲规格 → 点导出 → 点取消 → 再导出成功） | `node tests/ux/preview-export-busy.walk.mjs` 实跑：空闲见 `导出 MP4 · 1080p` → 点导出见 `导出中 …% · 取消`（非 disabled）→ 点击真实取消 → `exports/` 目录 `0` 个残留 `.mp4` / `.partial.mp4`、无错误提示、按钮恢复可点 → 再次点击完整导出 1 个有效 `.mp4` | `node tests/ux/preview-export-busy.walk.mjs` |
| **C9** | 中英双轨改前/改后真窗口截图核验 + Design Lab 零漂移 | `zh-CN` 亮色与 `en` 暗色改前/改后空闲态与导出忙态截图（保存在仓库外）全部经 `read_file` 亲眼核验无折行、无截断、对比度清晰；`src/devlab/` 无 `workspaceMode="preview"` 引用，零基线漂移 | 仓库外双轨对比截图 |
| **C10** | 全套静态门岗与主进程导出测试全绿 | `electron/export/*.test.ts` 全套通过；`check:concept-owners`、`check:board-parity`、`check:tokens`、`check:boundaries`、`check:icon-semantics`、`check:i18n`、`typecheck`、`eslint --max-warnings=0` 全绿 | 门岗与 Vitest 命令 |

## 数门输出（开工前 `node scripts/door-map.mjs` 实测）

```json
[
  { "kind": "read", "path": "src/ui/app-shell/shell/ShellTopBar.tsx", "symbol": "exportResolution" },
  { "kind": "read", "path": "src/ui/app-shell/shell/ShellTopBar.tsx", "symbol": "requestPreviewExport" },
  { "kind": "read", "path": "src/workbench/preview/inspector/PreviewInspector.tsx", "symbol": "exportResolution" },
  { "kind": "read", "path": "src/workbench/preview/TimelinePreview.tsx", "symbol": "exportResolution" },
  { "kind": "read", "path": "src/workbench/timeline/agent/exportToolCall.ts", "symbol": "exportTimelineToMp4" },
  { "kind": "write", "path": "electron/export/exportJobIpc.ts", "symbol": "cancelExportJob" },
  { "kind": "write", "path": "src/workbench/generationCanvas/nodes/ClipNode.tsx", "symbol": "exportTimelineToMp4" },
  { "kind": "write", "path": "src/workbench/preview/previewExportRequest.ts", "symbol": "publishPreviewExportState" },
  { "kind": "write", "path": "src/workbench/preview/TimelinePreview.tsx", "symbol": "exportTimelineToMp4" },
  { "kind": "write", "path": "src/workbench/preview/TimelinePreview.tsx", "symbol": "publishPreviewExportState" },
  { "kind": "write", "path": "src/workbench/timeline/agent/exportToolCall.ts", "symbol": "exportTimelineToMp4" }
]
```
