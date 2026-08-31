# Workflow / Skill 生态调研与 Nomi 采用矩阵

日期：2026-08-22
范围：用户提供的共享调研、Nomi 当前代码、HyperFrames 官方仓库/skills、OpenChatCut、OpenScene、Dawn-Cut、OpenKlip、Runway、LTX、InvokeAI、ComfyUI、MCP/Claude Code 公开资料。

代码基线：`origin/main`=`d3bf0aba`，仓库 31 个 `SKILL.md`、7 个 `skill.json`；当前脏工作树的技能数量不能作为方案事实。已批准基线：[agentic production experience spec](/Users/aoqimin/Desktop/Nomi/docs/superpowers/specs/2026-08-08-agentic-production-experience-design.md)。

## 结论先行

不是把别人的 Skill 全部复制进 Nomi，也不是继续只写自己的长 Prompt。Nomi 应采用：

```text
Workflow = 用户任务的可保存执行 DAG
Skill = 某一步的方法、约束和检查
Template/Recipe = 用户可选择的风格/品牌/起点
Renderer = 把批准后的结构画出来
Run = 预算、异步任务、恢复和事件
Staging = 候选结果，Accept 后才进入 EditorDocument
```

所有外部 Skill 先经过 license/source/hash、输入输出 schema、工具白名单、静态扫描、golden fixture 和独立 QA；不能证明这些条件的资料只作为研究参考。

## 外部实现矩阵

