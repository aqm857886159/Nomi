j2-verify：通过

- 验收线：j2-verify
- 实现线：j2-impl
- 验收 HEAD：e38bfc6b82aaf6d5d0c3e2a98fd955c78fa4a397
- 验收范围：PR #1612（`fix/video-depth-no-steal-selection`，任务 J-2：提取深度不抢选中 + 权重下载与抽帧前占住项目互斥锁）
- 验收结论：代码 diff、根因合同、`door-map` 全部 8 扇写入口、3 组自动化单测（31/31 全绿）、3 项独立反例破坏变异与 6 张 `1280×800` 真窗口中英截图全部核验通过，无阻断项。

---

## 1. 代码与合同审查

核对 `git diff origin/main...e38bfc6b82aaf6d5d0c3e2a98fd955c78fa4a397` 全部 16 个变更文件：

1. **原子派生建卡不抢选中**：
   - `src/workbench/generationCanvas/model/derivedOutput.ts` 新增 `'video-depth'` 规则（源 `['video', 'asset']` + `sourceResultType: 'video'` → 目标 `['video']`），`derivedOutput.test.ts` 将 `videoDepth/startVideoDepthDerivation.ts` 纳入生产者结构断言。
   - `src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts` 删除原先裸调 `addNode` + `connectNodes` + `selectNode(derived.id)`，改为 `runAsSingleUndoStep` + `store.addDerivedOutput({ kind: 'video-depth', mode: 'reference', node: { ..., select: false } })`；单步 `undo()` 可同时撤回派生卡与出处边。
   - 建卡前先走 `hasActiveProjectDepthRun` 拦截同项目在途深度任务并触发 `reportFeedback(i18n.t('videoDepth.error.already-running'))`；纵深防线在主进程返回 `already-running` 时同步删掉瞬态空卡并提示，不留死卡。
   - 订阅 `onTaskCancelRequested(nodeId)` 并在用户撤销/删除在途卡时经 `bridge.cancel({ jobId: nodeId })` 通知主进程中止准备期任务；`videoDepthClient.ts` 在 `prepare` 前后与 catch 分支补齐 `shouldCancel()` 判断，下载期取消干净走 `'cancelled'` 分支删掉空白占位卡。
2. **主进程单项目互斥锁前移至首个异步操作前**：
   - `electron/video/depthVideoJob.ts` 的 `prepareVideoDepthJob` 在首个 `await`（`resolveVideoLocalPath`、`ffprobe`、`ensureVideoDepthModels`、`ffmpeg` 抽帧）前同步执行 `sessions.set(jobId, session)`，向 `ensureVideoDepthModels` 传入 `session.prepareAbort.signal`（已核实 `depthVideoModelCache.ts` 透传给 `ensureVerifiedAssets`）并跟踪 `session.prepareChild`。
   - `cancelVideoDepthJob` 支持按 `session.jobId` 或 `session.nodeId`（以及 `projectId`）命中准备期会话；`disposeSession` 幂等地中止 `prepareAbort`、终止子进程/编码器、清理源临时副本与 `workDir` 并 `sessions.delete(session.jobId)`（按 `jobId` 删除，不会误删取消后立即重开的新会话锁）。
   - `depthVideoIpc.ts` 未扩宽 preload/IPC 通道，保留 `assertTrustedSender` 与 `registerQuitDrain`。
3. **规则登记与根因合同**：
   - `docs/fixes/2026-11-22-video-depth-no-steal-selection.root-cause.json`（`schema_version: 3`, `detected_by: "walkthrough"`）及两份 `docs/engineering/concept-owners/*.json` 已同提交落仓，`node ./scripts/check-root-cause-contracts.mjs --base origin/main` 0 报错通过。

---

## 2. 独立实跑命令与输出摘要

### 2.1 三组回归单测（`31/31` 全绿）

命令：
```text
pnpm exec vitest run electron/video/depthVideoJob.test.ts src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.test.tsx src/workbench/generationCanvas/model/derivedOutput.test.ts
```

实跑输出摘要：
```text
 ✓ src/workbench/generationCanvas/model/derivedOutput.test.ts (23 tests) 1388ms
 ✓ electron/video/depthVideoJob.test.ts (4 tests) 57ms
 ✓ src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.test.tsx (4 tests) 313ms

 Test Files  3 passed (3)
      Tests  31 passed (31)
```

### 2.2 `addDerivedOutput` 全部入口与保护出口核对

命令：
```text
node scripts/door-map.mjs addDerivedOutput
```

实跑结果：`扫了 3177 个文件（roots=src,electron，不含测试）`，共 **写入口 8 扇 · 读入口 3 扇（13 处出现）**。逐一核对源码与 `git diff origin/main...e38bfc6b82aaf6d5d0c3e2a98fd955c78fa4a397`，确认其余 7 个既有写入口零改动、语义逐字不变：

| 写入口调用点 | 源码实际 `kind` | `node.select` 传参 | 是否改动 |
|---|---|---|---|
| `src/workbench/generationCanvas/nodes/ClipNode.tsx:443`（保护出口） | `'clip-export'` | 显式 `select: false` | 否（原样保护） |
| `src/workbench/generationCanvas/nodes/whiteboard/InlineWhiteboard.tsx:271` | `'whiteboard-snapshot'` | 显式 `select: false` | 否（原样保护） |
| `src/workbench/generationCanvas/nodes/director/DirectorNode.tsx:116` | `'director-output'` | 未传（默认 `select: true`） | 否 |
| `src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:100` | `'video-frame'` | 未传（默认 `select: true`，后置 `selectNode`） | 否 |
| `src/workbench/generationCanvas/nodes/shotTable/factBridge.ts:80` | `'shot-table'` | 未传（默认 `select: true`，后置 `selectNodes`） | 否 |
| `src/workbench/generationCanvas/nodes/trimVideoToNode.ts:73` | `'video-trim'` | 未传（默认 `select: true`） | 否 |
| `src/workbench/generationCanvas/nodes/useNodePanoramaHandlers.ts:67` | `'panorama-screenshot'` | 未传（默认 `select: true`） | 否 |
| `src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts:126` | `'video-depth'` | **显式 `select: false`** | **本 PR 目标路径** |

