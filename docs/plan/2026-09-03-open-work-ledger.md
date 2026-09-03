# Nomi 全量开工账本（2026-09-03）

> **状态：✅ 已交付**（盘点文档，一次性产出，不需持续更新）
> 盘点基准：`origin/main @ 5fb7bd07`（2026-09-03），结合 GitHub open PR 列表与 `docs/plan/INDEX.md` 全量扫描。
> 状态图例：🔴 阻塞/P0 | 🟡 进行中/在飞 | 🔵 已立项待排期 | 🧊 暂缓 | ⛔ 僵尸/建议关

---

## 总览（给编排者看）

**现在真正欠的 N 件，按优先级**：

1. **M 线继续推进（M 线 ProductionRun legacy 生成路裁决 → M2 余片收口 → M3 安全对抗 → M4 部署仿真）**：架构最核心、其他一切依赖它稳定。M3 已在飞但未完成；M4/M5 尚无代码落地。
2. **开放 PR 堰塞湖（11 个 OPEN PR，其中 3 个是 P0/高优）**：#380（技能导入 P0 回归）、#381（MCP L2 旅程）、#312（i18n 死键归零）需要优先合入。#298（通用 MCP 客户端）有贡献者在等回复。
3. **MCP 链路余账（J02/J04/J05/J06/J08/J12/J13 共 7 洞）**：生成链已修 2 个，10 个仍开；A 线（title+描述瘦身）是最快收益。
4. **供应商验证死路（缺口①）**：非 apimart/kie 平台存完 key 后无验证入口，用户死路——已有探针证据，待立项实现。
5. **架构三期（清 37 个硬环 + 建中立契约层）**：一期（门岗）已合 #273，二期（video 档案归一）已合 #310；三期未开工，是"改一点动一大堆"根治的真正入口。

**合理排序**：① 先合 P0 PR（#380/#381/#312）→ ② 裁决 ProductionRun legacy 路岔路（M 线 unblock）→ ③ M 线 M3 完成/M4 排期 → ④ MCP A 线（1-2天，可并行）→ ⑤ 供应商验证死路修复 → ⑥ 架构三期（需 M 线稳定后）→ ⑦ 其余僵尸计划逐步关档。

---

## ① 有主在飞

| 名称 | 状态 | 证据（PR/file） | 下一步 | 量级 |
|---|---|---|---|---|
| **M3 上下文工厂** | 🟡 已在 main（#372/#374/#376 已合）| PR #372/374/376 三片全合 | M4 部署仿真 + 创作者旅程排期 | M |
| **MCP L2 旅程完整 C7-C12** | 🟡 PR #381 OPEN，C7-C12 全绿证据 | PR #381；`tests/ux/mcp-l2-journeys.e2e.mjs` | 合入 main | S |
| **技能导入 IPC P0 回归** | 🔴 PR #380 OPEN，三个 handler 缺失 | PR #380；`electron/skills/skillIpc.ts` | 立即合入（P0） | S |
| **i18n 死键归零 + 英文三处整片中文** | 🟡 PR #312 OPEN | PR #312；`scripts/check-i18n-dead-keys.mjs` | 合入 main | S |
| **走查假绿修复 + CI 执行者** | 🟡 PR #314 OPEN | PR #314；`tests/ux/` | 合入 main | S |
| **分镜表 v5 A-B 段** | 🟡 A 段已合（#330），B 段 PR #368 已合 | `docs/plan/2026-09-01-storyboard-table-genre-profile.md`；C/D 段待定 | C/D 段排期 | M |
| **Runway 模型身份归一** | 🟡 已合 PR #310/#351/#371（runway 平台档案全删）| `docs/plan/2026-09-02-runway-model-identity-workflow.md` | 完成 ✅ | — |
| **MCP 工具面收敛（#359）** | 🟡 已合 PR #359（42→23 工具）| main `5fb7bd07` | A 线 title+描述瘦身待做 | S |
| **打包 smoke derive** | 🟡 PR #364 OPEN | PR #364；`tests/ux/smoke-packaged.e2e.mjs` | 合入 main | S |
| **gates 本地 CI 对齐** | 🟡 PR #361 OPEN | PR #361；`scripts/check-quality-gate-workflow.node-test.mjs` | 合入 main | S |
| **反馈分享中心** | 🟡 PR #271 已合 | `docs/plan/2026-09-01-feedback-share-center.md` | 完成 ✅ | — |
| **创作资源链 epic（P0-1~4）** | 🟡 PR #379 OPEN（仅文档）| PR #379；`docs/plan/2026-09-03-creative-resource-chain-epic.md` | 拍板后实现 P0-1 | M |

