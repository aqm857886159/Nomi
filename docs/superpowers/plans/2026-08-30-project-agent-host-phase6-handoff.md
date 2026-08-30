# Project Agent Host Phase 6 与最终交付 Handoff

> 状态：🚧 Phase 6 B 批次实施中。2026-08-30 Phase 5 远端 checkpoint 后的唯一恢复入口；用户已指定 PR #194 作为交互样张并授权据此实现。
>
> 面向：接手本任务的下一位 AI 工程代理。
>
> 当前状态：Phase 1、2A、2B、3A、3B、3C、3D、4、5 已形成远端 checkpoint；
> PR #194（head `b157cebd49ef93eb98aedc871ead96ed06b35e6b`）已作为设计输入，当前实施一个跨 Creation、Generation、Preview 的 resident Host projection shell。
>
> 本文件是恢复导航，不是第二份计划真源。阶段状态、冻结合同、证据与下一步只以
> [全阶段执行路线图](../../plan/2026-08-29-project-agent-host-execution-roadmap.md)
> 为准；若两者冲突，先核验代码/Git/PR，再修正本 handoff，不能另建第三份计划。

## 1. 五分钟恢复现场

### 1.1 唯一工作树

```text
/Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827
```

不要在 `/Users/aoqimin/Desktop/Nomi`、其他 `Nomi-*` worktree 或新 clone 中继续本任务。
这些目录可能是 `main`、其他 PR 或实验现场，混用会丢失当前 checkpoint 或污染其他工作。

### 1.2 当前 Git / PR 事实（2026-08-30）

