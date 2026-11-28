# 设计卡：`UX-A4` Agent 空态「帮 Nomi 变好」首次遥测询问卡延后到首次生成或首轮对话后出现

```
改动名：Agent 空态首次遥测询问卡延后触发（UX-A4）    线/负责人：impl-ux-a4    类别：[新界面][Agent 行为][性能]
```

> 背景：对应 `docs/plan/2026-11-28-ux-simple-audit-phase1.md` `U-18①` / `A4`（用户已在协作看板 `#1586` 预批按推荐执行）。
> 拍板图清单核验：`git grep -in "consent\|变好" docs/design/boards/` 0 命中——`V4ConsentCard` 未被任何 `.board.json` 锚定；本次不改卡面视觉、文案或按钮布局，不触碰任何 `.board.json`。

## ★0 先查别人

- https://developer.apple.com/design/human-interface-guidelines/privacy · Apple HIG（Privacy & Requesting Permission）：请求共享数据或诊断许可必须在用户理解上下文并体验到核心价值之后发出，避免在首次打开空白界面时立即打断 · **确认了**：首次遥测询问不应出现在新建空白项目的第一屏，须延后到创作者完成首次生成或首轮对话之后。
- https://www.nngroup.com/articles/permission-requests/ · Nielsen Norman Group（Permission Requests in UX）：在用户尚未完成任何主任务前弹出二选一授权卡会显著抬高认知负担并提高条件反射式拒绝率，应绑定明确的价值时刻（value moment）再请求 · **改了**：将触发条件从「`!hasAskedAgentConsent()` 即弹」改为「`!hasAskedAgentConsent()` 且已完成首次生成或首轮对话」。
- `src/workbench/onboarding/onboardingState.ts:25` 与 `src/workbench/onboarding/onboardingProgress.ts:41` · 仓库已有唯一的跨会话一次性标记真相源（`nomi:checklist:v1` 的 `generated` 与 `nomi:agent-consent-asked:v1`） · **确认了**：直接复用 `onboardingState.ts` 集中维护首次对话完成标记与统一准入谓词 `canAskFirstAgentConsent()`，不另起第二套 localStorage 状态机。
- `docs/plan/2026-10-17-telemetry-perf-buckets.md:20` · 既往遥测范围升级再确认设计（`V4ConsentCard` 的 `scope` 形态与 `force` 实验室透传） · **确认了**：延后逻辑仅作用于 `mode === 'first'`，`mode === 'scope'` 与设计实验室 `force` 参数完全保持原语义。
- 出口：不涉及：本改动仅延后非阻断性的可选遥测询问卡出现时机，不新增、扩大或挪动任何挡住用户的操作保护；用户任何时刻都可在「设置 → 通用 → 帮助改进 Nomi」手动开关遥测。

