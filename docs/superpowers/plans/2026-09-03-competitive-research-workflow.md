# Competitive Research Workflow Implementation Plan

状态：✅ 已交付

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套可以重复执行的竞品/开源能力研究工作流，并用 3D 导演台开源对齐研究作为第一个真实样例。

**Architecture:** 研究方法放在版本化 Skill 和人类可读 SOP 中；最终报告采用固定目录和证据状态；一个无副作用的 Node 检查器验证报告是否具备来源、状态、动作截图和媒体边界。检查器只在显式命令中运行，不放进每次提交 hook，避免把“研究进行中”误判成代码失败。

**Tech Stack:** Markdown, Node.js built-in test runner, ESM, existing Three.js/React Three Fiber/Leafer references, official GitHub and vendor documentation.

**Spec:** `docs/research/competitive-research-workflow.md`

## Global Constraints

- 不修改 3D 导演台生产代码；本任务只交付研究基础设施和研究报告。
- 所有产品交互证据必须来自 Codex 浏览器截图；Login/Generate/任务 ID 不等于成功。
- 所有开源项目判断必须核对官方仓库、官方文档、许可证和近期活动。
- 不把未经核对的模型权重、人体模型或数据集标成可商用。
- 报告中不保存源视频或音频；TikHub 凭据只能运行时使用。
- 新增行为必须先写失败测试，再写实现；文档和 JSON 配置不适用的部分仍必须经过报告检查器验证。
- 每个新增文档要被 `docs/README.md` 或已有索引收录；文档状态标记不能新增棘轮债务。

---

### Task 1: Define the report validator contract

**Files:**
- Create: `scripts/check-competitive-research-report.node-test.mjs`
- Create: `scripts/check-competitive-research-report.mjs`

**Interfaces:**
- Produces `validateReportDirectory(reportDir): { ok: boolean, errors: string[] }`.
- CLI accepts exactly one `--report <directory>` argument and exits `0` when valid, `1` when invalid, `2` when invocation is invalid.

- [ ] **Step 1: Write the failing tests**

Create temporary report fixtures in the test process and cover:

```js
test('accepts a complete report package', async () => {
  const report = await makeReportFixture()
  assert.deepEqual(validateReportDirectory(report), { ok: true, errors: [] })
})

test('rejects a package without the source ledger and assets directory', async () => {
  const report = await makeReportFixture({ source: false, assets: false })
  const result = validateReportDirectory(report)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /report-source\.md/)
  assert.match(result.errors.join('\n'), /assets/)
})

test('requires a screenshot for every browser action', async () => {
  const report = await makeReportFixture({ actionWithoutScreenshot: true })
  const result = validateReportDirectory(report)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /截图/)
})

test('rejects source video and audio files in a report package', async () => {
  const report = await makeReportFixture({ mediaFile: 'source.mp4' })
  const result = validateReportDirectory(report)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /源视频|源音频/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/check-competitive-research-report.node-test.mjs`

Expected: FAIL because `scripts/check-competitive-research-report.mjs` and `validateReportDirectory` do not exist.

- [ ] **Step 3: Implement the smallest validator**

The validator must check:

1. `README.md`, `report-source.md`, and `assets/` exist.
2. README contains `## Scope`, `## Evidence`, `## Decision`, and `## Source ledger` headings.
3. `report-source.md` contains at least one evidence state from `observed|documented|inferred|proposed|blocked` and one absolute `https://` source link.
4. Every line beginning with `Action:` in either Markdown file is followed within the same paragraph by a Markdown image link.
5. No report file has a source-media extension: `.mp4`, `.mov`, `.webm`, `.mp3`, `.wav`, `.m4a`, or `.aac`.

Do not inspect binary contents, call the network, or hardcode a screenshot count.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/check-competitive-research-report.node-test.mjs`

Expected: PASS for all validator contract tests.

- [ ] **Step 5: Commit the validator contract**

```bash
git add scripts/check-competitive-research-report.mjs scripts/check-competitive-research-report.node-test.mjs
git commit -m "test: define competitive research report gate"
```

### Task 2: Add the explicit report command and documentation workflow

**Files:**
- Modify: `package.json` scripts section
- Modify: `docs/README.md`
- Modify: `docs/research/competitive-research-workflow.md`
- Create: `docs/research/templates/competitive-learning-report.md`

**Interfaces:**
- `pnpm run check:competitive-research --report <directory>` delegates to the validator.
- The template gives a complete package shape without requiring a browser walkthrough for source-only research; it explicitly permits `Walkthrough: not applicable` for code/library studies.

- [ ] **Step 1: Add a command-level failing test**

Extend the node test to spawn the command with a valid fixture and assert exit code `0`, then spawn it with a missing directory and assert exit code `1`.

- [ ] **Step 2: Run the command-level test to verify it fails**

Run: `node --test scripts/check-competitive-research-report.node-test.mjs`

Expected: FAIL because the package script and CLI wiring are absent.

- [ ] **Step 3: Add the command, template, and index links**

Add the package script, link the workflow and template from `docs/README.md`, and document the explicit gate invocation. Do not add it to `gates:contracts` or Git hooks because legacy research packages are not all in the new format.

- [ ] **Step 4: Run the command-level test to verify it passes**

Run: `node --test scripts/check-competitive-research-report.node-test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the workflow contract**

