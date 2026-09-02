# 走查健康度普查（2026-09-02）

> 状态：📎 交接/日志（普查结果与候选池，不是方案）

## 为什么做这次普查

修 `library-language-switcher` 时发现类根因是**走查没有执行者**：189 份走查里只有 4 份在任何 CI 里，
产品按设计系统 §1.5 搬家后它们静默腐烂（详见
[根因合同](../fixes/2026-09-02-walkthroughs-rot-without-an-executor.root-cause.json)）。
用户拍板「挑关键零额度走查进 CI」后，需要知道**到底有多少走查现在还跑得动** —— 否则往 roster 里
加什么都是猜。

## 怎么跑的（限制先说清楚）

静态筛出 111 个零额度 + 确定性候选（排除依赖真实档案 / 烧额度 / 需真 key / 需本机 ComfyUI /
需打包产物 / live 共 29 个，另 5 个已在 roster），**并发 3、每条限时 180s、裸跑**（不给任何手工前置）。

三条必须知道的局限：
1. **裸跑**：有些走查文件头注释里写明需要人工前置（如先用 ffmpeg 造测试音频），裸跑必红 —— 这不是腐烂。
2. **并发 3 + 本机高负载**（普查期间 load average 曾达 52）：可能把耗时放大成假超时。
3. **macOS**：CI 是 Linux + xvfb。本仓有平台差异先例（canvas 性能预算在 macOS 校准、Linux 假回归；
   GH Windows runner 把窗口夹到下限）。**本地绿 ≠ CI 绿。**

## 结果

**48 条裸跑即绿 · 63 条红 · 其中 1 条超时。**

63 条红**不等于 63 条腐烂**。抽样 4 条单跑复核（无并发），四种不同成因：

| 走查 | 单跑结果 | 成因 |
|---|---|---|
| `asset-audio-upload` | 红 | **需手工前置**：要求先造 `probe-tone-3s.{mp3,flac,m4a}`。不是腐烂 |
| `asset-surface-convergence` | 13/14 PASS | **单条业务断言红**（`托盘可见捕捞素材`）—— 需人工判是腐烂还是真 bug |
| `agent-runtime-production` | 红 | `Execution context was destroyed…navigation` —— 时序类，疑 flake |
| `asset-transport-settings` | 红 | check 抛错，需读细节 |

所以腐烂的真实面**尚未测定**，需要逐条分诊。把这批红当成「63 处待修」上报是不负责任的。

## 候选池：48 条裸跑绿（供 roster 逐批扩充）

⚠️ 进 roster 前仍须满足准入门槛四条，且按 `tests/ux/ci-roster.mjs` 里定的纪律
**逐批加、每批先在真 CI 上跑绿一轮**。macOS 绿只是必要条件。

- `arrange-draft-cta.walk.mjs`
- `asset-library-native-import.walk.mjs`
- `b1-camera-move.walk.mjs`
- `canvas-batch-production.walk.mjs`
- `canvas-context-menu-click.walk.mjs`
- `canvas-node-context-menu.walk.mjs`
- `canvas-shortcuts.walk.mjs`
- `creation-editor-mount.walk.mjs`
- `creation-flow-fixes.walk.mjs`
- `custom-call-config.walk.mjs`
- `dark-audit.walk.mjs`
- `dark-journey.walk.mjs`
- `dark-mode.walk.mjs`
- `deep-link-navigate.walk.mjs`
- `draft-loop.walk.mjs`
- `f3-f16b.walk.mjs`
- `feedback-share-center.walk.mjs`
- `group-baseline.walk.mjs`
- `group-ports.walk.mjs`
- `group-reference-direction.walk.mjs`
- `header-refresh-capture.walk.mjs`
- `local-model-connect.walk.mjs`
- `model-onboarding.walk.mjs`
- `new-models-20260729.walk.mjs`
- `node-actions-off-image.walk.mjs`
- `onboarding-overlap.walk.mjs`
- `param-bar-geometry.walk.mjs`
- `param-bar-models.walk.mjs`
- `param-resolution.walk.mjs`
- `preview-control-scope.walk.mjs`
- `production-stalled-draft.walk.mjs`
- `prompt-picker.walk.mjs`
- `provider-proxy-field.walk.mjs`
- `reference-url-scheme-boot.walk.mjs`
- `runninghub-onboarding.walk.mjs`
- `scene3d-context-loss-recovery.walk.mjs`
- `scene3d-ux-shots.walk.mjs`
- `screenshot-hotkey.walk.mjs`
- `seedance25-apimart.walk.mjs`
- `selection-toolbar-vendor.walk.mjs`
- `skill-import-formats.walk.mjs`
- `storyboard-methodology.walk.mjs`
- `storyboard-trigger.walk.mjs`
- `tikhub-connector.walk.mjs`
- `timeline-visual-feedback.walk.mjs`
- `timeout-recover.walk.mjs`
- `visibility-i18n-batch.walk.mjs`
- `whiteboard-refactor.walk.mjs`
## 63 条红（待分诊，按文件名排序）