## 设计卡正文

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我是一名刚装好 Nomi 并配好模型的新创作者，建完第一个空白项目进入创作页时，我想先安静地看清创作区和 Agent 起手建议、直接开始写脚本或出图，以便不被首屏二选一弹窗打断。路径（5 步）：① 点新建项目进创作页 → ② 右侧 Agent 空态只展示一句话标题与 3 颗起手 chip（零遥测打断） → ③ 创作者在画布生成第一张图，或完成首轮 Agent 对话 → ④ 在空态下（画布出图完成当下，或首轮对话后新建空对话/新项目）首次见到「帮 Nomi 变好」卡 → ⑤ 点「愿意」或「不分享」后卡片收起且跨冷启动永不复现。不做：不改卡片文案/按钮尺寸、不加「稍后再说」、不改设置页开关、不碰 `scope` 再确认流程。已知坑：若创作者永远只写文稿、既不生成也不发任何对话，卡片不会出现，但设置页入口始终可用。真实任务：① 新手建空项目进入创作页直写脚本（验证首屏零打断）；② 画布生成首图后在 Agent 空态看到询问卡并点选「愿意」落盘且重启不再弹；③ 老用户带 `scopeVersion < 2` 升级后空态仍正常弹出 `scope` 再确认卡。指标（GSM）：目标「首屏零无关决策打断」→ 信号「首次进空白创作页可见 `[data-v4-block="consent"]` 比例」→ 指标从 `100%` 降至 `0%`（量具：`tests/ux/feedback-loop-consent-and-report.walk.mjs` 与 `src/workbench/ai/v4/AgentPanelV4Consent.test.tsx`）；护栏「达成首次里程碑后首次询问到达率 `100%`、答后复弹率 `0%`、旧范围再确认到达率 `100%`」（量具：`tests/ux/feedback-loop-consent-and-report.walk.mjs`、`tests/ux/telemetry-scope-reconfirm.walk.mjs`）。 | `src/workbench/ai/v4/AgentPanelV4Consent.test.tsx`、`tests/ux/feedback-loop-consent-and-report.walk.mjs`、`tests/ux/telemetry-scope-reconfirm.walk.mjs` |
| ★1b 连带界面 | 仅影响右侧常驻 Agent 面板空态（`AgentPanelV4Empty.tsx` → `AgentPanelV4Consent.tsx`）。设置页「帮助改进 Nomi」、反馈卡、Agent 回执、通知与撤销提示均无文案或状态变更；设计实验室 `08-consent.tsx` 与 `noAccentOutlineLabKit.tsx` 走 `force` 属性，展示不变。 | `src/devlab/designLab/v4/states/08-consent.tsx`、`tests/ux/design-lab-agent-panel-v4.walk.mjs` |
| ★1c 老用户 | 老用户已答过首次询问（`nomi:agent-consent-asked:v1 === 'asked'`）：升级后 `canAskFirstAgentConsent()` 恒为 `false`，不会再次弹首次卡；若同时开启遥测且 `scopeVersion < 2`，`mode === 'scope'` 逻辑不变、仍正常出现范围升级再确认卡。老用户未答过但已有生成或历史多会话：打开即通过 `readChecklist().generated` / `hasSettledAgentConversation()` 满足条件，正常问一次。不涉及项目存档或主进程设置格式迁移，退回上一版无任何兼容问题。 | `tests/ux/telemetry-scope-reconfirm.walk.mjs`、`src/workbench/ai/v4/AgentPanelV4Consent.test.tsx` |
| ★2 谁说了算 | 概念「首次遥测询问准入条件」唯一 owner 为 `src/workbench/onboarding/onboardingState.ts`（`canAskFirstAgentConsent` / `hasCompletedFirstAgentTurn` / `markFirstAgentTurnCompleted` / `ONBOARDING_STATE_SYNC_EVENT`）；允许的写入方：`onboardingProgress.ts`（生成成功调用 `markChecklistStep('generated')`，首轮 Agent 对话完成或存在历史多线程调用 `markFirstAgentTurnCompleted()`）、`AgentPanelV4Consent.tsx`（答完调用 `markAgentConsentAsked()`）；唯一消费方：`AgentPanelV4Consent.tsx`。`localStorage` 不可用时 fail-closed 返回 `false`（宁可少问一次也不每次弹窗），不把未知当成「未问过」。同一准入规则全仓仅 1 处（靠组件只调用 `canAskFirstAgentConsent()` 维持）。 | `node scripts/door-map.mjs src/workbench/onboarding/onboardingState.ts src/workbench/ai/v4/AgentPanelV4Consent.tsx` |
| ★3 一致与复用 | 既往决策：`docs/plan/2026-10-17-telemetry-perf-buckets.md` 确立了 `V4ConsentCard` 复用同一组件承载 `first` / `scope` 及 `force` 实验室入口，以及 `onboardingState.ts` 集中管理跨会话一次性标记；用户 `#1586` 已预批将 `first` 延后至首次生成或首轮对话后。三条路对比：沿原方向在 `onboardingState.ts` 收口统一谓词（选此路，复用现有 `checklist.generated` 与事件同步，零新状态库） vs 在组件内各自读画布/lane store（否决，会产生第二套事实） vs 直接删除遥测首次询问卡（否决，违反既有自愿开启机制）。完全复用 `onboardingState.ts` 与 `V4ConsentCard`。 | `git grep -n "hasAskedAgentConsent\|markChecklistStep" src/` |
| ★4 全状态 | 空（全新空白项目未生成未对话）：不渲染遥测卡，仅显示空态标题 + 起手 chip；加载（`hasTextModel === null` 或 `telemetry.get()` 进行中）：保持静默不闪烁；成功（首次生成完成或首轮对话结束后处于空态）：渲染 `mode="first"` 卡，中英文文案与等宽双钮不变；失败/中断（Agent 首轮报错或流式中断）：不触发里程碑、不弹卡；取消中：不适用（无异步提交状态）；过期：不适用（里程碑持久有效，回答后永久关闭）；能力不可用（无文本模型时由 `NoTextModelRecoveryCard` 接管空态，提供一键连接 APIMart 或启用模型入口；`localStorage` 不可用时静默不弹，设置页仍可手动开启）。无新增会被数据撑开的文本容器，不改任何 i18n 键。 | `pnpm run check:i18n`、双轨真窗截图 |
| 5 中途表 | 未达成里程碑 ×（停/关窗/断网/重启/连点）：不弹卡 · 不花钱 · 无回执；生成中/流式对话中 ×（停/关窗/断网/重启/连点）：未结算不写里程碑，不弹卡 · 不额外花钱 · 各自按既有任务/会话恢复；里程碑已达成未作答 ×（停/关窗/断网/重启/连点）：下次进空态仍稳定出现一次，连点主/次钮在首击即写 `asked` 并置 `mode=null` 防重复提交 · 不花钱 · 设置落盘由主进程 `telemetry.set` 幂等处理；已作答 ×（全部五种打断）：`nomi:agent-consent-asked:v1 === 'asked'` 已落盘，永不复弹 · 不花钱 · 主进程 `telemetry-settings.json` 为真相源。 | `src/workbench/ai/v4/AgentPanelV4Consent.test.tsx`、`tests/ux/feedback-loop-consent-and-report.walk.mjs` |
| 6 外部数据与失败 | 外部输入仅两类：① `window.localStorage`（Web Storage 规范 https://html.spec.whatwg.org/multipage/webstorage.html · 隐私/沙箱异常时可能抛错 · 统一 `try/catch` fail-closed，不弹卡不崩溃）；② 主进程 IPC `settings.telemetry.get/set`（内部契约 `electron/shared/contracts/telemetry.ts` · 拒绝时静默吞错不弹 `scope` 卡，不归咎用户）。 | `src/workbench/onboarding/onboardingState.ts`、`src/workbench/ai/v4/AgentPanelV4Consent.tsx` |
| ★7 性能 | 不适用：本改动仅在 `onboardingState.ts` 增加 1 个 O(1) `localStorage` 布尔键读写与同窗 `CustomEvent` 监听，不新增任何用户交互操作、列表渲染或高频动画；零新增定时轮询或长任务，对画布/时间轴/打开耗时无影响。 | `src/workbench/onboarding/onboardingState.test.ts`、`src/workbench/ai/v4/AgentPanelV4Consent.test.tsx` |
| 8 真实条件 | macOS 中文浅色（`1280x800`）、英文深色（`1280x800`）、干净隔离安装（`--data empty`）及里程碑达成后现身态均已真窗实测并亲眼 Read 截图；键盘操作沿用既有 `DecisionBar`；Windows / 真付费：`unverified`（本次不涉付费与平台差异 API）。 | 真窗改前/改后截图与 `feedback-loop-consent-and-report.walk.mjs`、`telemetry-scope-reconfirm.walk.mjs` |
| 拍板图清单 | 不适用：`V4ConsentCard` 未被任何 `docs/design/boards/**/*.board.json` 锚定（全仓 `git grep` 0 命中），且不改卡面视觉与元素结构。 | `pnpm run check:board-parity` |
| ★9 验收与回滚 | 验收清单与反例：① 全新空白项目进创作页时 `[data-v4-block="consent"]` 不存在（反例：do-nothing 版本立即弹出 → 单测与走查必红）；② 生成首个节点成功或完成首轮对话后，空态中出现 `mode="first"` 询问卡（反例：block-all 版本永不弹出 → 单测与走查必红）；③ 首轮对话流式进行中或被中断不触发解锁；④ 点击「愿意 / 不分享」后卡片立即消失、写入 `asked` 标记、冷启动重开不再弹；⑤ 传 `force="first"` / `force="scope"` 仍立即渲染（设计实验室不破）；⑥ 旧范围已同意用户仍正常弹出 `mode="scope"` 再确认卡。独立验收：由独立验收线对照上述清单与双轨截图核验。回滚：单 commit `git revert` 即可无损恢复，新增 localStorage 键 `nomi:first-agent-turn-completed:v1` 在旧版下被安全忽略。 | `pnpm exec vitest run src/workbench/onboarding/onboardingState.test.ts src/workbench/ai/v4/AgentPanelV4Consent.test.tsx`、`node tests/ux/feedback-loop-consent-and-report.walk.mjs`、`node tests/ux/telemetry-scope-reconfirm.walk.mjs` |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## 按钮普查