| 来源 | 读到的真实做法 | Nomi 借什么 | 不照搬什么 |
|---|---|---|---|
| [OpenChatCut](https://github.com/0xsline/OpenChatCut) | status→target→load skill→edit session→read→proposal→review→apply；渐进暴露工具 | Proposal/Option/Operation、session、原子 undo、按需工具 | 不直接复用其项目状态或早期实现 |
| [OpenScene](https://github.com/Theorvane/openscene) | renderer 只做 UI；main 做 policy/approval/jobs；shared 做 timeline/composition | main/shared/renderer 分层、读自动写审批 | 不复制其 Electron 业务 |
| [Dawn-Cut](https://github.com/kwakseongjae/dawn-cut/blob/main/docs/P4-MCP.md) | open→manifest→plan/dry-run→apply→save→audit→render；hash-chain | dry-run 无 mutation、统一 CommandBus、幂等/破坏性标记 | 不把它的命令格式直接当 Nomi 合同 |
| [OpenKlip](https://github.com/craftled/openklip/blob/main/content/docs/agent-workflow.mdx) | read→plan→act→verify→done；core 工具默认，motion/cleanup 等按需 load；actions JSONL | progressive disclosure、模板 Skill、导出后 EDL/转录对账 | 不采用其平台限制 |
| [OpenReelio](https://github.com/openreelio/openreelio) | event sourcing、命令编辑、QC、只读默认 MCP；导出后验证 | 一个可回放命令/事件账本、黑帧/峰值/字幕 QC | 不复制其早期插件生态 |
| [Crayotter](https://github.com/idwts/Crayotter) | planner→素材准备→编辑研究→受控执行；DAG、资源并发、checkpoint/retry | 有界并发、资源冲突 key、失败恢复、计划审阅 | 不把实验性 agent loop 直接当 Nomi runtime |
| [Runway Agent Workflows](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent) | Skill 是引导方式；Workflow 是可保存、暴露输入、可重跑的节点资产；Agent Build/Run 分开 | Skill/Workflow 分离、exposedInputs、Ask-before-generate、节点历史/局部重跑 | 不把底层节点暴露给普通用户 |
| [LTX Flows](https://ltx.io/blog/ltx-studio-flows) | prompt→image→video→audio/upscale；分支、批量、smart cache | 依赖 DAG、变更影响分析、只重跑下游 | 不把 Flow 当故事决策稿 |
| [InvokeAI Workflows](https://invoke.ai/development/front-end/workflows/) | saved workflow 与 executable graph 分离；显式 Canvas Output；结果进入 staging 后 Accept/Discard | compile→enqueue、显式 outputBindings、候选暂存 | 不把 provider graph 当 EditorDocument |
| [ComfyUI](https://docs.comfy.org/development/core-concepts/route_overview) | template/object_info/workflow/history/queue 分层；custom node 有供应链风险 | capability preflight、不可变 execution snapshot、队列历史 | 不允许任意 custom node/文件/网络 |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | gateway→domain skills→workflow；HTML/data-* composition；seek-safe/deterministic；lint/check/snapshot/producer | motion skill 分层、composition source、preview/producer parity、seam/verify gate | 不复制 BRIEF/STORYBOARD/Studio 为第二个 Nomi 项目事实；不使用 hosted MCP 作后端 |
| [MCP primitives](https://modelcontextprotocol.io/specification/2025-06-18/index) / [Claude Code skills](https://code.claude.com/docs/en/features-overview) | Resources/Prompts/Tools/Elicitation；Skill 按需注入并可带模板/脚本/allowed tools | read context 与 write command 分离、单一 elicitation、skill progressive loading | 不让 session trust 越过 durable approval |
| [HeyGen video Skill](https://github.com/heygen-com/skills/blob/master/heygen-video/SKILL.md) / [Agentara storyboard](https://github.com/agentara/skills/blob/main/skills/aigc/video-storyboard/SKILL.md) | script 先审阅、媒体类型显式选择；panel/timecode/duration 与 shot 一一对账 | script gate、StoryboardContract、provider-neutral shot IR、时码守恒 | 不把某一平台的默认秒数/比例写进 Nomi |

## 可审计源码锚点

- OpenChatCut: `src/agent/proposal.ts`（Proposal→Option→Operation、baseDoc/stale）、`server/external-agent/mcp-tool-exposure.ts`（progressive `tools/list_changed`）。
- Dawn-Cut: `docs/P4-MCP.md`（`open→manifest→plan→dry_run→apply→save→render`、唯一 command bus、hash-chain audit）。
- OpenKlip: `content/docs/agent-workflow.mdx`（bounded context、actions JSONL、verify/re-transcribe）、`skills/openklip-motion-graphics/SKILL.md`（phrase/beat/cut/export/verify）。
- HyperFrames: `skills/motion-graphics/references/shot-plan-ir.md`（Director→Builder IR invariants）、`.claude/skills/motion-doctrine/SKILL.md`（vector ledger/seam-gate/audio clock）、`packages/core/docs/core.md`（HTML/data-* composition contract）、`packages/producer/src/services/renderOrchestrator.ts`（compile→probe→capture→encode）。
- InvokeAI: `docs/src/content/docs/development/Guides/workflow-api.mdx`（saved workflow→executable graph）、Canvas workflow docs（显式 Canvas Output→staging→Accept）。
- Nomi baseline: `electron/skills/skillStore.ts`（loader/hash）、`electron/ai/agentChatV2.ts`（当前正文注入/工具二分的缺口）、`electron/productionRun/productionPlaybooks.ts` 与 `productionRunDriverOps.ts`（当前 registry/driver 硬编码）、`electron/capabilityCore/mcpProtocol.ts`（MCP gate/resource/elicitation）。实施前必须以 `origin/main=d3bf0aba` 重新对账，不把脏 worktree 行为当事实。

## Nomi 的 Skill 组合方式

### 1. 后台自动加载的 Core Skills

这些解决安全、可恢复和真实性，用户不需要选：

- `asset.provenance`：assetId/version/parent/hash/来源；
- `prompt.compiler`：PromptSpec 分媒体类型编译；
- `model.capability`：真实时长、音频、参考图、画幅、并发和 key 状态；
- `visual.qa`：抽帧、连续性、字幕遮挡、转场边界；
- `audio.qa`：waveform、响度、静音、唇形/音画同步；
- `run.recovery`：幂等、providerTaskId、reconcile、重启恢复；
- `motion.safety`：HTML/JS/字体/资产白名单和 deterministic seek。

### 2. 用户选择的 Recipe / Style Pack

用户不选择“调用哪个 director skill”，而选择目标和感觉：

- `talking-head-tight`：转录→删停顿→字幕→B-roll→音乐；
- `product-launch`：产品锚点→短镜头→CTA→品牌动效；
- `documentary-restraint`：克制镜头、少转场、低密度花字；
- `tech-hud`：HyperFrames HUD/数字/图表/Logo；
- `mj-cinematic-motion`：静态图→轻推/视差/分层/标题合成；
- `ugc-fast-cut`：短节奏、字幕、音效、局部重排。

Recipe 只编译 SkillPack refs、默认 token、检查阈值和审批策略；不保存 live 项目状态，也不绑某个模型。

### 3. 高级用户导入的社区 Skill

导入流程：

```text
外部 SKILL.md / 代码 / 模板
  → skill-author 转写
  → 许可证和来源检查
  → schema/工具/权限静态扫描
  → golden fixtures + baseline 对照
  → sandbox 试跑
  → 用户显式启用
```

导入 Skill 默认 `read-only`；它不能自动获得 provider、文件、网络、shell、导出或项目写入权限。它产出 PromptSpec/EditCommand/QualityFinding，真正写入仍走 EditorCommandBus/ProductionRun。

## 按 Workflow 的 Skill DAG

| Workflow | Route | 计划/Prompt | 执行 | QA | 用户看到的选择 |
|---|---|---|---|---|---|
| `asset.single` | cover/image | design + brand + image prompt | image provider | image QA | 比例、风格、参考图、一次候选选择 |
| `asset.batch` | poster/batch | template + brand + row mapping | batch provider | sample/row QA | 一张样片、数量、并发、预算 |
| `asset.edit` | image edit | mask/region + preserve rules | image edit provider | before/after diff | 修改区域和版本 |
| `canvas.explore` | anchor exploration | art-design + consistency | canvas nodes | keyframe review | 方向卡、冻结一个 anchor |
| `motion.graphics` | short motion (<10s, usually no narration) | HyperFrames core/animation/creative + MotionDesignSpec | HyperFrames/Remotion | lint/check/smoke/parity | 一个代表样片/风格，一次 Adopt |
| `narrative.production` | script/storyboard | writer + director + continuity | image/video/audio jobs | shot/rough-cut/audio QA | 方向、剧本、分镜、合同/预算、粗剪 |
| `edit.assemble` | existing edit | transcription/talking-head/edit commands | local media + optional AI | timeline/EDL/audio QA | 受影响片段 Diff、应用/撤销 |

同一 Skill 可以被多个 Workflow 引用，但每次必须带 `workflowKind/stageId/inputHash/outputHash` 证据；不能因为 Skill 名字相同就共享一份可变状态。

## 外部 Skill 的 adopt / defer 判定

| 外部包/方法 | 归一后的用途 | 当前决定 |
|---|---|---|
| `visual-analysis`、`visual-quality-gate`、`aesthetic-audit` | 抽帧/波形/旅程/视觉问题分级的 QA checker | Adopt 为 Core check，产 `QualityReport`，不直接改项目 |
| `chatcut-video-gen`、`talking-head-guide`、`transcription`、`music`、`voice` | 能力 preflight、A-roll/字幕/音频路线、局部编辑 | Adopt 为 route/stage Skill，音频与视频分离 |
| `create-motion-graphics`、HyperFrames core/animation/keyframes/creative | MotionGraphicIR、代表样片、seek/seam/parity | Adopt 为 `motion.graphics`；HyperFrames 是 renderer adapter，不是第二编辑器 |
| `motion-interaction`、`thumbnail-cover-design`、`product-launch-video`、`app-promo-guide` | UI motion、cover.image、产品发布 recipe | Adopt 为可选 recipe/check；不常驻、不强行进入 narrative |
| `libtv-skill`、任意带 shell/network/provider script 的包 | 外部 connector/研究参考 | Defer；不能由 Nomi runtime 自动安装或执行 |

每一项落库时记录 `sourcePath/url/license/contentHash/route/stage/input/output/checks`；没有这些信息只能显示 research-only，不能在 UI 宣称“已调用”。

## 最小验收

1. `asset.single` 不加载 script/storyboard/视频生成阶段。
2. `motion.graphics` 对 MJ 静态图的轻推/视差走 HyperFrames；要求人物真实走动则路由 video-gen。
3. 任何 Skill 不能直接写 Timeline；只读分析自动执行，写入先 Proposal/Diff。
4. 改一个 MotionGraphic props 只重渲染该 artifact；原视频、原图和其它 clip hash 不变。
5. 运行日志分别记录 Workflow、Skill、Template、Renderer、Run、Artifact 和 DecisionRecord。
6. 外部 Agent 支持 elicitation 时不发生 Nomi 第二次确认；不支持时明确返回 Nomi takeover 深链，不能静默点桌面按钮。
