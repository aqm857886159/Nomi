# C0 official planner gate, round 2

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Scope: test-only scheduler, CLI, isolated catalog, outbound budget and response receipts. No product code or C0 acceptance assertions change. User authorizes original PR #646 delivery and a single real film, eight shots, local CNY 50 cap.

Root cause (recurring): the harness conflates planner identity with media vendor. CLI, catalog filtering, model selection, transport allowlist and pricing all assume APIMart. Earliest owners are scheduler mode resolution and the quoted dispatch boundary. Scan: c0-real-scheduler, c0-real-budget, c0-real-main, c0-plan-sample-budget and sweep-real. Existing plan-only/mixed APIMart paths remain explicitly supported; official planner cannot silently route through a reseller. No production repair contract needed: all changes are harness-only.

Prior art: tests/agent-runtime/lane-b1b-real.electron.mts uses usage-based text accounting; electron/catalog/secrets.ts owns safeStorage encryption. Official standard https://api-docs.deepseek.com/quick_start/pricing and https://api-docs.deepseek.com/ confirm OpenAI chat-completions and cache accounting. Checked 2026-09-10 through browser (HTTP initial HTML incorrectly serves first-call page). Peak USD/MTok for v4-pro: input miss 1.32, hit .044, output 3.96; reserve and estimate at peak rate, disclose conservative estimate. No new runtime dependency or custom external format.

Implementation: explicit planner vendor policy; source-dated price table; strict endpoint/model enforcement; capture real response usage without rewriting it; encrypted environment credential in isolated settings; UI model picker. APIMart media remains quoted and reserved. No balance queries. Missing usage retains full reservation and blocks a success receipt. Price/usage tests and mode matrix first fail then pass.

Verification: changed node tests, root-cause gate, full gates; normal commit/push hooks. Rebuild package because product diff since dbb22121b is nonempty. One real film; preserve model response evidence, screenshots and R30. If green, three checks, exact-head PR merge and verify-merged receipt. Otherwise no merge.

Rollback: revert the scoped harness commit. Remove isolated profiles at cleanup; keep evidence. Local budget change never committed.

## 先查别人

- 仓库已有计费参考：`tests/agent-runtime/lane-b1b-real.electron.mts:60` 预留后读取真实 usage，作为本次文本账本参考。
- 依赖能力复用：`electron/catalog/secrets.ts:73` 的 `makeApiKeyRecordFromPlain` 负责 Electron safeStorage 加密；harness 不实现另一套凭据加密。
- 官方协议与价格：https://api-docs.deepseek.com/quick_start/pricing ，2026-09-10 浏览器原文已留证；沿用 OpenAI chat/completions 和 usage 字段，不设计新协议。
- 社媒不适用：这是内部测试隔离与出站计费边界，官方协议和仓库实现可以直接验证，不以社媒转述证明价格。
- 结论：复用既有加密、隔离和 UI 组件，只扩展 test-only planner identity 与报价边界，不增加产品实现。