> 注：PR 正文汇总表对其中 3 个未改动入口的 `kind` 笔误写成了别名（`'director-plan'` / `'shot-generation'` / `'panorama-view'`），核对源码实际字符串为 `'director-output'` / `'shot-table'` / `'panorama-screenshot'`，上述文件均未改动且功能无影响。

---

## 3. 独立反例破坏（变异）测试

独立对生产代码施加 3 项破坏性变异并实跑单测，验证断言均为真守卫（非空过）：

| 编号 | 独立变异操作 | 实跑命令 | 预期 | 实测结果 |
|---|---|---|---|---|
| V1 | 将 `src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts:139` 的 `select: false` 改为 `select: true` | `pnpm exec vitest run src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.test.tsx` | 红 | **实测必红（2 failed / 4）**：Test B1 在 `:381` 报 `expected [ 'gen-v2-video-...' ] to deeply equal [ 'source-shot' ]`（空派生卡误挂 `NodeGenerationComposer`）；Test B2 在 `:414` 报 `expected [ 'gen-v2-video-...' ] to deeply equal [ 'gen-v2-shot_table-...' ]`（拆解表选中态被抢） |
| V2 | 将 `electron/video/depthVideoJob.ts:210` 的 `sessions.set(jobId, session)` 后移到 `ensureVideoDepthModels` 之后 | `pnpm exec vitest run electron/video/depthVideoJob.test.ts` | 红 | **实测必红（2 failed / 4）**：下载期重入用例在 `:157` 报 `expected 2 to be 1`（并发拉起第 2 次权重下载）；下载期取消用例在 `:215` 报 `expected false to be true`（`observedSignal?.aborted` 为 `false`，未中止下载流） |
| V3 | 注释 `electron/video/depthVideoJob.ts:172` 的 `disposeSession` 内 `sessions.delete(session.jobId)`（模拟失败/取消后不释放锁） | `pnpm exec vitest run electron/video/depthVideoJob.test.ts` | 红 | **实测必红（3 failed / 4）**：失败后重试与取消后重试立即被旧锁永久卡死，抛出 `VideoDepthJobError: project proj-1 already has job ...`（`code: 'already-running'`） |

全部 3 项变异验证后已执行 `git checkout -- .` 完整恢复，核查 `git status` 工作区干净、`git rev-parse HEAD` 为 `e38bfc6b82aaf6d5d0c3e2a98fd955c78fa4a397`。

---

## 4. 6 张真窗口截图目视核对

已逐张亲眼核验 `docs/evidence/2026-11-22-video-depth-no-steal-selection/` 下全部 6 张 `1280×800`（`zoom ≈ 2.0`）截图：

1. `before-s1-zoom200-zh.png`（修前单视频 `zh-CN`，`200%`）：源视频「推门走进来」失去选中态，顶部浮条与底部生成框均消失，画布退回未选中底栏；右侧空派生卡处于选中并出现右上角小工具条与转圈态，右侧边缘胶囊显示「新节点在右侧 →」。复现了原缺陷。
2. `after-s1-zoom200-zh.png`（修后单视频 `zh-CN`，`206%`）：源视频「推门走进来」保持选中，顶部浮条（`截帧 ∨`、`剪辑`、`拆解 ∨`、`提取深度` 等）、视频播放控制条及底部生成框（`推门走进来`、`即梦 Seedance (会员) 快速`、`文生视频`、`16:9 · 5s`）完整常驻；最右侧派生卡转圈中、未抢选中且未挂生成框；全屏纯中文无英文串味。
3. `after-s1-zoom200-en.png`（修后单视频 `en`，`206%`）：源视频 `Walk through the door` 保持选中，浮条（`Capture frame ∨`、`Trim`、`Break down ∨`、`Extract depth`）、播放条与底部生成框（`Dreamina Seedance (membershi...`、`16:9 · 5s`）常驻；边缘胶囊显示 `New node to the right →`；最右侧派生卡未抢选中且未挂生成框；全屏纯英文无中文串味。
4. `before-s2-zoom200-zh.png`（修前带右侧拆解表 `zh-CN`，`201%`）：点完「提取深度」后源视频选中态丢失、浮条与底部生成框消失，画布底栏出现且下方显示「新节点在下方 ↓」。复现了原缺陷。
5. `after-s2-zoom200-zh.png`（修后带右侧拆解表 `zh-CN`，`205%`）：源视频「推门走进来」保持选中，浮条与底部生成框常驻，边缘胶囊显示「新节点在下方 ↓」（`A③` 胶囊与底部生成框的避让位置按 #1586 拍板边界不在本 PR 范围内）；全屏纯中文无串味。
6. `after-s2-zoom200-en.png`（修后带右侧拆解表 `en`，`205%`）：源视频 `Walk through the door` 保持选中，浮条（`Capture frame ∨`、`Trim`、`Break down ∨`、`Extract depth`）与底部生成框常驻，边缘胶囊显示 `New node below ↓`，全屏纯英文无中文串味。

---

## 5. 结论

PR #1612（HEAD `e38bfc6b82aaf6d5d0c3e2a98fd955c78fa4a397`）完整落实任务 J-2「方案 B」要求，所有单测、结构守卫、3 项独立反例变异、保护出口与 6 张中英真窗口截图均独立核验通过，**判定：通过**。
