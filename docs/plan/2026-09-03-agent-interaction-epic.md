# Agent 交互 epic · 执行计划

> 2026-09-03 · 状态：📋 计划（未开工）
> 上游真相源（本文不新裁设计，只排施工顺序）：
> - `docs/design/2026-09-01-agent-ui-final-redesign.md` —— 21 形态，已拍板
> - `docs/design/2026-09-02-agent-ui-conformance-testspec.md` —— 验收断言清单，已定稿（含 §0 选择器契约）
> - `docs/design/2026-09-02-agent-ui-v3-walkthrough.md` —— 逐屏走读定稿
> - `docs/design/agent-ui-state-coverage-gaps.md` —— 69 个异常态缺口（P0 17 个必须补画）
> - `docs/design/mockups/2026-09-01-agent-ui-final-redesign.html` —— v3.1 样张（交互参照）

## 为什么先写这份

维护者原话：「交互好了之后还得做完整测试，这是很重要的功能」。所以本 epic 的完成线**不是**「界面长得像样张」，而是 R16：带真实用户任务跑通使用闭环、把过程中冒出的体验/设计/功能问题全修掉。测试系统是交付物的一部分，不是收尾工作。

## 开工前实测到的起点（2026-09-03，别凭印象重估）

| 面 | 实测 | 命令 |
|---|---|---|
| 样张自洽性 | ✅ **133 条断言全绿**（12 意图层 + 121 自动层） | `CONFORMANCE_TARGET=mockup node tests/ux/agent-ui-conformance.walk.mjs` |
| 断言器 app 模式 | ❌ **未打通**：0 通过 / 21 报错后崩溃 | `CONFORMANCE_TARGET=app ...` |
| 实现侧挂点 | 95 个 `data-agent-*` 已存在；面板根 `data-agent-panel` 在 `ProjectAgentResidentShell.tsx:697` | `grep -rhoE 'data-agent-[a-z0-9-]+' src/` |
| 开闸标志 | `agentHostEnabled` 默认 false（`src/utils/agentHostPreference.ts`） | |
| 样张契约覆盖 | 53 张样张仍欠契约（基线 54） | `node scripts/check-mockup-contracts.mjs` |

**那个「0 通过」不能读成「实现有 35 处不符」**——断言器 app 模式连到 `localhost:5173` 后**没有任何导航/开面板的准备**，此时屏幕上是项目库，Agent 面板根本没挂载，所以「元素不存在」是必然的，测不出任何信息。这正是仓内教训 [断言前先证明你在你以为的现场] 的形状。**实现差距目前不可知**，件 0 完成后才有真实数字。

## 件序（每件独立 PR，前件是后件的前提）

### 件 0 · 打通断言器的 app 模式 —— 阻塞项，先做

没有它，后面每一件都无法验证，只能靠肉眼比对样张（正是过去反复打回的老路）。

1. **准备现场**：新建/打开项目 → 进工作台 → 开 Agent 面板 → 置 `agentHostEnabled`。参考现役走查的起法（`tests/ux/_launchApp.mjs`、`tests/ux/agent-runtime-fixture.mjs`）。
2. **自证在现场**：断言前先确认 `[data-agent-panel]` 存在，找不到就**明确报「现场没准备好」**而不是逐条报「元素不存在」——两者的修法完全不同，混在一起会把人引向错误方向。
3. **修畸形选择器**：`data-agent-at-token[data-stale=true]` 被包成 `[data-agent-at-token[data-stale=true]]` 导致崩溃（`agent-ui-conformance.walk.mjs:207`）。规格里带属性限定的挂点都受影响。
4. **夹具驱动**：流式中/忙时/排队态由确定性夹具驱动，不烧真模型（testspec §4）。
5. **阳性对照**：`--positive-control` 那条路要对 app 模式同样有效——故意改一处让它必红，证明这把尺子对真实应用是活的。

**完成判据**：`CONFORMANCE_TARGET=app` 能跑完全程并给出**可信的**通过/失败数；阳性对照能红。

### 件 1 · 按屏对齐实现（A→B→C→D，逐屏独立 PR）

件 0 给出真实差距后，按屏切片。每片：红灯先行（先证明断言对当前实现报红）→ 改实现 → 转绿 → 截图自看（P3 眼见链）。

**不许**为了让断言变绿去改断言或放宽容差。改断言的唯一合法理由是「规格本身写错了」，且必须在 PR 里说明并同步改 testspec。

### 件 2 · 17 个 P0 异常态缺口 —— 需要拍板，可与件 1 并行起草

`docs/design/agent-ui-state-coverage-gaps.md` 列的 P0 全部是**设计缺口不是实现缺口**（如「超长回复怎么折叠」「计划生成失败长什么样」「@ 选择器空状态」）。走 R8：补画 → 维护者拍板 → 才进实现。

起草期间件 1 照常推进（那 21 个形态的正常态已拍板）。

### 件 3 · R16 真实用户任务闭环 —— 完成线在这里

建几条真实用户任务（不是功能探索，是创作目标），带着任务跑通整个使用闭环，把过程中冒出的体验/设计/UI/产品感问题**全修掉**。参考 `docs/design/2026-09-02-agent-ui-functional-conformance-testspec.md` 的功能一致性要求：不仅长得对，**背后的功能也必须一致**。

### 件 4 · 开闸

`agentHostEnabled` 转 true。前置：件 1 全绿 + 件 2 拍板项落地 + 件 3 闭环跑通。

## 不动项

- 不改已拍板的 21 形态设计（要改先回设计班过 R8）
- 不动 `agentHostEnabled` 默认值，直到件 4
- 不为赶进度放宽任何断言或容差（`max(4px 步进, 25%)` 是统一策略，改它要改 `tests/ux/_contract.mjs` 并说明）

## 回滚

每件独立 PR，可单独 revert。件 4 的开闸是单一布尔值，回滚成本最低——但它也意味着前三件的问题会直接暴露给用户，所以它排在最后而不是最前。

## 已知会绊人的坑（来自今天的实战）

- **「确认返回成功」≠「功能真的完成」**：今天在花钱确认面栽过——确认函数返回 confirmed，但下游因缺收据拒绝，净效果比不改更差。做交互时同理：**断言 UI 上出现了某个元素 ≠ 那个动作真的生效了**，功能一致性要单独验（件 3）。
- **单测的装配形状要和生产一致**：今天发现整组确认面单测都给 transport 传了生产不存在的 mock，绿灯证明不了生产行为。
- **门岗只数数量抓不住「让既有出口变可达」**：判据要盯守卫/结构，不是盯计数。