---

## ② 已立项待排期

### 架构线

| 名称 | 方案位置 | 下一步 | 量级 |
|---|---|---|---|
| **架构三期：清硬环 + 建中立契约层** | `docs/audit/2026-08-31-architecture-coupling-audit.md`（分析二：37 个硬环，分析一 C1 簇，62 条 type-only 越界需要中立层） | 需等 M 线 M3 稳定后排期；先建 `electron/shared/contracts/` 中立层，再逐步解硬环 | XL |
| **ProductionRun legacy-playbook 生成路裁决** | `docs/qa/2026-09-01-agent-m0-red-lights.md`（M1 修复班末段：两方案不可调和 fork）| **编排者裁决岔路**：退役 brand.promo legacy 生成 OR 保留现行 | — |
| **M4：部署仿真 + 创作者旅程 J1-J5** | `docs/superpowers/plans/2026-09-01-agent-architecture-test-system.md` Task 5 | 等 M3 安全对抗组验收后开工 | L |
| **M5：受控 live canary** | 同上 Task 6 | 等 M4 全绿 + 用户拍板 allowlist 后 | M |
| **MCP A 线：title + 描述瘦身（~23KB→≤10KB）** | `docs/research/2026-09-02-mcp-survey.md` §4.1 | 可独立于 M 线并行做，约 1-2 天 | S |
| **MCP B 线：J02/J04/J05/J06/J08/J12/J13 七洞** | 同上 §4.2 | J04/J08 碰确认卡 UI 要过样张门 | M-L |
| **供应商验证死路（缺口①）** | `docs/qa/2026-09-02-journey-debt-product-gaps.md` 缺口① | 需样张拍板（加验证入口 UI）后实现 | S-M |
| **3D 节点派发缺口（缺口②）** | 同上 缺口② | 补 `canRunGenerationNode` model3d 分支，可并行 | S |
| **Asset 上传路由** | `docs/plan/2026-08-31-asset-upload-routing.md` | 依赖 M2 基础稳定后排期 | M |
| **provider proxy + onboarding 加固** | `docs/plan/2026-09-01-provider-proxy-and-onboarding-hardening.md` | 已部分落地（#282），余项排期 | S |
| **凭据 safeStorage 加密落盘** | `docs/plan/2026-09-01-credential-config-at-rest-encryption.md` | 独立可做 | M |
| **TikHub connector v1** | `docs/plan/2026-09-01-tikhub-connector-v1.md` | 依赖创作资源链 epic P0-1 先落 | M |
| **DOCAUDIT-B（fal/Runway/MiniMax 等合同）** | `docs/plan/2026-09-02-docaudit-b.md` | 可并行做文档侦察 | S |
| **视频拆解 v1 面板** | `docs/plan/2026-09-01-video-deconstruction-v1.md` | 分镜表 v5 全段落地后排期 | L |
| **模型接入「不留死路」总纲余项** | `docs/plan/2026-08-15-model-integration-no-dead-end-master-plan.md` | 随 M 线 + 供应商认证流程推进 | XL |
| **走查旅程网（J1-J5，15 条覆盖）** | `docs/superpowers/plans/2026-09-01-agent-architecture-test-system.md` §1 | M4 阶段落地，当前 MCP 侧 C7-C12 已 green（PR #381）| L |
| **画布拖动性能 S5/S6（click-select + 卫生批）** | `docs/plan/2026-09-01-canvas-drag-perf-eval-v2.md`；S4 已合（#346） | S6 提案待用户拍板 | S |
| **通用 MCP 客户端（#298）** | PR #298 OPEN；贡献者三点返工要求待回复 | 先回 #298 不让贡献者晾着，再排改造 | M |
| **跨设备续跑（#328）** | PR #328 OPEN，codex 提交 | 审查后决定合入/返工 | S |
| **cross-device continuation** | PR #328 | 同上 | S |

### 架构线三问详答

**① 共变审计识别了几个簇（不只 video 档案）？**

共 8 个共变簇，最重要的是：
- **C1（头号病灶）**：`electron/providerAdapter` + `electron/catalog` + `electron/integrationCertification` + `electron/shared/modelPublication` = 15 文件、支持度 151，远超第二名 3-4 倍。加一个模型/供应商这一圈全动。证据：`docs/audit/2026-08-31-architecture-coupling-audit.md` 分析一表格。
- **C2**：i18n locales × generationCanvas（加画布功能必改 i18n）
- **C3**：capabilityCore/appIntegration × productionRun 链
- **C4**：ai/antigravityTask × catalog/processOperation × runtime.ts
- **C5-C8**：CI/CLAUDE.md 健康共变、营销页三源、批量工具条、媒体探测跨模块（均非病灶）