下表是**分诊线索**，不是结论。`tail` 是进程最后几行输出，截断到 110 字符。

| 走查 | 状态 | 尾部输出 |
|---|---|---|
| `agent-panel-system-prompt.walk.mjs` | 红 |  - waiting for locator('[aria-label="生成区 AI 助手"]').first() / 32 × locator resolved to <aside data-collapsed="f |
| `agent-runtime-production.walk.mjs` | 红 |  "unexpected": [], / "result": "failed", / "error": "Error: Timed out waiting for parent conversation request\ |
| `asset-audio-upload.walk.mjs` | 红 | 缺 .tmp/probe-tone-3s.{mp3,flac,m4a}，先用 ffmpeg 造（见文件头注释） |
| `asset-surface-convergence.walk.mjs` | 红 |  FAIL 托盘可见捕捞素材 / [shot] 07-tray-capture-inbox / [shot] 08-studio-with-browser / == 素材面收敛验收: 13/14 PASS == |
| `asset-transport-settings.walk.mjs` | 红 | 公共临时托管上传前提醒我 / 未配置 KIE 时仍可临时上传到公共托管；Nomi 会先告诉你托管方、有效期和隐私风险。 / at check (file:///Users/aoqimin/Desktop/nomi-lan |
| `asset-video-preview.walk.mjs` | 红 |  · 截图 02-all-assets-click-preview.png / ✗ 预览页单击视频素材后时间轴新增片段 — 0 → 0 / · 截图 03-preview-click-adds-video-to-time |
| `at-mention-edge.walk.mjs` | 红 | ❌ 3 条不达标: / - 可按视频节点标题过滤出视频候选 / - 选择视频候选后新增真实参考边 — 0 → 0 / - 首个视频引用 chip 显示「视频1」 — [] |
| `audio-timeline.walk.mjs` | 红 | 缺 .tmp/probe-tone-3s.mp3 |
| `browser-overlay-interaction.walk.mjs` | 红 | 素材盒浮层走查异常: Error: overlay window never appeared / at file:///Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/ |
| `canvas-control-clarity.walk.mjs` | 红 |  at Object.toBeVisible (/Users/aoqimin/Desktop/nomi-langwalk-fix/node_modules/.pnpm/playwright@1.60.0/node_mod |
| `clip-node-editing.walk.mjs` | 红 | {"result":{"isolatedClipDrag":true,"isolatedClipSelected":true,"isolatedClipActionsEnabled":true,"dragDoesNotM |
| `composer-long-prompt.walk.mjs` | 红 |  }, / "brokenScrollable": 0 / } / ✗ 4/21 项未过 |
| `contact-sheet.walk.mjs` | 红 |  at UtilityScript.evaluate (<anonymous>:304:16) / at UtilityScript.<anonymous> (<anonymous>:1:44) / at /Users/ |
| `creation-pill-overlap.walk.mjs` | 红 | {"viewport":"680x760","pillVsUndo":false,"pillVsRedo":false,"editorControlsEndBeforePill":false,"pillBox":{"x" |
| `custom-prompt-realtask.walk.mjs` | 红 | ✅ ③ 没用被禁的书面连接词 — 未出现 首先/其次/然后/总之 / ✅ ④ 与对照组产出不同 — 两次产出不一样 —— 提示词确实改变了行为 / ──────── 小结 ──────── / 1 项未通过：② 全程第二 |
| `default-generation-model.walk.mjs` | 红 | Error: WALK FAIL: 新建的卡片继承了设置里的默认模型 — 新卡是「D即梦图片（会员）」，设的是「GPT Image 2 · 文生图 · Kie.ai」 / at assert (file:///Users |
| `ia-audit-shots.walk.mjs` | 红 |  at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) { / code: 'ERR_AMBIGUOUS_MODU |
| `library-cover-imported-video.walk.mjs` | 红 |  at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) { / code: 'ERR_AMBIGUOUS_MODU |
| `local-gateway-onboarding.walk.mjs` | 红 |  ✗ laterVideoVerified / ✗ laterVideoVisibleByKind / ✗ laterVideoHasMapping / WALK FAIL: 本地网关接入或失败后继续验证回归 |
| `mention-scope.walk.mjs` | 红 |  → ProseMirror 实例: 2 / ✓ 选中目标后提示词框出现 — 2 个 / → 可见 composer 编辑器序号: -1 / ✗ 找得到 composer 里那个可见的提示词框 — -1 |
| `model-kind-misguess.walk.mjs` | 红 |  - done scrolling / - <div role="dialog" aria-label="设置" aria-modal="true" data-settings-overlay="true" class= |
| `model-pick-confirm.walk.mjs` | 红 |  at /Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/model-pick-confirm.walk.mjs:57:14 { / name: 'TimeoutErro |
| `omni-video-reference-gate.walk.mjs` | 红 | Error: element(s) not found / Call log: / - Expect "to.be.visible" with timeout 15000ms / - waiting for locato |
| `onboarding-auto-fetch.walk.mjs` | 红 |  · shot 01-panel-open / ✗ 找到「添加模型/中转站」入口 / ✗ 走查异常 — 入口未找到 / ═══ 接模型自动拉取 R13：0/2 通过 ═══ shots → tests/ux/shots/ |
| `onboarding-checkmark-honesty.walk.mjs` | 红 |  name: 'toBe', / pass: false / } / } |
| `plan-gate.walk.mjs` | 红 |  ✓ stdio MCP 服务起来了（探到运行中的 GUI） / ✓ 建项目（workspace-45418f8d-66f7-4d52-816a-8f7084c25e09） / · 外部 agent 发 nomi_add |
| `project-asset-healthcheck.walk.mjs` | 红 |  at /Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/project-asset-healthcheck.walk.mjs:107:19 { / name: 'Tim |
| `project-location-settings.walk.mjs` | 红 |  ❌ 设置页显示当前自定义目录 — /var/folders/f4/vz86j5nd0_sf56qdhzrmbbvw0000gn/T/project-location-settings-pZbb9z/projects / |
| `provider-adapter-doctor.walk.mjs` | 红 |  at ModuleJob.run (node:internal/modules/esm/module_job:430:25) / at async onImport.tracePromise.__proto__ (no |
| `provider-model-discovery.walk.mjs` | 红 |  ' - img' / } / } / Node.js v24.13.1 |
| `react-flow-read-only.walk.mjs` | 红 | ❌ 1 项失败: / - TimeoutError: locator.waitFor: Timeout 15000ms exceeded. / Call log: / - waiting for locator('.re |
| `reference-capture.walk.mjs` | 红 | 捕捞面收敛走查异常: locator.click: Timeout 2500ms exceeded. / Call log: / - waiting for locator('button[aria-label="并排显 |
| `reference-companion-required.walk.mjs` | 红 | ❌ 走查失败： WALK FAIL: 模型下拉里没有目标选项。实际选项：["D即梦 Seedance（会员）即梦"] |
| `remove-background.walk.mjs` | 红 |  ✓ 新建并进入项目 / ✗ 画板 modal + leafer 挂载（白板 churn 零回归） / ✓ 全程零 console error / pageerror / 抠图 R13: 4/7 通过 · console |
| `rich-editor-p1.walk.mjs` | 红 |  "detail": "分镜·2镜=0" / } / ] / 4 项未通过。截图在 /Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/shots/rich-editor- |
| `scene3d-camera-follow.walk.mjs` | 红 |  ✗ 开始录制 / FAIL: locator.boundingBox: Timeout 30000ms exceeded. / Call log: / - waiting for locator('[aria-labe |
| `scene3d-camera-move-ctxloss-recovery.walk.mjs` | 红 |  ✗ 开始录制 / FAIL: locator.waitFor: Timeout 5000ms exceeded. / Call log: / - waiting for locator('[aria-label="3D |
| `scene3d-camera-move-retry.walk.mjs` | 红 |  ✗ 开始录制（故障注入：第 1 次捕获强制失败） / FAIL: locator.waitFor: Timeout 5000ms exceeded. / Call log: / - waiting for locato |
| `scene3d-camera-possess.walk.mjs` | 红 |  ✗ 进入镜头操控态（角色动作库出现=否(对)） / FAIL: locator.boundingBox: Timeout 30000ms exceeded. / Call log: / - waiting for lo |
| `scene3d-character-drive.walk.mjs` | 红 |  ✗ 进入操控态（操控钮 count=0，动作库出现=false） / FAIL: locator.boundingBox: Timeout 30000ms exceeded. / Call log: / - waiti |
| `scene3d-cold-tasks.walk.mjs` | 红 |  at /Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/scene3d-cold-tasks.walk.mjs:40:73 { / name: 'TimeoutErro |
| `scene3d-exit-flush-recording.walk.mjs` | 红 |  exitedUI : ✓ / takePersisted : ✗ / mp4Made : ✗ / no console errors |
| `scene3d-pose-click.walk.mjs` | 红 |  ✗ 编辑器内截图（生成缩略图回写） / FAIL: locator.waitFor: Timeout 5000ms exceeded. / Call log: / - waiting for locator('[ari |
| `scene3d-pose-toggle-and-drive-keys.walk.mjs` | 红 |  ✗ 进入操控态 / FAIL: locator.click: Timeout 30000ms exceeded. / Call log: / - waiting for locator('[title="应用动作：挥手 |
| `scene3d-reference-pack.walk.mjs` | 红 |  ✓ 首/尾帧图片自动接入视频节点 (first_frame, last_frame, reference) / FAIL: locator.waitFor: Timeout 5000ms exceeded. / Cal |
| `scene3d-take-record-pose.walk.mjs` | 红 |  停止录制: ✓ / poseTrack 落盘: ✗ / 端到端出 mp4: ✗ / no console errors |
| `scene3d-take-record.walk.mjs` | 红 |  ✓ 停止录制 / FAIL: locator.waitFor: Timeout 5000ms exceeded. / Call log: / - waiting for locator('[aria-label="3D |
| `scene3d-toolbar-fit.walk.mjs` | 红 |  ✗ 添加菜单弹出 / ✗ 几何模型级联 / ✓ 点外收起 / 结果：{"editorOpen":false,"noScroll":true,"menuOpen":false,"cascadeOpen":false,"c |
| `scene3d-viewfinder-playback-marker.walk.mjs` | 红 |  阶段A 播放 marker 动: ✗（检测器有效性） / 取景进/出: ✓ / ✓ / 阶段B 往返后 marker 动: ✗（僵尸 ref 验收） / no console errors |
| `scene3d-walk-squat-walk.walk.mjs` | 红 |  squat 后 base 恢复帧: ✗ / 端到端出 mp4: ✗ / 抽帧成功: ✗ / no console errors |
| `scene3d-whitescreen-repro.walk.mjs` | 红 |  加第2假人后 canvas 不见? true err=0/0 / ✗ 异常：TimeoutError: locator.waitFor: Timeout 5000ms exceeded. / Call log: / - |
| `shot-cut-empty-states.walk.mjs` | 红 |  at async file:///Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/shot-cut-empty-states.walk.mjs:127:1 { / na |
| `shot-cuts.walk.mjs` | 红 |  · shot 07-canvas-final / · shot 08-group-final-zoom / ❌ 1 条不达标: / - 落了 3 个新节点 — 实得 1 |
| `spend-elicit-app-open.walk.mjs` | 红 | ✗ FAIL: GUI 写出了 instance 广告（）= isAppOpen() 为真 |
| `staging-pose-shots.walk.mjs` | 超时 |  ✓ 15-standoff: 6 视角 / ✓ 16-point-at: 6 视角 / ✓ 17-trio-mixed-pose: 6 视角 / ✓ 18-squat-stand: 6 视角 |
| `task-center.walk.mjs` | 红 |  → queue bridge: true / · shot 02-generation-area-empty-canvas / → nodes: 6 / ❌ 节点没加够（读到 6 个）——后续状态摆不出来，停。 |
| `toolbar-order.walk.mjs` | 红 |  at /Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/toolbar-order.walk.mjs:68:58 { / name: 'TimeoutError' /  |
| `vendor-baseurl-discoverability.walk.mjs` | 红 |  ' - img' / } / } / Node.js v24.13.1 |
| `vendor-connection-health.walk.mjs` | 红 |  [{"key":"modelscope","baseUrl":"http://127.0.0.1:51977/none","hasApiKey":true},{"key":"kie","baseUrl":"http:/ |
| `video-ops.walk.mjs` | 红 | 缺 .tmp/probe-12s.mp4，先用 ffmpeg 造一个 12s mp4 |
| `video-playback-heal.walk.mjs` | 红 |  at /Users/aoqimin/Desktop/nomi-langwalk-fix/tests/ux/video-playback-heal.walk.mjs:101:19 { / name: 'TimeoutEr |
| `volcengine-speech-credential.walk.mjs` | 红 | — 打开模型接入面板 + 展开所有组 — / ✗ 面板没打开 |
| `workbench-token-root-scope.walk.mjs` | 红 | Error: 工具 nomi_generate 失败：已暂停：当前客户端不支持弹确认，Nomi 也没打开——没有地方能确认这次付费生成。请打开 Nomi 后再触发生成。节点/提示词若已通过其它工具写入则已保存。 / at |
## 下一步（未做，不声称已做）

1. 逐条分诊上表 63 条：分出「真腐烂（锚点/断言与产品脱钩）」「需手工前置」「真 bug」「flake」四类。
   前两类的处置不同：腐烂要改走查或删，需前置的要么让走查自造前置、要么明确排除出 CI 范围。
2. roster 逐批扩充，每批以真 CI 一轮绿为准。
3. 本次已修的两条（`library-language-switcher` / `multi-user-isolation`）已在 roster 内。

## 普查副产品：走查会污染获批样张（未修）

跑完 111 条后 `git add -A`，一次带进 53 个截图，其中 **14 个是 `docs/design/mockups/` 下
已获批样张被覆盖**（`M` 不是 `A`）。也就是说：多条走查把自己的截图直接写进样张目录，
跑一遍就把用户拍板过的历史基准重写成当前 UI 的样子。

写入方（grep `docs/design/mockups` 命中）：`clip-node-clickable-mockup.e2e.mjs`、
`control-hierarchy-u2.walk.mjs`、`ia-audit-shots.walk.mjs`、`model-kind-misguess.walk.mjs`、
`image-grid-split-freeze.walk.mjs` 等。

**为什么这很危险**：样张的全部价值在于「它是拍板那一刻的样子」，R8 要求实现后与样张逐项对账。
基准被当前 UI 覆盖之后，对账变成「拿现状和现状比」，永远一致 —— 又一种假绿，
而且这次假的是设计验收环节。

**本轮处置**：只撤回了自己误提交的那 14 个覆盖（checkout 回 origin/main），
并给 `.gitignore` 补上 `.*-walk/` `.*-lab/`（原有 `tests/ux/shots/` 挡不住走查写在仓库根的目录）。
**没有**改走查的输出路径 —— 那要动多条走查，且要先定「走查产出该去哪」，超出本轮范围。

**建议的正解**：走查截图统一写进已被 gitignore 的目录（如 `tests/ux/shots/<walk-name>/`），
`docs/design/mockups/` 只接受人工放入的获批样张，并考虑加一道门岗：
走查源码里不许出现 `docs/design/mockups` 写入路径。

## roster 的第一个战果：i18n-sweep 抓到本地测不出的真缺口（2026-09-02 当天）

roster 上 CI 的**第一轮**就红了一条，而且红得有价值：

`i18n-sweep` 在 Linux CI 上 50/51，失败项 `[en] 侧栏·Prompt library · 无残留中文` ——
英文界面的提示词库里有 20 处中文（「表情预设」「GPT-4o 图像」「Sora 官方」「喜悦 1/5 · 一丝笑意」）。

**而我在 macOS 上跑了三次都是 51/51。** 差别不在平台，在**假绿**：
本地截图（`tests/ux/shots/i18n-sweep/en/05-prompt-library.png`）显示面板停在
「Fetching prompts from the public library…」——内容压根没加载出来，
于是「无残留中文」这条**不存在型断言恒真**。`expectNoCjkInEnglishDom` 没有 `provenBy` 基线，
正是 P6/R28 讲的那一类。CI 慢一些，内容加载出来了，才抓到。

这一条同时证明了两件事：
1. **roster 有用** —— 它抓到了本地怎么跑都测不出的东西。
2. **P6 有用** —— 我自己刚立完「会红才是证据」，转头就被一条没有基线的断言骗过，
   而且骗过了三次本地运行。准入门槛③「已实测跑绿」被假绿满足了。

### 处置与待办

`i18n-sweep` 已暂缓收编（理由与恢复条件写在 `tests/ux/ci-roster.mjs` 末尾），需要两件事：

1. **产品判断（需拍板）**：那 20 处字来自**远端公共提示词库的策展内容**，不是应用 UI 文案。
   `USER_CONTENT_ALLOW` 已经豁免了同性质的东西（创作区正文、画布节点标题=用户写的中文）。
   问题是「远端策展内容算不算该翻译的 UI 文案」——如果算，要服务端提供 en 版本；
   如果不算，给公共库容器一个 data 属性并加进豁免。这不能由走查单方面定。
2. **断言修基线**：`expectNoCjkInEnglishDom` 加 `provenBy`，先证明这一屏确实渲染出内容再断言无中文。
   否则即使做完 ①，它在慢机器/快机器上照样时绿时红，且绿的那次仍然是假的。

### 已闭环（当天）

两件都做完了，`i18n-sweep` 已加回 roster（5/5 全过）：

1. **豁免**：用户拍板远端策展内容不翻译。标记 `data-remote-content` 打在**渲染它们的那两层**
   （`PromptCard` 的标题/来源块、非「全部来源」的来源 chip），不是整个面板 ——
   面板自己的 UI 文案（标题/tab/搜索占位/空状态）必须继续被这张网抓。
2. **基线**：`assertSurfaceClean` 断言前先等 loading 指示（`role="status"`）散场，仍在转就**报红**。
   光做①不做②等于只治症状：下次换个更慢的面板照样假绿。

**阳性对照**：摘掉豁免后本地也抓到 18 处 CJK（CI 当时是 20 处，差在虚拟列表渲染行数）。
这证明面板确实渲染出了内容、豁免确实在起作用 —— 而不是又一次「没加载出来所以没看到」。
在此之前本地怎么跑都是 51/51，正是因为面板停在 loading。
