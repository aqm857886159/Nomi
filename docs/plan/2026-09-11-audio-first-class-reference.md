# 音频参考一等公民化（声音节点连不上视频节点 + ComfyUI 音频输入用不了）

> 📎 状态：代码修复 + 单测 + 走查已跑，验收证据在 `AUDIO-LAST.md` · 2026-09-11
> 分支：fix/audio-first-class-reference-20260911
> 基线：origin/main 9809892c5（Merge PR #722）
> 合同：`docs/fixes/2026-09-11-audio-reference-slot-gate.root-cause.json`（schema v3，`check:root-cause-contracts` 绿）
> 验收：`npx vitest run` 全量绿（12125+ 用例）+ `pnpm run typecheck`/`lint:ci` 绿 + `tests/ux/audio-reference-connect.walk.mjs` 真机走查
> 不动项：不改任何模型档案的参考槽声明本身（audio_ref 早就声明好了，问题只在门岗）；不新增 ComfyUI 音频角色的旧式单槽（沿用已有的通用 images[] 多媒体列表机制）

## 用户摩擦（D1）

两条反馈本质是同一件事的两种表现：
1. **「声音节点连不了视频节点」**——用户想把「声音」节点当参考拖给 Seedance 全能参考（omni）的镜头节点，画布直接拒绝这条连线，即使 Seedance 2.0 早就声明了「参考音频」槽（最多 3 段）。
2. **「ComfyUI 音频输入用不了」**——导入一条带 `LoadAudio` 节点的 ComfyUI 工作流，那个音频输入没有被识别成可拖拽的媒体槽，退化成一个裸文本框，用户得手填 ComfyUI 内部的文件名。

两条反馈的用户体感一致：**模型/工作流明明能吃音频参考，界面却像是从没考虑过音频这种东西。**

## 先查别人

1. Seedance 2.0 omni 模式官方文档（Volcengine 方舟）——`electron/config/modelArchetypes/seedance20Contract.test.ts:9-19` 已引用其原文核实过：omni 支持最多 3 段参考音频，但**不支持纯音频输入**，必须搭配参考图或参考视频（`requiresAnyOf: ["image_ref","video_ref"]`）。本次没有重新去抓官方页面，因为这条约束早就被 2026-08-20 那次修复核实并落进 `electron/shared/videoCapabilities/seedance.ts:96` 的注释和 `seedance20Contract.test.ts`；本次改动**沿用**这条约束，不解除它——单独连一条音频边到 omni 节点上，`canRunGenerationNode` 理应继续判「不可生成」，这是诚实的产品行为，不是本次要修的 bug（走查第②步专门验证了这一点没被误伤）。
2. ComfyUI 官方 `LoadAudio` 节点源码——`https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_extras/nodes_audio.py`（2026-09-11 抓取核实）：`node_id="LoadAudio"`，文件名输入键叫 `audio`（`IO.Combo.Input("audio", upload=IO.UploadType.audio, ...)`）。这与仓内 `MEDIA_INPUT_KEYS` 早就收着的 `"audio"` 键名完全对得上——**扫描器的键名允许列表两年前就等着这一天，只是从来没配上 class_type 识别正则**，是本次修复最直接的证据。
3. 仓内教训 `docs/lessons/nomi-reference-slots-are-already-declarative.md:8`——「这套数据已经是声明式的、渲染器也已拍板存在，别新建抽象」：参考槽是声明式数据，六种 slot kind 早有渲染器，不该给某个模型另写特例 UI（P4）。本次修复严格遵守这条：**只改共享门岗（谁能当参考源、槽收不收这个资产类型），不碰任何单个模型的展示逻辑**——`AssetReference.tsx`/`NodeParameterControls.tsx` 早已是通用 `AssetKind`（含 `audio`）驱动，一行都没改。

## 根因（R21）

最初的用户反馈只点名了两个文件（`anchorPolicy.ts`/`comfyuiWorkflowImport.ts`）；本次按 `.agents/skills/root-cause-remediation/SKILL.md` 走查了一遍完整脉络，发现问题比这两个文件能覆盖的更广：**同一类「media kind 被写死成二选一（image/video）」的假设，在至少 6 个独立的共享边界各自出现过一次**，不是最初点名的 2 个文件就能修完。完整清单、`generality_proof`、`same_class_entry_points`、`recurrence.same_class_scan` 都在 `docs/fixes/2026-09-11-audio-reference-slot-gate.root-cause.json` 里，这里只摘要：