Video 档案只是 C1 的**一个子面**（33 个 re-export 壳）；已被二期（PR #310）修复。C1 簇的真正头部是 `integrationSession.ts`（1696 行巨壳，白名单最大违规）+ `providerAdapter/service.ts` + `catalog/catalogStore.ts` 的硬环。

**② 二期被砍的「单元 3 catalog 缝合（image/audio/3D 档案归一）」值不值得做？**

**不值得，砍得对**。PR #310 body 明确说明：image/audio/3D 档案的 canonical 家已在渲染层**单一登记、无双登记摩擦**，与 video 档案情况不同。做它只买"对称美学"，不减登记面——solo 资源下广度是敌人。当前正确处置是保留现状，不产生额外摩擦。证据：`PR #310 body § 单元 3 按 D2 砍`。

**③ 有没有规划过三期？**

**有规划但未立项执行**。架构耦合审计（`docs/audit/2026-08-31-architecture-coupling-audit.md`）分析五明确提出了三期目标：
- 清 37 个硬环（主犯 `electron/runtime.ts` 参与 18 个）
- 建中立契约层（`electron/shared/contracts/` 或 `electron/bridge/contracts/`），解决 62 条 `src→electron` type-only 越界和 51 条 value-import 越界
- 一期（PR #273）只做门岗+基线，二期（PR #310）video 归一；三期是搬迁——清 29 个 re-export 壳（已随二期清完）、建中立层、解硬环

三期前置条件：等 #241/#223 相关 M 线稳定，避免大规模文件移动与 M 线并行造成 merge 冲突。当前状态：**有路线图、无执行分支、无 PR**。

---

## ③ 僵尸待裁（最近 30 天无对应 commit，状态仍为进行中）

以下计划在 INDEX.md 标为 🚧 但近 30 天（2026-08-04 以后）在 git log 里找不到对应 commit。按建议处置分三类：

| 名称 | 方案位置 | 僵尸判断 | 建议 | 量级 |
|---|---|---|---|---|
| `2026-05-25-phase-e2-completion-and-tech-uplift.md` | docs/plan/ | 5月方案，无后续 commit | **关**：功能早已超越此方案，内容已陈旧 | — |
| `2026-05-30-onboarding-schema-first-extraction.md` | docs/plan/ | 5月方案 | **关**：被后续统一接入体系取代 | — |
| `2026-05-31-workspace-folder-projects-implementation-plan.md` | docs/plan/ | 无后续 commit | **关**：workspace 已进化，方案陈旧 | — |
| `2026-05-31-merge-workspace-feature.md` | docs/plan/ | 无后续 commit | **关**：workspace 功能已在 main | — |
| `2026-05-31-library-search-cost-fixes.md` | docs/plan/ | 无后续 commit | **关或转标 ⏳**：体验问题仍存在，但无人在做 | S |
| `2026-06-05-model-archetype-seedance-happyhorse.md` | docs/plan/ | 6月方案，模型档案体系已全面升级 | **关**：被档案体系二期取代 | — |
| `2026-06-06-image-archetypes.md` | docs/plan/ | 同上 | **关**：图像档案已有统一处理 | — |
| `2026-06-06-reference-at-and-sources.md` | docs/plan/ | 6月方案，@引用已于 #183 落地 | **关**：已交付 | — |
| `2026-06-06-drop-and-wire-execution.md` | docs/plan/ | 6月方案，无近期 commit | **暂缓 🧊**：drop-and-wire 还有价值但无资源 | L |
| `2026-06-07-p0-kie-video-execution.md` | docs/plan/ | 6月方案 | **关**：KIE 视频已正常接入 | — |
| `2026-06-07-p1-async-task-foundation.md` | docs/plan/ | 被 M 线 ProductionRun 取代 | **关**：M 线是真相源 | — |
| `2026-06-07-assistant-consolidation-plan.md` | docs/plan/ | 6月方案，Pi SDK 运行时已落 | **关**：#223 之后架构完全不同 | — |
| `2026-06-07-assistant-mockup-implementation.md` | docs/plan/ | 同上 | **关** | — |
| `2026-07-04-scene3d-reference-pack.md` | docs/plan/ | 7月方案，无近期推进 | **暂缓 🧊**：方向正确但无资源 | XL |
| `2026-06-08-性能地基.md / perf` | docs/plan/ | 被具体 perf PR 分解处理 | **关**：当前按具体优化分别推进 | — |
| `onboarding-form-*.md` 系列（4份）| docs/plan/ | 6月方案，无后续 commit | **关**：被统一认证流程取代 | — |
| `2026-06-08-巨壳拆分-B-Scene3D-A-NodeParameterControls.md` | docs/plan/ | 无近期 commit | **暂缓 🧊**：巨壳仍存在（1696行），条件不成熟 | L |
| `2026-05-24-production-video-export-execution-plan.md` | docs/plan/ | 5月方案，导出已有多个PR | **关**：已被后续导出方案覆盖 | — |
| `marketing-gsap-seo.md` | docs/plan/ | 无日期，无近期 commit | **暂缓 🧊**：营销站不是当前优先级 | M |
| `c5-text-node.md` | docs/plan/ | 无日期，无近期 commit | **暂缓 🧊**：文本节点有价值但无资源 | L |
| `nomi-select-unify.md` | docs/plan/ | 无日期 | **暂缓 🧊** | S |
| `2026-06-08-custom-categories-and-chat-polish.md` | docs/plan/ | 6月方案，部分功能已落 | **关或拆分**：分类已实现，聊天气泡还未做 | S |
| `2026-05-31-three-canvas-bugs.md` | docs/plan/ | 5月方案，三个 bug 应已修 | **需核对**：grep 实查是否已修，若修了关档 | S |

