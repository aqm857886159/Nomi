# 调研与指标进流程（先查别人扩到交互 / 坑 / 指标；每个指标要有量具）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

日期：2026-10-19。方向由用户 2026-10-18 在 Claude Design 画布评论里拍板。改的是规则与门岗文档，不改产品代码。

## 问题

1. R5「先查别人」（`docs/engineering/rules.json`，R5）只管代码：三方库、自写能力（`check:prior-art` 只在 `docs/engineering/self-written.json` 变动时才触发，见 `scripts/check-prior-art.mjs`、`scripts/prior-art-lib.mjs`）、外部格式。交互设计没有触发点。
2. 只验「有没有」的门岗会被刷：R5 自己的证据栏写着 prior-art 红灯 60 次几乎全是事后补文档。
3. 设计卡 ★1（`docs/engineering/design-card.md`）要求写主指标 / 质量指标 / 护栏，但没有任何东西去量。目前只有性能会被执行：PR 必须交 `perf-scenario：<id> 中位数 X / p95 Y / 预算 Z`，由 `scripts/pr-judgement-lib.mjs` + `scripts/perf-scenarios-lib.mjs` 解析。

## 先查别人

- Rust RFC 模板有「Prior art」一节（好的坏的都写，「有先例」本身不算理由）加「Rationale and alternatives」：https://github.com/rust-lang/rfcs/blob/master/0000-template.md ，对我们的决定：调研写在做决定的文档里（设计卡 ★0），并要求写「对哪个决定的影响」，不只列链接。
- Kubernetes KEP 模板只有「Alternatives」，没有单独的先例一节：https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md ，对我们的决定：确认了「先例」要单立一格，否则会被「备选方案」吞掉。
- GOV.UK Service Manual 的 discovery 阶段：动手前先了解用户、现有变通办法和已有服务，discovery 里不做实现，以一个决定收尾，之后每个阶段继续调研：https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works ，对我们的决定：设计流程第 1 步里调研排在探索图之前，摘要和探索图放在一起交用户拍板。
- Google HEART 与 Goals-Signals-Metrics（Rodden、Hutchinson、Fu，CHI 2010）：先写目标，再写信号，最后才是指标，用比例不用原始计数：https://research.google.com/pubs/archive/36299.pdf ，对我们的决定：★1 的指标按目标 → 信号 → 指标写，且每个指标必须点名量具。
- 本仓库现状：`scripts/prior-art-lib.mjs:1` 的门岗只判「节在不在、出处够不够」，R5 证据栏已承认这类存在性门岗会被事后补文档刷过；所以本方案把调研放到决策现场、由做决定的人消费，门岗只当兜底（`docs/design/boards/` 的 `priorArt` 字段随板校验）。

## 改动（调研放在做决定的地方，由做决定的人消费；门岗只兜底）

1. 设计卡新增 ★0「先查别人」格，排在 ★1 之前：≥3 条，每条「出处 · 它怎么做 · 对我们哪个决定的影响（改了 / 确认了）」。四类（花钱 / 长跑 / 可打断 / 新界面）和新增功能必填，纯 bug 修复不要求。
2. 设计卡 ★1：每个指标必须点名量具（评测集 `evals/<功能>/`、perf 场景 id、走查脚本、或使用遥测事件）；一个都没有就写「未验证：缺量具」。指标按目标 → 信号 → 指标写，用比例不用原始计数。
3. `docs/engineering/design-pipeline.md` 第 1 步：先调研再出探索图；调研摘要放在 Claude Design 画布上探索图旁边，用户拍板时能看到。
4. 板清单 `docs/design/boards/<日期>/*.board.json` 新增必填 `priorArt` 数组（≥3 项 `{url, takeaway, decisionImpact}`），日期目录 ≥ 2026-10-19 的板才查；`scripts/check-board-parity.mjs` 校验，单测带一个红例一个绿例；更早的板不受影响。
5. `scripts/claude-hooks/self-check.sh`：每个生命周期时刻一行触发提示（产品方向 / 交互 / 技术选型 / 外部格式 / 通用能力 / 别人踩的坑 / 评测指标 / 规则本身），提醒查 ≥3 个先例并记下对决定的影响；命中才注入，常驻段不变。
6. `rules.json` R5 扩到交互设计、别人踩过的坑与指标，执行点补上新增的；`node scripts/gen-rules-view.mjs` 重生规则视图；CLAUDE.md P5 加一小句；`pnpm run gen:agents`。
7. 编排手册 `docs/engineering/agent-orchestration-playbook.md` 新增 §21「规则对标例行」：协调会话每月读 1–2 份外部流程资料（RFC / KEP / GOV.UK / 事故复盘模板等），把发现变成规则提案交用户。

## 设计卡

- ★1 用户怎么用：当协调会话或实现线要做一个新功能或新界面，我想在动手前就看到「别人怎么做、这改了我们哪个决定」和「每个指标拿什么量」，以便用户拍板时看的是有依据的方案。不做什么：不新增评测基础设施、不新增 PR 证据 id。已知坑：存在性门岗会被事后补文档刷过（R5 证据栏）。真实任务：①本 PR 自己的 ★0（上面四条）；②下一个新界面板的 `priorArt`；③下次设计卡的指标栏写出量具。指标：目标 = 决定有依据；信号 = 设计卡 ★0 每条写了「改了 / 确认了」；指标 = 带 ★0 的新功能 PR 占比，量具 = 未验证：缺量具（本轮不建，见后续）。
- ★2 谁说了算：概念「设计卡格子定义」唯一 owner 是 `docs/engineering/design-card.md`；`scripts/pr-body-criteria.mjs` 只读 ★1–★9，不读 ★0；板清单格式唯一 owner 是 `check-board-parity.mjs` 的 `checkBoardManifest`；同一事实只存一份。
- ★3 一致与复用：复用 `check-board-parity` 现有校验入口和 `self-check.sh` 现有 `hit_block` 机制，没有新门岗、没有新脚本；先例格式与 `check:prior-art` 的「出处」口径一致（URL）。
- ★4 全状态：不适用：没有用户可见界面，只改规则文档、一个门岗校验和一个提示 hook。
- ★9 验收与回滚：验收（另一条线）：`node --test scripts/check-board-parity.node-test.mjs scripts/self-check-hook.node-test.mjs`、`pnpm run check:board-parity`、`pnpm run check:rule-aliases`、`pnpm run check:agents-sync`、`pnpm run check:prior-art`；反例：2026-10-19 日期目录的板缺 `priorArt` 或不足 3 项 → 红；2026-10-18 及更早的板不带 `priorArt` → 绿；每个新 hook 行只在关键词命中时出现，中性消息和既有三条泛词用例不触发；回滚：revert 本 PR 的合并提交。

## 后续（不在本 PR）

- AI 产出类功能的 `eval` PR 证据 id：像 `perf-scenario` 一样可解析，让质量指标也有人执行。
- 把本地、需用户同意的使用遥测做完（`docs/plan/2026-09-06-opt-in-frequency-telemetry.md`）；用户层面的指标（留存、使用频率这类比例）依赖它。