- **画布连线门（issue #1/#2 的根因）**：`src/config/modelArchetypes/anchorPolicy.ts` 的 `ReferenceAssetKind` 类型只有 `'image'|'video'`，`SLOT_ACCEPTS.audio_ref` 是空数组；`src/workbench/generationCanvas/agent/referenceEdgeCapability.ts` 的 `referenceAssetKindForNode` 从不把执行类型是 `audio` 的节点、或 `result.type==='audio'` 的导入素材节点归类成任何资产类型。两处任何一处不修都连不上。
- **ComfyUI 扫描器（issue #3 的根因）**：`electron/catalog/comfyuiWorkflowImport.ts` 有 `LOAD_IMAGE_RE`/`LOAD_VIDEO_RE`，独独没有 `LOAD_AUDIO_RE`，`isMediaInput` 永远判 false。
- **两道下游校验会把音频声明整份吃掉，不只是那一个槽**：`electron/catalog/parameterReferenceContract.ts` 的 `readParameterReferenceContract` 和 `src/config/modelCatalogMeta.ts` 的 `parseModelParameterControlsAtomic` 都显式把 `mediaKind !== 'image' && !== 'video'` 判成非法值——一旦 ComfyUI 工作流里有一个 LoadAudio 节点，**整份 `parameterReferenceSlots` 契约作废**，退回旧启发式，不是只丢音频那一个槽（这个连带范围报告没提到，是本次深挖出来的）。
- **两个更隐蔽的第二现场**：`electron/catalog/comfyuiWorkflowTaskContract.ts` 的 `resolveComfyWorkflowTaskKind` 用 `mediaKind !== 'video'` 判「有没有图输入」，会把纯音频输入的工作流错误地当成「有图输入」去选 taskKind；`src/ui/onboarding/comfyuiWorkflowBinding.ts` 的旧角色菜单会给音频输入错误地提供「设为首帧/尾帧」选项。这两处不是报告点名的文件，是本次按 P2「同类问题还能从另一个调用者回来吗」逐一顺藤摸瓜找到的。
- **四份测试文件里各自把「mediaKind:audio 无效」写成了预期行为**——`electron/catalog/parameterReferenceContract.test.ts`、`electron/catalog/comfyuiMediaWire.test.ts`、`src/config/modelCatalogMeta.test.ts`、`src/workbench/generationCanvas/model/parameterReferenceSlots.test.ts`。这是本次最有力的「recurring」证据：同一个不变量缺口被四个不同的人在四个不同的时间点各自撞到、各自写了一条断言把它钉死成"预期"，而不是同一个 bug 报了四次。

## 做法（已完成）

1. **先红后绿**：新增两条类级回归测试再改代码——`src/config/modelArchetypes/anchorPolicy.slotCoverage.test.ts`（扫描所有档案声明过的 slot kind，断言 `SLOT_ACCEPTS` 没有空的）、`referenceEdgeCapability.test.ts` 里新增一条扫描 `GENERATION_NODE_KINDS` 的穷举测试（executionKind 落在 image/video/audio 定义域内的节点都必须被分类器认得）。改代码前跑过一遍确认它们精确地在 `audio_ref: []` 那一行红。
2. **画布连线门**：`ReferenceAssetKind` 加 `'audio'`；`SLOT_ACCEPTS.audio_ref` 从 `[]` 改成 `['audio']`；`referenceAssetKindForNode` 的执行类型分支加 `audio`，导入素材分支的 `result.type` 判断从二选一改成三选一（之前只分 video/image，遗漏了直接拖音频文件当素材节点的情形）。
3. **ComfyUI 扫描器**：加 `LOAD_AUDIO_RE = /loadaudio/i`（对照 ComfyUI 官方源码核实过 class_type 和输入键），`isMediaInput`/`mediaKind` 赋值纳入；`stillInputs`（首尾帧候选池）显式排掉音频，防止唯一的音频输入被首尾帧启发式误当首帧图。
4. **下游校验放行**：`parameterReferenceContract.ts`/`modelCatalogMeta.ts` 的 `mediaKind` 校验从二选一改成三选一（image/video/audio），不再因为一个音频槽把整份声明判非法或静默丢字段。
5. **顺带修的两个第二现场**：`resolveComfyWorkflowTaskKind` 的 `hasImageInput` 判据从 `!== 'video'` 改成 `=== 'image' || undefined`（不再把纯音频工作流错判成有图输入）；`comfyuiWorkflowBinding.ts` 的角色菜单给音频输入加了显式分支（不再提供首尾帧这两个不适用的旧角色）。
6. **四份"曾把 audio 判非法"的测试改成正面用例**：不是删断言，是把断言反过来钉住新的正确行为，并把原本占着"非法值"位置的测试用例换成真正超出定义域的值（`model3d`），保住"未知 mediaKind 必须整份拒绝"这条覆盖不丢。
7. **`docs/fixes/2026-09-11-audio-reference-slot-gate.root-cause.json`**：schema v3 完整合同，`generality_proof`/`same_class_entry_points`/`recurrence.same_class_scan`/`invariant_owner_layer` 齐全，`pnpm run check:root-cause-contracts` 绿（6 个高风险生产文件全部覆盖）。
8. **第 7 个同类入口（`pnpm run check:i18n` 的 dead-key 门岗抓出来的，不是 grep 找到的）**：`src/workbench/generationCanvas/nodes/NodeParameterControls.tsx` 的 `handleSlotUpload`——ComfyUI 声明的音频参数槽上传器——原来也是二选一（video/image）三处分支（错误提示/缺 URL 提示/taskKind），音频槽拖错文件会显示「只能选择图片文件」这种文不对题的提示。改成三选一，并把此前已经加进 `generationCommon.ts` 但一直没人引用的 `audioOnly`/`missingAudioUrl` 两个键接上——这就是它们当初为什么会变成死键：写词条的时候接线漏了，直到走查前的验收扫描才被 `check:i18n` 拦下来。已补进合同的 `same_class_entry_points`。