**僵尸计划总计：约 23 份**（建议关：~15 份；建议暂缓：~8 份）

---

## ④ 已完成可归档

> 以下条目在 INDEX.md 标记仍为 🚧 但实际 commit 证据证明已交付，建议更新为 ✅。

| 名称 | 证据 | 备注 |
|---|---|---|
| M0 基线冻结 | `docs/architecture/agent-m0-*.md` 四份文件全在 main | 已完成 |
| M1 上下文工厂（三片）| PR #372/374/376 MERGED | 已完成 |
| M2 语义面三片 | PR #318/#337-339/#360 MERGED | 已完成 |
| M3 上下文工厂 | PR #372/374/376 MERGED | 已完成（含 agent prompt 编译 + skill 事件）|
| 架构一期边界门岗 | PR #273 MERGED | 已完成，check:boundaries 入 gates 链 |
| 架构二期 video 档案归一 | PR #310 MERGED，33 转发壳删净 | 已完成 |
| Runway 平台档案全删 | PR #351/#371 MERGED，平台档案棘轮 3→1 | 已完成 |
| MCP 工具面 42→23 收敛 | PR #359 MERGED | 已完成 |
| 技能导入渲染层（parseSkillImport）| PR #279 MERGED | 已完成（但 IPC handler 缺失→PR #380 P0 待合）|
| 尾巴批（i18n 烧批/pre-push/check:handoff）| PR #309 MERGED | 已完成 |
| 分镜表 v5 A段 + B段 | PR #330/#368 MERGED | C/D 段仍 🚧 |
| 供应商验证死路探针记录 | `docs/qa/2026-09-02-journey-debt-product-gaps.md` 缺口① | 探针完成，修复未实现 |
| MCP J07（legacy generate 删除）| PR #301 MERGED `0b6441c6` | 已完成 |
| MCP J11（导出 manifest 真实化）| 08-29 commit `8784ec77` | 已完成 |
| MCP C7-C12 L2 旅程测试 | PR #381（待合）证据 42/42 断言绿 | 待合入 main 算完成 |
| 遗留 PR 分诊裁决（#255/#249/#250/#298）| PR #377 MERGED `docs/qa/2026-09-03-legacy-pr-triage.md` | #255/249 关档，#250/#298 返工标准已定 |

---

## 附：架构线共变簇完整清单（供三期规划引用）

| 簇 | 大小 | 内部支持度 | 现状 | 三期建议 |
|---|---|---|---|---|
| C1：供应商/模型目录管线 | 15 | 151 | 37 硬环主场；`integrationSession.ts` 1696行白名单 | 建中立契约层后拆 C1 硬环 |
| C2：i18n × generationCanvas | 8 | 40 | 健康共变（R15 强制），每加画布功能必改 | 棘轮维护即可 |
| C3：capabilityCore × productionRun | 5 | 28 | M 线重构中 | 随 M 线稳定 |
| C4：ai task × catalog × runtime | 5 | 24 | 37 硬环参与者 | 三期解环 |
| C5-C8 | 3-4 | 12-24 | 部分健康（CI/CLAUDE.md），部分可改善 | 低优 |

---

*生成于 2026-09-03，盘点 agent：Claude Code（Sonnet 4.6）。仅盘点+文档，未改任何源码。*
