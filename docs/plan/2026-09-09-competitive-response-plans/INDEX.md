# 竞品回应方案包 · 总索引

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 2026-09-09 定稿 · 依据：AdCraft 对标 + agent 原生剪辑版图 + 五仓核心架构对标（issue 实证）
> 汇总裁决文档：[竞品核心架构对标报告](../../research/2026-09-09-competitor-core-architecture-benchmark.md) · [主报告](../../product/2026-09-09-nomi-competitive-master-report.md)
> 本文是唯一开工入口；各方案文件自洽（目标/设计/落点/分期/验收门/回滚），细节溯源见文内链接。

## 先查别人

- 仓库里已有？—— agent 工具组按 capability 选、不按 skillKey 选的路由已经存在：`electron/harness/agentChatPolicy.ts:80` 的 `agentToolsForCapability`；本方案包「为什么方案里几乎没有『改 agent 本体』」一节直接建立在这个既有事实上——加剪辑能力=挂工具到某个 capability，不改运行时。
- 生态里已有？—— [竞品核心架构对标报告](../../research/2026-09-09-competitor-core-architecture-benchmark.md)（12 条失败模式 F1–F12，全部 issue 编号实证）与 [主报告](../../product/2026-09-09-nomi-competitive-master-report.md) 是本索引全部方案的裁决依据，两份文档已交叉核对过 AdCraft / Velorn / OpenChatCut / TimelineStudio 四个直接对手的架构取舍。
- 仓库里已有？—— [AdCraft 全面对比与方案](../../product/2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md) 的方案 A 是 P0-1（#646 三刀）的详版依据，两文件互相引用而不是各自重复调研。
- 结论：本索引本身不引入新方案立项判断，是把已经做过的两轮独立调研（竞品架构对标 + AdCraft 全面对比）汇成一张可执行的路线图；「边界（不做）」一节的四条禁止项均来自这两份调研里已验证过的教训（AGPL 许可、ComfyUI 绑定、Palmier 商务路线）。

## 全局瓶颈与开工纪律

**#646（agent 阶段 4 原子切换）过门之前，不开任何新战线。** 方案 A 是第一批里唯一的事。每条方案开工前过 P5（读真实外壳+样张拍板）；验收=R16 真实任务闭环+R13 走查；五门绿只是必要条件。先红后绿。

## 文件清单与路线图

| 文件 | 方案 | 优先级 | 依赖 | 出口判据 |
|---|---|---|---|---|
| [P0-1-agent-cutover-gate.md](P0-1-agent-cutover-gate.md) | A：#646 三刀（工具契约/审批卡/语言） | P0 | 无（#646 在飞） | L2 全绿+打包 C0 真短片一次通过 |
| [P0-2-timeline-write-contract.md](P0-2-timeline-write-contract.md) | A'+X1：时间轴写入契约（kernel 投影+一致性门） | P0 | #646 合并 | agent 完成「重排+trim+字幕+转场」真实剪辑 |
| [P0-3-transcript-layer.md](P0-3-transcript-layer.md) | B'+X2：transcript 层 | P0 | 无（引擎已有 whisper） | find_transcript 帧区间正确 |
| [P1-1-text-editing-serialization.md](P1-1-text-editing-serialization.md) | C'+X3：文本式剪辑+序列化双形态 | P1 | A'、B' | 口播「删文字=删视频」闭环 |
| [P1-2-verification-loop.md](P1-2-verification-loop.md) | D'+X5：验证环（帧回读+导出预检） | P1 | A' | agent 抽帧自检引用帧号 |
| [P1-3-production-depth.md](P1-3-production-depth.md) | B/C/D/E：拉片合龙/管线硬化/资产包/TTS | P1 | A（部分） | 对标视频→拆解→起稿；brief→粗剪 |
| [P2-versioning-markers-interop.md](P2-versioning-markers-interop.md) | F/F'/G'/G/M：版本/markers/互操作/预设流 | P2 | F 语义先行 | 候选回滚一致；剪映草稿可导出 |
| [P0-hardening-checklist.md](P0-hardening-checklist.md) | N1–N8：对标挖矿硬化清单 | N1–N3=P0 | 无 | 三条 P0 各自先红后绿 |
| **[IMPL-agent-tool-layer.md](IMPL-agent-tool-layer.md)** | **施工图：P0-2+P0-3 写码级细节（端口/契约/门/分期 T1–T4）** | P0 | #646 合并 | 真实任务三验收 |

## 批次

```
全局瓶颈：#646 过门（P0-1）
  └→ 第一批：P0-2 + P0-3 ∥ P0-hardening(N1–N3) ∥ P1-3 里的 B1（拆解面板立方案出样张）
       └→ 第二批：P1-1 + P1-2 ∥ P1-3 其余（C/D/E）
            └→ 第三批：P2 全部 + P1-3 的 B3（局部复刻接审批链）
```

## 为什么方案里几乎没有「改 agent 本体」

对——除了 P0-1，全部方案的 agent 侧工作都是「往 capability 工具组挂工具」，**这是设计成果不是遗漏**：运行时（循环/重试/队列/花费/崩溃恢复）由 pi AgentHarness 提供，能力按 capability 选工具组（`agentChatPolicy.ts:35`），P4 让模型与能力解耦——所以加剪辑能力=挂工具，不换芯。但「挂」的全部难度在契约层不在运行时：schema 形状/示例/容忍器/副作用声明（`reversal:"proposal"`）挂错一层，agent 就瘫痪（#646 三轮 C0 即证）。真正动 agent 本体的只有三处，都已列在方案里：A3 的 system prompt 装配（语言约束）、管线 capability 的步数上限设档（P1-3·C）、以及未入本轮的 R2-U1 跨区会话记忆。工具面超过 ~30 个时再上 ToolSearch 延迟激活（P2）。

## 边界（不做）

不抄 AdCraft 代码（非商业许可）；不建第二套流水线（productionRun 唯一引擎）；不做真·多 agent 实例（角色化=UI 投影）；不捆绑 ComfyUI 进程；不做直播切片/实时自回归/通用 NLE（变速/图层按 P2-…X4 治理判据排队）；不改 AGPL+商务服务路线（Palmier 教训）。