## 验收

- **单测**：`npx vitest run` 全量 1328 个测试文件、12125+ 用例全绿（含新增/改写的约 20 条用例，覆盖画布连线、ComfyUI 扫描、请求体字段、跨槽依赖三处正反用例）。
- **类型/lint**：`pnpm run typecheck`（三个 tsconfig 全过）、`pnpm run lint:ci`（0 error，77 warning，均为改动前已存在的无关警告，未超棘臼线）。
- **真机走查**（R13）：`tests/ux/audio-reference-connect.walk.mjs`——单次冷启动 Electron（用 `initialLocalStorage` 在首次文档创建前注入跳过 onboarding 的三个开关，不用「起一次→关掉→再起一次」的旧写法），真实建「声音」节点 + 视频节点 + 图片素材节点，走真实 `connectNodes` + 真实点「全能参考」模式 tab + 真实点「模型」下拉：
  1. 零参考 → ↑ 灰（基线）；
  2. 只连声音节点参考边 → 边真的建上了（用户报的 bug 若未修，这一步会先报「声音节点连不了视频节点」）；↑ 仍灰，但 tooltip 正确显示「参考音频不能单独使用，还需要…」（诚实的产品约束，不是连不上）；
  3. 再连一段图片参考 → ↑ 变活；
  4. 干跑（零花费）复用生产同一份 `resolveGenerationReferences`/`buildArchetypeInputParams`，断言音频参考槽对应的请求字段（不 hardcode 键名——按 archetype 声明的 `inputKey` 动态取，隔离 profile 下实测默认模型是即梦 Seedance，字段是 `mm_audios`）真的带着这段声音的 URL。
  截图见 `tests/ux/shots/audio-reference-connect/`，花费见 `AUDIO-LAST.md`。走查刻意不挑死具体供应商/模型——新建视频节点拿到目录里哪个默认模型就用哪个，只要它声明了「全能参考」+ `audio_ref` 槽即可，验的是共享门岗，不是某个特定供应商（P4）。
- **真实付费出片**：`scripts/audio-ref-paid-smoke.mjs`——APIMart doubao-seedance-2.0 全能参考，真实图片 + 真实音频参考（`tests/ux/fixtures/test-upload.png` / `real-narration.mp3`），480p/5s 控制花费。结果见 `AUDIO-LAST.md`。

## 没有做的 / 有意不做的

- 没有解除 Seedance 2.0 omni「音频不能单独用」的供应商限制——那是官方文档写明的产品行为，不是 bug；2.5 系列已经解除（`OMNI_2_5` 那条 `unmet` 测试用例是 null），本次不动 2.0/2.5 的差异声明。
- 没有给 ComfyUI 音频输入新增一个"角色"概念（如 `audioNodeId`）——它和其余多参考输入一样走通用的 `images[]` 多媒体列表，不需要单独的角色语义，加了反而是重复造轮子（P4）。
