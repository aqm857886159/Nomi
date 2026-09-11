# B/C/D/E · 制作线深度（拉片合龙/管线硬化/资产包/对白 TTS）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 详版：[AdCraft 对比文档方案 B/C/D/E](../../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md) · 本文为执行卡片

## 先查别人

- 仓库里已有？—— 生产流程引擎已经存在：`electron/productionRun/productionPlaybooks.ts:33` 定义了 `brief→direction→script→storyboard→build→generate→qa→assemble→export` 九阶段 playbook；本方案「一句 brief→agent 跑完九阶段出粗剪 MP4」的验收目标是走通这条既有引擎，不是新建一套流水线。
- 仓库里已有？—— capability 路由 `electron/harness/agentChatPolicy.ts:80` 的 `agentToolsForCapability` 已存在，本文「角色化包装=纯 UI 投影」的判断依据是这条既有路由——角色只是给同一个 capability 的工具组换皮，不是真的多开一个 agent 实例。
- 生态里已有？—— [AdCraft 全面对比与方案](../../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md) 方案 B/C/D/E 一节已经把「拉片复刻」「管线硬化」「资产包」「对白 TTS」四条差异化叙事逐条核对过 AdCraft 的对应实现，本执行卡片是把那份对比落成分期任务，不是重新调研。
- 结论：制作线深度的四条线全部建立在已存在的 productionRun 引擎 + capability 路由之上，新增工作量集中在拆解面板 UI 与管线硬化的具体实现，不涉及新架构。

## B 拉片复刻合龙（P0→P2）

差异化叙事=「**对标素材库+拉片**」：#619 找参考（在飞）→ #259 拆解引擎（九成熟）→ 拆解面板 → 可编辑工作流 → 局部复刻。

- **B1（P0）**：按 2026-09-05 consolidation 拍板立拆解面板新方案+样张拍板（旧 2026-09-01 版 ⛔ 废弃）；引擎契约已定（`DeconstructVideoPayload/Result`，`visionFailed`/`carriedOver` 诚实标记），面板只消费。E2E：搜到对标→落项目→拆解→勾镜落画布→起稿。
- **B2（P1）**：镜头结构表→分镜表节点（`2026-09-07-storyboard-table-node.md` 形态），每镜提示词可改、整组喂参考重生成。
- **B3（P2）**：#232 局部复刻（复刻 5 秒/候选替换/RecreationApprovalEnvelope）接 M 线审批/预算/撤销链。**A 合龙前不动**。

## C 管线动词硬化（P0→P1，修正后射程）

productionRun 动词**已全套暴露**（`productionRunDescriptors.ts:12-96`）。剩余：① C0 真跑推过阶段 02（=方案 A）；② 步数上限重审（`agentChatV2.ts:102` 的 24/8/1，管线 capability 单独设档如 48）；③ 进度复用 #658 五段语汇投影阶段状态；④ 角色化包装=纯 UI 投影（借 AdCraft 节点类型→专家查表证据，零架构改动）。验收：一句 brief→agent 跑完九阶段出粗剪 MP4（R16）。

## D 角色/场景资产包规范（P1）

槽位化规范复用声明式参考槽（`ArchetypeReferenceSlot` 六 kind）：角色=正/侧/背三视图+面部+服装+配饰+色板；场景=定场/多机位镜头组。**服务端「出场权威」**（借 AdCraft `character_occurrence_authority`）：同角色跨镜由服务强制同一参考包，不靠提示词自觉。入口挂素材库既有分类（`libraryDiscovery.ts` 不动）。验收：一个角色资产包跨 3 镜身份一致（人眼）；资产包导出/导入。

## E 对白→TTS→音轨（P1）

`meta.dialogue`（现只落字幕）加「生成旁白」：按镜头时长选 TTS（MiniMax/ElevenLabs 已接，走既有认证）→音频落素材库→自动落 audio 轨对齐镜头、超限提示。BGM v1 手选（智能卡点见 P2 线 E'）。验收：8 镜脚本一键生成全部对白音频落轴，导出人声清晰对齐（R16）。