```bash
git add package.json docs/README.md docs/research/competitive-research-workflow.md docs/research/templates/competitive-learning-report.md
git commit -m "docs: codify competitive research workflow"
```

### Task 3: Create the reusable Codex Skill and its eval prompts

**Files:**
- Create: `skills/competitive-research/SKILL.md`
- Create: `skills/competitive-research/evals/evals.json`
- Create: `skills/competitive-research/evals/eval-1.md`
- Create: `skills/competitive-research/evals/eval-2.md`
- Create: `skills/competitive-research/evals/eval-3.md`

**Interfaces:**
- Skill name: `research.competitive`
- Skill output: a report directory matching the template and validator.
- Eval prompts cover product click-through, open-source framework comparison, and TikHub account research with missing credentials.

- [ ] **Step 1: Write eval prompts before finalizing the Skill**

The prompts must force these behaviors:

1. Use browser screenshots for meaningful product actions.
2. Read official repositories and license files for open-source comparisons.
3. Mark TikHub account research `blocked` when no runtime credential is available.

- [ ] **Step 2: Write the minimal Skill**

The Skill must state triggers, evidence labels, browser rules, source-only research rules, Nomi current-state check, screenshot naming, report layout, TikHub credential boundary, and final validator command. It must not claim that it can call TikHub without an available connector/key.

- [ ] **Step 3: Validate Skill structure**

Run: `node scripts/check-mjs-parse.mjs` and inspect the JSON with `node -e "JSON.parse(require('fs').readFileSync('skills/competitive-research/evals/evals.json','utf8'))"`.

Expected: no parse errors; three evals with non-empty prompts and assertions.

- [ ] **Step 4: Commit the Skill**

```bash
git add skills/competitive-research
git commit -m "feat: add reusable competitive research skill"
```

### Task 4: Produce the open-source alignment report for 3D Director Stage and Reference Design Board

**Files:**
- Create: `docs/research/2026-09-03-3d-director-stage-open-source/README.md`
- Create: `docs/research/2026-09-03-3d-director-stage-open-source/report-source.md`
- Create: `docs/research/2026-09-03-3d-director-stage-open-source/assets/.gitkeep`

**Interfaces:**
- The report must be valid under the validator from Task 1.
- It must link to existing Nomi 3D/Lovart evidence instead of duplicating prior screenshot trees.

- [ ] **Step 1: Record the current Nomi baseline**

Use file and line anchors for the existing React Three Fiber, Three.js, Leafer, React Flow, scene capture, motion, camera and reference-slot implementations. State the current friction and what is already reusable.

- [ ] **Step 2: Compare open-source candidates**

For each candidate record: user job, direct capability, official activity date, license, integration cost, evidence status, and Nomi decision. At minimum cover Three.js/R3F, Theatre.js, TRELLIS.2, Hunyuan3D, TripoSR, MMPose, GVHMR, Penpot, Fabric.js, SVG-Edit, and current Leafer.

- [ ] **Step 3: Make the adoption decision**

Conclude that Nomi should keep the existing 3D renderer and Leafer, borrow Theatre.js-style editing concepts, treat motion reconstruction and 3D generation as provider/local adapters, and build a narrow “shot compiler + reference board” product layer.

- [ ] **Step 4: Run the explicit report gate**

Run: `pnpm run check:competitive-research --report docs/research/2026-09-03-3d-director-stage-open-source`

Expected: PASS with no source media files.

- [ ] **Step 5: Commit the report**

```bash
git add docs/research/2026-09-03-3d-director-stage-open-source
git commit -m "docs: align director stage with open source capabilities"
```

### Task 5: Run repository checks and record handoff

**Files:**
- Modify: `docs/research/2026-09-03-3d-director-stage-open-source/README.md` with verification receipts only

- [ ] **Step 1: Run focused validator tests**

Run: `node --test scripts/check-competitive-research-report.node-test.mjs`

- [ ] **Step 2: Run documentation and parse checks**

Run: `pnpm run check:mjs-parse && pnpm run check:docs-index && pnpm run check:doc-status`

- [ ] **Step 3: Run typecheck only if package script changes require it**

Run: `pnpm run typecheck` when the focused checks pass; document unrelated baseline failures separately.

- [ ] **Step 4: Review the diff and verify no production code changed**

Run: `git diff --name-only origin/main...HEAD` and confirm every path is under `docs/`, `scripts/check-competitive-research*`, `package.json`, or `skills/competitive-research/`.

- [ ] **Step 5: Push only the task branch and report the delivery state**

Run the required Ponytail pre-push hook, push `codex/3d-research-workflow-20260903`, and create a PR without merging it. Report branch, commit, PR, focused test results, and any blocked TikHub work.

## Execution receipt — 2026-09-03

- Task 1–4 completed: validator, explicit command, workflow docs, reusable Skill/evals, and open-source alignment report are present.
- `node --test scripts/check-competitive-research-report.node-test.mjs`: 6 tests passed.
- `pnpm run check:competitive-research --report docs/research/2026-09-03-3d-director-stage-open-source`: passed.
- `pnpm run check:mjs-parse`: 573 scripts passed.
- `pnpm run check:docs-index`: passed with existing 322-document baseline.
- `pnpm run check:doc-status`: passed with existing 423-document baseline.
- `pnpm run typecheck`: passed.
- No production 3D or canvas source files changed; TikHub account-level research remains explicitly blocked without a runtime credential.