本次不新增、不删除、不重命名任何按钮；沿用既有 `V4ConsentCard` 的两颗等尺寸按钮：

| 设计来源 / 组件 | 变体 / 状态 | 无障碍角色 + 名称 | 用户动作 | 预期的界面状态和副作用 | 测试 ID | 证据 |
|---|---|---|---|---|---|---|
| `V4ConsentCard` + `DecisionBar` | `mode="first"`（里程碑达成后首次出现） | `button` · `agentPanelV4.consent.accept`（愿意 / I’m in） | 点击 | 写 `nomi:agent-consent-asked:v1=asked`、调用 `telemetry.set({ enabled: true })`、卡收起且永不复现 | `[data-v4-consent-accept]` | `AgentPanelV4Consent.test.tsx`、`feedback-loop-consent-and-report.walk.mjs` |
| `V4ConsentCard` + `DecisionBar` | `mode="first"`（里程碑达成后首次出现） | `button` · `agentPanelV4.consent.decline`（不分享 / Don't share） | 点击 | 写 `nomi:agent-consent-asked:v1=asked`、不开启遥测、卡收起且永不复现 | `[data-v4-consent-decline]` | `AgentPanelV4Consent.test.tsx` |
| `V4ConsentCard` + `DecisionBar` | `mode="scope"`（已同意旧范围老用户） | `button` · `agentPanelV4.consent.scopeAccept` / `scopeDecline` | 点击 | 写 `nomi:agent-consent-scope-asked:v2=asked`；同意时升范围到 v2 | `[data-v4-consent-accept]` / `[data-v4-consent-decline]` | `telemetry-scope-reconfirm.walk.mjs` |

## 补、换、删

**换（同提交替换旧触发条件）**：在 `V4ConsentCard` 中将旧的 `!hasAskedAgentConsent()` 直接弹卡判断替换为统一的 `canAskFirstAgentConsent()`（由 `onboardingState.ts` 单点持有），无并行旧分支与 fallback。