| 项目 | 当前值 |
| --- | --- |
| 分支 | `codex/project-agent-host-phase1-20260827` |
| Phase 5 代码 checkpoint | `63c825ce7aecbe1a6ca07446733c84d789090290` (`feat(agent-host): close skill mcp projection`) |
| 远端任务分支 | `origin/codex/project-agent-host-phase1-20260827` |
| PR | [Draft PR #223](https://github.com/aqm857886159/Nomi/pull/223) |
| 任务分支 / PR head | 以首次核验的 live remote SHA 为准；它必须包含上述 Phase 5 checkpoint 和本 handoff checkpoint |
| PR base | `main` |
| PR 状态 | `OPEN`、`Draft`、`CONFLICTING`（主线漂移，尚未做最终整合） |
| 远端检查 | `Workers Builds: nomi` 已 `SUCCESS` |
| 预期工作树 | clean |

本文不硬编码包含自身的最终 commit。进入目录后先执行以下只读核验；`fetch` 只刷新 refs，
此时不 merge/rebase：

```bash
pwd -P
git rev-parse --show-toplevel
git branch --show-current
git remote get-url origin
git status --short --branch
git fetch origin
git rev-parse HEAD origin/main origin/codex/project-agent-host-phase1-20260827
git ls-remote --heads origin main codex/project-agent-host-phase1-20260827
git log -3 --oneline --decorate
gh pr view 223 --repo aqm857886159/Nomi \
  --json url,isDraft,state,headRefName,headRefOid,baseRefName,mergeable,statusCheckRollup
```

物理目录和 `--show-toplevel` 必须都是唯一工作树；branch 必须是任务分支；origin 必须是
`https://github.com/aqm857886159/Nomi.git` 或等价 SSH URL；`ls-remote`、remote-tracking ref 和
PR `headRefOid` 必须一致，PR head/base 必须分别是任务分支/`main`。工作树应 clean，且 live SHA
必须包含 `63c825ce`。任一事实不同，不要 reset、checkout、覆盖、merge 或 rebase；先保护并归属
现有改动，把新事实写回唯一路线图，再决定如何继续。

### 1.3 接手后必须先读

顺序不能反：

1. 仓库 [AGENTS.md](../../../AGENTS.md)：工程、设计、测试、Git 纪律。
2. [ARCHITECTURE-NOW](../../ARCHITECTURE-NOW.md)：当前真实运行架构，优先于旧方案。
3. [全阶段执行路线图](../../plan/2026-08-29-project-agent-host-execution-roadmap.md)：
   唯一阶段状态、合同和证据真源。
4. [Project Agent Host 设计](../specs/2026-08-27-project-agent-host-design.md)：
   owner、生命周期、用户旅程和 Phase 6 原始意图。
5. [历史 PR 证据](../../audit/2026-08-29-project-agent-pr-evidence.md) 与
   [覆盖索引](../../audit/2026-08-29-project-agent-pr-coverage-index.md)：
   历史严重问题和 `adopt / adapt / reject`，不是 cherry-pick 清单。
6. [Nomi 设计系统](../../design/nomi-design-system.md)，尤其控件层级、常驻预算、
   组件复用、i18n、light/dark、键盘焦点和真实截图规则。
7. [engineering-plan-delivery](../../../.agents/skills/engineering-plan-delivery/SKILL.md)：
   继续沿用单一计划、宏批次、证据复用、三个不同范围各一次的评审和一次最终主线整合。

设计采用记录：PR #194 只提取问题与设计证据，不 cherry-pick。adopt：稳定 Item、忙碌 queue、
工具批准、340px Dock、36px 收起入口、共享 Thread/Skill/context/model 与 206px timeline；adapt：
把样张静态 demo 数据替换为 Host snapshot/patch 和现有领域组件；reject：本地 transcript、独立
approval/task/result owner 与旧面板 fallback。旧 Creation/Canvas shell 与 conversation bucket 已删除。

旧文件
[2026-08-28-project-agent-host-handoff.md](./2026-08-28-project-agent-host-handoff.md)
只保留历史推导。它停在 Phase 3，且仍含已废止的“无损迁移旧会话/Pi context”步骤，
不得作为恢复命令、当前状态或迁移需求。

## 2. 任务到底在做什么

Nomi 是一个本地优先的视频创作工作台，主流程是：项目库 -> 创作文稿 -> 生成画布 ->
时间轴预览 -> 导出。过去创作页和生成页各有一套 Agent 面板、历史、执行生命周期和工具
入口；跨页面会产生割裂、重复 owner、双写、迟到回调和“用户不知道 Agent 做到哪”的问题。

本任务的最终产品结果不是再加一个聊天框，而是建立一个**项目级常驻 Agent**：

- 一个项目只有一个 `ProjectAgentHost`，持有 Thread / Turn / Item / queue 的事实；
- 用户在创作、生成、预览之间切换时看到同一线程、同一任务进度、同一审批和结果引用；
- Pi 只负责推理循环和私有 context，不成为聊天、审批、作品或任务账本；
- 所有能力从 canonical Registry 派生，Host 验证绑定后调用既有领域 owner；
- 文档、画布、时间轴、ProductionRun、素材和导出仍由各自领域持有事实；
- Skill 只提供知识和缩权声明，不能授权；MCP 是另一 transport，不复制 Host 历史；
- UI 最终只投影上述事实，不重新发明状态机或执行器。

完成标准仍是整个目标：Phase 6 常驻 UI、固定一次最新 `main` 整合、全量 gates / typecheck /
test / build / package、真实创作到导出旅程、重启/跨项目/隐私/审批验收，以及把 PR #223
更新到可合并状态。当前 checkpoint 不是总任务完成声明。

## 3. 当前唯一 owner 模型

| 语义 | 唯一 owner | UI / Host 能做什么 | 禁止状态 |
| --- | --- | --- | --- |
| Thread / Turn / Item / queue | `ProjectAgentHost` main runtime | 订阅 snapshot/patch，发送 CAS command | renderer 再存一份活跃 transcript/pending |
| 模型推理 context | 固定版 Pi runtime | 绑定 project/thread，作为私有工作缓存 | 把 Pi snapshot 当项目资料或 Host 事实 |
| 能力 ID/schema/effect/approval | Capability Registry | Pi/MCP/UI 只消费派生投影 | descriptor/manifest/UI 再定义 schema 或权限 |
| 文档 | editor/domain/persistence | Host 保存 exact document target/result ref | Host 保存正文或自建 Undo |
| 画布 | Canvas store/domain/persistence | Host 保存 target/precondition/result/receipt ref | Host 复制节点/边或重写 proposal transaction |
| 时间轴 | Timeline kernel/domain/persistence | Host 调 canonical read/write 并保存 ref | 第二 timeline store、Agent 直接写 Zustand |
| 付费/长任务 | ProductionRun + human receipt | Host/TaskCenter/MCP 只投影 run/job/artifact refs | shadow submit、第二预算/审批/任务账本 |
| Skill package | main-owned Skill store/package boundary | UI 导入、选择、展示；MCP 读显式 public Skill | renderer 解 ZIP、用户 Skill 自动外曝 |
| MCP | canonical Registry + 显式 transport adapter | 使用 lease/scope/elicitation/receipt 额外守卫 | MCP 污染聊天历史或 manifest 注册工具 |

Phase 6 只能改变 projection、布局、组件和交互编排，不能改变这张 owner 表。

## 4. 已完成阶段与恢复点

| 阶段 | 远端 checkpoint | 已交付结果 |
| --- | --- | --- |
| Phase 1 / 2A | 早期提交链，见 Git log | canonical `canvas.read` 脊梁；Host foundation、CAS、repository、恢复合同 |
| Phase 2B | `b84188d3` | 单一生产 Host、两旧面板读取同一投影、项目切换/Stop/queue/receipt/Undo 收口，旧会话 writer 删除 |
| Phase 3A | `2ff3bb0c` | canonical `document.read` 经 Host/main/Surface/editor；旧 read owner 删除 |
| Phase 3B | `0a3de699` | reversible `document.write`；冻结 document/revision/anchor/hash，stale 在 mutation 前拒绝 |
| Phase 3C | `27245aee` | canonical `canvas.write@v1`；set/create/connect/tidy、durable receipt correlation、exact result pointer、one Undo |
| Phase 3D | `668b9bb1` | canonical timeline read/write；range/plan/apply/undo、Timeline kernel、CAS、Workbench Undo |
| Phase 4 | `189ac884` | ProductionRun/付费 authorization 唯一化、旧 generation writer 退役、archive-only active-source cleanup |
| Phase 5 | `63c825ce` | Skill/MCP audience、list/read guard、version/hash URI、shrink-only、Registry-only projection、main-owned ZIP import |

### 4.1 Phase 4 证据摘要

- 唯一 authorization digest 绑定 gate、approval、预算、outbox 和 provider payload；
- renderer/driver/`nomi_generate` 旧付费 writer 不再可路由；
- archive-only 不重放旧执行，作品数据和 ProductionRun 继续由领域 owner 保存；
- reviewer 的 P1（返工可能覆盖仍被兄弟 job 使用的 run-wide authority）已在 preparation +
  reducer 两层修复，scoped re-review PASS；
- Phase 4 远端恢复点为 `189ac884`，完整矩阵在路线图 §A。

### 4.2 Phase 5 证据摘要

- affected matrix：14 个直接测试文件、182/182 tests passed；
- ZIP 定向：19/19 passed，覆盖 Info-ZIP `0x7075` raw/effective traversal、forbidden、
  duplicate/type mismatch 和 `compressedSize +1/+4/+16`；
- 同一 reviewer scoped re-review PASS，无剩余 P0/P1；
- Electron/renderer production TypeScript、root-cause、capability owner、filesize、heavy-path、
  i18n、test-waits、scoped ESLint、`git diff --check` 均通过；
- `electron/main.ts` 从 850 降到 836 行；
- 完整根因合同：
  [skill-mcp-visibility-capability-boundary](../../fixes/2026-08-30-skill-mcp-visibility-capability-boundary.root-cause.json)。

不要因为接手而重跑这些 focused 证据。只有对应源码、fixture、依赖或环境指纹变化时才失效。

## 5. 已冻结的一次性切换决策

用户明确选择了简化切换，不做旧 Agent 会话和 Pi context 的无损迁移。下一位 AI 不得把
旧 handoff 中的 staging/import 方案恢复回来。

| 数据/状态 | 切换行为 |
| --- | --- |
| 旧聊天文字 | 原始 bytes 只读归档或导出，不导入新 Host 活跃线程 |
| 旧 Pi context / 模型记忆 | 清空，新 Host 从干净 context 开始 |
| 旧 pending 审批 | 全部失效，不恢复、不执行 |
| 旧未完成 Turn | 标记升级中断，用户重新提交 |
| 已批准但执行状态不明 | 不自动重试，要求用户检查作品/任务事实 |
| 旧 Canvas proposal / Undo | 只归档，不重放，不伪装成仍可撤销 |
| 文档、画布、时间轴、素材、结果 | 各自领域存储必须保留 |
| ProductionRun / 已付费任务 | 必须读取、核账并重新关联既有 run/job/receipt/artifact 事实；“恢复”绝不表示重放或再次提交状态未知的付费操作 |
| 新旧 writer | cutover 后只允许新 Host 写，禁止双写 |
| 降级 | 新 Host 产生数据后不承诺直接降级；需要明确导出/离线方案 |

这项简化只删除旧会话兼容复杂度，不删除新 Host 的 CAS、receipt correlation、exactly-once、
stale binding、项目隔离、Undo 和 ProductionRun 安全边界。

对 `provider_accepted`、`submission_unknown` 或任何已批准但提交结果不明的旧操作，只能从
ProductionRun、provider task、idempotency key 和 receipt 做 reconciliation/继续观察。除非已经证明
旧请求 definitely-not-submitted，并经过一份新的明确人工批准，否则不得 resume、retry 或创建新的
provider job；会话升级本身永远不是重新付费的授权。

## 6. Phase 6 开始前的真实 UI 状态

当前不是“没有 UI”，而是**共享事实已经接入两个旧外壳，最终常驻外壳尚未完成**：

- 创作页：`CreationWorkspace.tsx` 挂 `CreationAiPanel.tsx`，默认是编辑器右侧 344px 常驻栏；
- 生成页：`GenerationWorkspace.tsx` 挂 `CanvasAssistantPanel.tsx`，支持 sidebar/overlay；
- 预览页：`WorkbenchShell.tsx` 只挂 `PreviewWorkspace`，没有 Agent；
- `NomiStudioApp.tsx` 已按 active project open/release Host subscription，并把 patch 投影到
  `projectAgentProjectionStore.ts`；
- 两个旧面板都可消费 `useProjectAgentThreadMessages.ts`，因此历史事实已统一，但 panel shell、
  composer、工具卡和局部状态仍是两套；
- `projectAgentUiProjection.ts` 目前把 artifact/task/proposal 先压成
  `artifact:<id>` / `task:<id>` / `approval:<id>` 兼容 DTO。Phase 6 应渲染真实卡片/动作，
  但只能通过稳定 ref 读取领域事实，不能把这些对象复制进 Host 或 UI store；
- Host 的 `queued/drafting/proposed/running/done/failed/stopped/declined` 被旧 DTO 压成更粗的
  `pending/streaming/done/error/cancelled`。Phase 6 可以改善呈现，状态集合仍由 Host contract 拥有。

关键代码入口：

```text
src/workbench/NomiStudioApp.tsx
src/workbench/WorkbenchShell.tsx
src/workbench/creation/CreationWorkspace.tsx
src/workbench/creation/CreationAiPanel.tsx
src/workbench/generation/GenerationWorkspace.tsx
src/workbench/generationCanvas/components/CanvasAssistantEntry.tsx
src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx
src/workbench/preview/PreviewWorkspace.tsx
src/workbench/ai/projectAgentProjectionStore.ts
src/workbench/ai/projectAgentUiProjection.ts
src/workbench/ai/projectAgentUiCommands.ts
src/workbench/ai/useProjectAgentThreadMessages.ts
electron/shared/projectAgentContracts.ts
electron/projectAgentHost/
```

## 7. Phase 6 的核心用户体验

Phase 6 要让用户感受到“这是项目里的同一个 Agent，一直在这里”，而不是感受到一次架构迁移。

### 7.1 必须达成

1. **跨创作/生成/预览常驻。** 切换工作区不换 Agent、不换线程、不丢输入、不重复执行；
   预览页接入同一 resident shell，不创建第三个 Host 或第三份历史。
2. **稳定 Item 原位更新。** 同一请求从 queued -> running -> proposed/task -> terminal 原位变化，
   不靠新增气泡伪造进度，不让用户猜“发出去没有”。
3. **忙时队列可见可控。** 后续请求可见、可编辑、可取消；当前 Turn 与排队项边界清楚。
4. **停止与失败诚实。** Stop 立即可见；迟到回调不能复活。失败显示 retryable 与 next action，
   declined/stopped/failed 不混成一句模糊报错。
5. **审批在上下文中完成。** 文档/画布/时间轴/付费确认卡展示 exact target、变化、价格/模型、
   reference role 和风险；批准 identity/hash 与实际提交一致，消费后不能再次点击。
6. **长任务与结果可追踪。** TaskRef 指向同一 ProductionRun；artifact/result 卡可预览、打开、定位，
   视频使用 poster/player，不把 MP4 塞进 `<img>`；toast 不是结果 owner。
7. **Thread 真的项目级。** 新建、切换、删除线程由 `projectAgentUiCommands.ts` 发 Host command；
   页面切换、重启和项目切换不会产生两套 active thread。
8. **Skill/context 渐进披露。** 展示当前 Skill、能力缩小结果和 context 使用的行动性信息；
   不把所有 Skill 正文常驻塞进面板，不给 Skill 配置制造第二个权限 UI。
9. **密度、无障碍和双主题。** 延续安静、工作型、可扫描界面；状态不能只靠颜色；键盘焦点、
   loading/empty/error、窄窗口、light/dark 和 i18n 都必须完整。
10. **作品面仍是主角。** 常驻 Agent 不能遮挡编辑器、画布或播放器；固定尺寸、overlay/sidebar、
    收起态和窄窗口行为必须来自获批样张和真实布局约束。

### 7.2 明确非目标

- 不新增 PromptRecipe catalog、Connector/MCP client、ExecutableExtension 或 marketplace；
- 不重新设计 Registry、审批、ProductionRun、proposal/Undo 或领域事务；
- 不做旧 Agent 会话/Pi context 无损迁移；
- 不把 TaskCenter、卡片、React Flow、preview player 或 toast 提升为事实 owner；
- 不保留新旧 resident shell 的长期 feature flag/fallback；
- 不直接 cherry-pick #194/#196/#199/#201/#203 的 UI 分支；
- 不在 Phase 6 focused UI 开放期间反复追 `main` 或跑全量测试。

## 8. 用户还要补充的产品输入

用户已经明确说会补充 Agent 交互设计并可能调整当前方向。在收到该输入前，不要写 Phase 6
生产 UI。收到后先把它和当前真实界面、设计系统及历史 PR 证据做一次差异裁决，并把决策写回
唯一路线图的 Phase 6 冻结合同。

至少要冻结这些问题：

| 决策 | 必须回答的用户体验问题 |
| --- | --- |
| 常驻位置 | 三个工作区是否同一右栏；何时 sidebar、overlay、收起；预览播放器不能被遮挡 |
| 面板尺寸 | 标准宽度、最小内容宽度、窄窗口断点、收起后入口放在哪里且不压内容 |
| Thread 导航 | 历史入口、标题/摘要、新建/切换/删除、当前线程身份如何最少但清楚地呈现 |
| Item 时间线 | 用户消息、流式文本、工具、proposal、task、artifact、failure 的信息层级和折叠规则 |
| Queue/composer | 忙时发送、排队、编辑/取消、附件、Stop、重试和 disabled/loading 状态 |
| Skill/context | 当前选择、能力范围、context 使用量和切换入口放哪一层，不占用过多常驻预算 |
| 审批 | reversible/destructive/paid 的卡片差异、exact target、价格、reference、确认/拒绝/超时 |
| 任务/结果 | ProductionRun 进度、取消、恢复、打开 TaskCenter、poster/player、定位作品的路径 |
| 跨工作区 | 切换时面板是否保持展开/宽度/滚动位置；当前 surface context 如何提示但不分裂线程 |
| 可访问性 | 键盘顺序、焦点返回、屏幕阅读器名称、状态非颜色表达、light/dark 和中英文长度 |

先做基于**当前真实 Workbench 外壳**的可体验 HTML mockup 或同等可运行样张，覆盖桌面标准宽度、
窄窗口、light/dark 和关键动态状态。样张必须让用户拍板；不能用抽象线框、营销页、孤立卡片
或静态截图替代真实布局验证。

## 9. 历史 PR / 设计证据怎么用

Phase 6 只做增量，不重读未变化的全部历史：

- #194：采用 stable Item、busy queue、Skill/context/approval 呈现；状态必须从当前 Host 派生；
- #196/#203：采用 renderer 是 projection、domain/store/persistence 独立；拒绝双 renderer/fallback；
- #199/#201：采用 exact result/version、card stack、group aggregate、cross-project cleanup 的问题证据；
  #199 已撤、#201 未合，不可直接当实现基线；
- #202：继续验收 typed cancel、approval identity、reference role、ETA honesty、reviewable artifact、
  export truth；各自事实仍归领域 owner；
- #232：作为 UI/视频复刻方向增量输入，不改变 Phase 5 权限合同。

开始 Phase 6 前：

1. 查询这些 PR 当前 head、状态、reviews/comments 和 changed files；
2. 只记录相对现有 evidence 的新信息；
3. 对用户新设计逐条写 `adopt / adapt / reject`；
4. 以当前代码和届时获批样张为实现基线，不机械 merge/cherry-pick 历史分支。

## 10. 推荐执行流程：两个宏批次，不再微切片

### 宏批次 A：冻结 Phase 6 体验合同与样张

结果：用户能在真实三工作区布局中体验 resident Agent 的关键状态，并明确拍板。

内部顺序：

1. 恢复现场，读取当前外壳、现有截图/走查和设计系统；
2. 收到用户补充设计后，只补 UI/new-PR 增量 evidence；
3. 把 owner 不变量、信息层级、常驻预算、responsive、状态/动作矩阵写入路线图；
4. 基于真实 Workbench 做一个 feature-complete mockup：thread、queue、streaming、approval、
   task、artifact、failure、empty/loading/collapsed；
5. 在标准/窄窗口、light/dark 下截图并亲眼检查 overlap、文字截断、内容遮挡、焦点和滚动；
6. 用户拍板后做一次 **Phase 6 contract review**（Spec / Standards / Owner-Authority），修当前合同 P0/P1；
7. 把获批样张和合同提交并推到任务分支，形成设计恢复点。

没有用户拍板，不进入宏批次 B。

### 宏批次 B：常驻 UI 原子切换与 focused closure

结果：一个 resident shell 服务创作/生成/预览，旧两套 panel shell 同批删除，不保留 fallback。

内部顺序：

1. 抽取/复用共享 Thread/Item/Queue/Composer/Approval/Task/Artifact projection 组件；
2. 只通过 `projectAgentProjectionStore` + Host commands 读写 Thread/Turn/Item/queue；
3. 把 surface-specific context/actions 作为 adapter/slot 注入，不让 resident shell 持有领域事实；
4. 将同一 shell 挂到 Creation、Generation、Preview 的稳定布局位置；
5. 保留现有业务行为后，同批删除 `CreationAiPanel` / `CanvasAssistantPanel` 中重复 shell、
   composer、history writer 或状态 owner；领域卡片/adapter 可复用，不为删文件而复制逻辑；
6. 补 queue edit/cancel、Stop、approval、task/artifact、thread、cross-workspace、restart/project switch
   的 focused component/integration/GUI evidence；
7. 用 Playwright 截图与获批样张逐项对账，运行 visual/UX 审查；
8. affected TypeScript、scoped lint、i18n/tokens/filesize/heavy-path/test-waits、owner/root-cause gate；
9. 一次 **Phase 6 implementation diff review**，只允许当前合同 P0/P1 阻断，修复后只重跑失效证据；
10. 更新路线图，commit/push Phase 6 focused checkpoint。

不要把 contract、组件、三个页面、测试、评审拆成几十个远端 Round。它们是同一端到端 outcome
的内部依赖步骤；只有获批样张和 production cutover 是两个有意义的恢复边界。

### 10.1 三种审查不是重复审查

| 审查 | 唯一范围 | 时机 |
| --- | --- | --- |
| Phase 6 contract review | 获批样张、冻结体验合同、owner/authority 与验收证据是否自洽 | 宏批次 A 结束、进入生产实现前 |
| Phase 6 implementation diff review | Phase 6 实际代码 diff 是否兑现合同且未引入重复 owner/安全回归 | 宏批次 B focused 证据通过后 |
| Final candidate review | pinned `main` 整合后的完整候选、冲突裁决、最终证据与可合并性 | 最终 full/release/package/旅程通过后 |

每个范围只做一次 broad review。若发现当前合同 P0/P1，只让同一 reviewer 定向复审对应修复 diff
或失效条款；不得重新开启整份 broad review。P2 和无关存量问题进 backlog，不扩张本交付。

## 11. Phase 6 focused 验收矩阵

| Criterion | 必须证明什么 | 建议证据 |
| --- | --- | --- |
| 一个 resident shell | 三工作区同一 Thread/Item/queue；没有第三 Host/历史 | component/integration test + Creation->Generation->Preview GUI journey |
| 稳定 Item | 状态原位变化，tool/proposal/task/artifact identity 不重复 | projection tests + DOM identity assertions |
| 忙时 queue | 第二条可见、可编辑/取消，只执行一次 | Host queue tests +真实 panel journey |
| Stop/late reply | Stop 后迟到模型/tool/Surface reply 不写 UI/持久化 | 复用/扩展 `agent-runtime-editing.walk.mjs` |
| 审批 | exact target/hash/price/reference；accept/decline/cancel/timeout typed；消费一次 | approval component + Host/ProductionRun journey |
| task/artifact | 同一 run/job/artifact/result ref；可打开/预览；视频 poster/player | TaskCenter/ProductionRun adapter tests + screenshot |
| Thread 管理 | create/activate/remove 经 Host command；跨页面/重启保持 active identity | UI command tests + cold restart journey |
| 项目隔离 | A 的迟到 Item/context/task 不进入 B；切回 A 仍完整 | `project-agent-canvas-isolation.e2e.mjs` + resident UI assertion |
| Skill/MCP 隐私 | internal Skill 猜 name/URI/read/prompts 不可见；UI 不扩大 capability | Phase 5 evidence 复用；改相关指纹才重跑 |
| 视觉/无障碍 | 与样张一致、双主题、窄窗无 overlap、非颜色状态、键盘焦点/i18n | Playwright screenshots + 人眼/a11y inspection |
| owner 删除 | 旧 panel shell/history/composer/status owner 不可重新路由 | `check:capability-owners`、vocabulary/结构 test、人工对偶审计 |

现有真实路径证据可复用：

```text
tests/ux/agent-runtime-editing.walk.mjs
tests/ux/agent-runtime-provider.walk.mjs
tests/ux/project-agent-canvas-isolation.e2e.mjs
tests/ux/production-mcp-journey.e2e.mjs
tests/system/profiles.mjs
```

不要用只测 mock store 的断言支持“真实跨页面/重启/审批体验已完成”。

## 12. 最终候选：只整合一次 main

Phase 6 focused checkpoint 推远端后，才进行最终整合：

1. 确认 Phase 6 分支/PR/工作树可恢复；
2. `git fetch origin`，记录一个固定的 `origin/main` SHA；
3. 检查 PR/UI/Capability/ProductionRun/Skill/MCP 相关主线增量和真实冲突；
4. 在当前任务分支执行 `git merge --no-ff <pinned-origin-main-sha>` 一次；禁止 rebase、force-push
   或修改远端 `main`；
5. 解决冲突时保留双方真实语义，不用 `ours/theirs` 批量吞掉；
6. 固定候选后，不因 `main` 普通移动而重复追赶。只允许一次 bounded repin：分支保护明确阻塞
   ready/mergeability，或 `main` 落入直接相关的安全/正确性修复；先记录原因和新 SHA，再执行同样的
   `merge --no-ff`，不得 rebase；
7. 对该候选运行唯一一次完整门和真实旅程；
8. 修复必须按失败类别定向重验，禁止同签名无变化第三次重跑；
9. 一次 **Final candidate review**；更新路线图和 PR，推最终 checkpoint；
10. 只有所有完成证据成立，才把 Draft PR 改为 ready。未经用户明确授权，不 merge/squash/close。

若触发唯一一次 bounded repin，原 candidate 的 full/release/package、真实旅程和 Final candidate
review 全部失效；在新固定候选上各重新执行一次。第二次仍被主线移动阻塞时停止追赶并报告仓库
策略问题，不能进入无限 merge/test 循环。

## 13. 最终验证与交付

仓库现有聚合命令优先，不手工拼一套平行流程：

```bash
pnpm run test:system:full
pnpm run dist:mac:dir
pnpm run test:system:release
```

三个命令在 pinned final candidate 上各执行一次，`test:system:release` 不是可选项。`test:system:full`
覆盖 capability matrix、全量 gates（contracts/lint/typecheck/test/build）、Electron smoke、CI journeys、
MCP journey 和 project-agent Surface isolation；`release` 再覆盖 all journeys 和真实 generation。
失败后先按失效指纹跑 focused stage，不盲目重跑整个 profile；同签名无代码/输入/环境变化时禁止
第三次执行。`dist:mac:dir` 构建 macOS arm64 app 并运行 packaged MCP smoke；若 PR 的正式支持矩阵
要求 DMG/ZIP/Windows，再按 `package.json` electron-builder 目标补相应 package，不得用 renderer build
代替 package 证据。

### 13.1 付费测试纪律

执行 `test:system:release` 前先读取固定候选上的 `tests/system/profiles.mjs` 和它引用的真实生成脚本，
把 provider、model、输入、环境开关、预期支出和既有可复用 receipt 写入路线图/PR 证据。当前 profile
的硬上限是 **一个新的付费 generation provider job**；judge/agent 调用另行记录，但不得触发第二个
generation job。release 成功产生的 job/receipt/artifact 同时作为手工端到端旅程的付费证据，手工
验收只继续读取、打开、播放和对账，不再提交一次同类付费任务。

运行期间记录 provider request、job id、ProductionRun、authorization/receipt 和最终 artifact 的一一
对应。出现第二个 provider job、重复/未知 receipt、`submission_unknown`、实际 provider/model/价格
越出记录边界，或无法判断是否已提交时立即停止后续付费动作，先 reconciliation；绝不能靠重跑
profile 判断结果。仓库规则授权的是这一个有界评测，不是无限重试或重复消费。

此外必须人工完成并留证：

- 获批样张 vs 最终 app 的逐项截图对账；
- 创作请求 -> document approval/apply/Undo -> 生成画布 -> paid ProductionRun approval ->
  artifact preview -> 时间轴 -> 导出；
- 执行中从创作切生成再切预览，同一 Item 只执行一次；
- busy queue edit/cancel、Stop、decline/timeout、冷重启恢复；
- 项目 A/B 切换、旧窗口迟到 reply、跨项目隐私；
- internal Skill 经 list/read/resources/prompts 和猜 URI 均不可见；
- packaged app 中 MCP、审批、TaskCenter、artifact/player、导出 manifest 与真实作品一致。

Phase 5 时 `tsconfig.test.json` 存在大量历史测试 typing 红线，新增 affected tests 不在错误列表；
这不是最终候选的永久豁免。整合固定 `main` 后重新核验：若仓库正式 gate 已覆盖/修复则按最新事实；
若它仍是显式发布要求，就必须分类并解决，不能用 Phase 5 的旧记录宣称最终全绿。

## 14. 高概率踩坑

1. **把旧 handoff 当真。** 它的完整迁移方案已废止；恢复会重新引入大量兼容/双写复杂度。
2. **提前追 main。** PR 当前冲突是已知漂移；Phase 6 checkpoint 前整合只会制造重复冲突和全量门成本。
3. **直接 cherry-pick 历史 UI PR。** 它们落后且曾有质量门问题，只能提取摩擦证据和设计判断。
4. **在 Preview 再建一个 Agent。** 正解是同一 resident projection，不是第三面板/第三 owner。
5. **把 UI 卡片变成状态 owner。** proposal/task/artifact 卡只读稳定 ref；事实仍在 Host/领域服务。
6. **为了过渡保留双 shell/fallback。** Phase 6 production cutover 同 commit 删除旧重复 owner。
7. **用粗 DTO 吞状态。** 兼容 `pending/streaming/error` 不能掩盖 Host 的 queued/proposed/declined 等语义。
8. **把 Skill 选择当授权。** Skill 只能 shrink Host ceiling；user import 永远 internal，除非未来有批准的 consent UI。
9. **把 MCP/TaskCenter 写进聊天账本。** MCP transport 和 ProductionRun 有各自 authority，Host 只存 refs/projection。
10. **反复跑全量。** focused UI 期只跑失效证据；完整 test/build/package 只在 pinned final candidate 跑一次。
11. **忽略真实视觉。** 单测绿不证明不遮挡、滚动正确、文案不截断；必须亲眼看截图和真机。
12. **修改 `AGENTS.md`。** 它由 `CLAUDE.md` 生成；规则变更改真源再 `pnpm run gen:agents`。

## 15. 下一位 AI 的第一轮行动清单

在用户尚未提供交互设计时：

- 只核验现场和阅读上述文件；
- 不开始 Phase 6 生产 UI，不整合 `main`，不重跑全量；
- 可以把用户提供的新设计材料归档、对照和提炼问题，但不能替用户拍板产品方向。

收到用户设计后：

1. 核验 Git/PR/工作树，保护任何新改动；
2. 对 UI/new PR 做一次增量 evidence 审计；
3. 更新路线图中的 Phase 6 冻结合同和两个宏批次；
4. 基于真实工作台制作 feature-complete mockup；
5. 用户拍板；
6. 一次 Phase 6 contract review；
7. 实现 resident shell 原子切换、focused closure、截图对账和远端 checkpoint；
8. 固定一个 `main` SHA 并以 `git merge --no-ff` 非破坏性整合；
9. 在最终候选各跑一次 full/release/package/真实旅程，遵守一个付费 generation job 上限；
10. 一次 Final candidate review，更新 PR 到可合并状态，报告 branch/commit/PR/证据和残余风险。

## 16. 什么才算任务完成

以下全部同时成立才可以把长期目标标记为 complete：

- Phase 6 获批样张和生产 resident UI 已交付；
- 创作/生成/预览使用同一 Host thread/item/queue，旧重复 owner 已删除；
- Phase 1-5 owner、安全、迁移、付费、Skill/MCP 合同在最终候选没有回归；
- 固定的 `main` 已非破坏性整合（仅允许 §12 定义的唯一 bounded repin），PR 不再 conflicting；
- full gates、typecheck、tests、build、package、MCP/Surface/真实用户旅程均有当前候选证据；
- 重启、跨项目、迟到回调、隐私、审批、Undo、ProductionRun 和导出事实验收通过；
- 路线图、架构文档、PR 描述和证据指向最终 commit；
- PR #223 已从 Draft 更新到 ready/可合并，但未在无授权情况下 merge。

任何单个绿色测试、Phase 6 UI 截图、远端 checkpoint 或 `Workers Builds: nomi` success 都不足以单独证明完成。

## 17. 可直接复制给下一位 AI 的启动 Prompt

```text
接手并继续完成 Nomi 的 Project Agent Host 长期任务。不要只做状态汇报；在用户补充并拍板
Agent 交互设计后，持续推进 Phase 6、最终主线整合、全量验证和 PR 可合并交付。

唯一工作树：
/Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827

任务分支：codex/project-agent-host-phase1-20260827
Phase 5 代码 checkpoint：63c825ce7aecbe1a6ca07446733c84d789090290
Draft PR：https://github.com/aqm857886159/Nomi/pull/223

开始前必须完整读取：
1. AGENTS.md
2. docs/ARCHITECTURE-NOW.md
3. docs/plan/2026-08-29-project-agent-host-execution-roadmap.md（唯一计划/状态真源）
4. docs/superpowers/plans/2026-08-30-project-agent-host-phase6-handoff.md（完整恢复说明）
5. docs/superpowers/specs/2026-08-27-project-agent-host-design.md
6. docs/audit/2026-08-29-project-agent-pr-evidence.md
7. docs/audit/2026-08-29-project-agent-pr-coverage-index.md
8. docs/design/nomi-design-system.md
9. .agents/skills/engineering-plan-delivery/SKILL.md

先用 live Git/PR 只读核验 handoff，不凭聊天记忆或过期 remote-tracking ref 工作。依次执行：
pwd -P
git rev-parse --show-toplevel
git branch --show-current
git remote get-url origin
git status --short --branch
git fetch origin
git rev-parse HEAD origin/main origin/codex/project-agent-host-phase1-20260827
git ls-remote --heads origin main codex/project-agent-host-phase1-20260827
gh pr view 223 --repo aqm857886159/Nomi \
  --json url,isDraft,state,headRefName,headRefOid,baseRefName,mergeable,statusCheckRollup

物理目录/repo root、origin、branch、live task SHA 和 PR head/base 必须互相一致；live task SHA 必须
包含 63c825ce 和本 handoff checkpoint。当前预期 Phase 1-5 已推送、Phase 6 未开始、PR 为 Draft，
`Workers Builds: nomi` 成功，PR 可能因 main 漂移显示 CONFLICTING。若事实不同，保护所有改动，
禁止 reset/checkout/覆盖/merge/rebase，先归属差异并更新唯一路线图。

关键边界：
- 不要在 /Users/aoqimin/Desktop/Nomi 或其他 Nomi worktree 改这个任务。
- 用户明确取消旧 Agent 会话/Pi context 的无损迁移：只读归档 + 新 Host 干净启动；旧 pending
  审批失效，未知执行不重放。作品数据与 ProductionRun 必须保留，新旧不能双写。ProductionRun
  “恢复”只指读取、核账、关联既有 run/job/receipt/artifact；未知付费提交只能 reconciliation，
  绝不自动 retry/resubmit。
- ProjectAgentHost 是 Thread/Turn/Item/queue owner；文档、画布、时间轴、ProductionRun、素材和
  artifact 继续由各自领域 owner 持有；UI 只投影稳定 ref。
- Skill 只能缩小 Host 权限，用户导入 Skill 永远 internal；MCP/Registry/审批/付费合同已在
  Phase 5 前冻结，Phase 6 不得反向改权限或新增第二 owner。
- 当前 CreationAiPanel 和 CanvasAssistantPanel 已读同一 Host 投影，但仍是两个旧外壳；Preview
  没有 Agent。Phase 6 的目标是一个 resident shell 跨创作/生成/预览，并同批删除重复 shell/
  composer/history/status owner，不保留 fallback。
- 用户还会补充 Agent 交互设计。在收到并冻结该输入、基于真实 Workbench 做 feature-complete
  mockup、让用户拍板之前，不写 Phase 6 生产 UI。
- Phase 6 只补 UI/new-PR 增量 evidence；历史 PR 是问题/设计证据，禁止直接 cherry-pick。
- 不在 focused UI 期间追逐 main 或反复跑全量。Phase 6 focused checkpoint 推远端后，才 fetch
  并 pin 一个 origin/main SHA，以 `git merge --no-ff <pinned-origin-main-sha>` 整合；禁止 rebase。
  main 普通移动不追。只在分支保护明确阻塞 ready/mergeability，或直接相关安全/正确性修复落入
  main 时允许一次 bounded repin；repin 后全部 final-candidate 证据失效并各重跑一次。
- 不 force-push，不直接 push main，不自行 merge/squash/close/approve PR。

执行采用两个宏批次：
A. 用户设计输入 -> UI/PR 增量审计 -> Phase 6 冻结合同 -> 真实布局 feature-complete mockup ->
   light/dark/窄窗截图和用户拍板 -> 一次 Phase 6 contract review -> commit/push 设计恢复点。
B. 一个 resident shell 原子接入 Creation/Generation/Preview -> queue/Stop/approval/task/artifact/
   thread/Skill-context 完整状态 -> 删除旧重复 owner -> focused tests + Playwright 截图对账 + 一次
   Phase 6 implementation diff review -> commit/push Phase 6 checkpoint。

三个 review 的范围不同且各只做一次 broad review：Phase 6 contract、Phase 6 implementation diff、
Final candidate。P0/P1 修复只做同 reviewer 的 scoped re-review，不重开 broad review。

最后按 handoff §12-13 固定/整合 main，并在 pinned final candidate 各执行一次：
pnpm run test:system:full
pnpm run dist:mac:dir
pnpm run test:system:release

release 是必跑项。运行前读取固定的 profile/真实生成脚本并记录 provider/model/input/预计支出；
最多允许一个新的付费 generation provider job。复用它的 job/receipt/artifact 做手工旅程，不再
另提同类付费任务。出现第二 job、重复/未知 receipt、submission_unknown 或 provider/model/价格
越界，立即停止并 reconciliation，绝不靠重跑判断。失败只重验失效 evidence，同签名无变化
禁止第三次重跑。

最终做一次 Final candidate review，修到完成证据全部成立，更新路线图、ARCHITECTURE-NOW 和 PR，
把 Draft PR 更新为 ready/可合并但不要擅自 merge。每个有意义宏批次都 commit/push，报告 branch、
commit、PR、验证和残余风险。

你的第一条回复先简洁确认你已经读取并核验现场，说明当前停在 Phase 6 设计输入门；然后让我
提供新的 Agent 交互设计材料。收到材料后不要停在方案说明，按上述流程持续推进到完整交付。
```
