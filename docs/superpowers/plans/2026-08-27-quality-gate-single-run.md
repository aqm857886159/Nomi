# Quality Gate Single-Run Implementation Plan

> ✅ 已交付（方案、CI 改动与契约测试随 PR #209 同批落地；状态标记由 `check:doc-status` 门岗要求）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure each pull-request HEAD produces one authoritative Quality Gate run, while preserving a separate post-merge main verification and fail-closed vocabulary baselines.

**Architecture:** The workflow trigger becomes `pull_request` plus `push` to `main` only. Workflow-level concurrency keys PR runs by PR number and main runs by ref, so a newer run cancels only obsolete work in the same lane. A Node contract test reads the workflow source and is wired into `pnpm run gates` as a first-class `check:*` script.

**Tech Stack:** GitHub Actions YAML, Node.js `node:test`, pnpm scripts.

---

### Task 1: Add the failing workflow contract

**Files:**
- Create: `scripts/check-quality-gate-workflow.node-test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract test**

Create `scripts/check-quality-gate-workflow.node-test.mjs`:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/quality-gate.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n')

test('quality gate runs for pull requests and main pushes without feature-branch push duplication', () => {
  const triggerBlock = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1]
  assert.ok(triggerBlock, 'quality-gate.yml must keep an explicit trigger block')
  assert.match(triggerBlock, /  push:\n    branches:\n      - main\n/)
  assert.match(triggerBlock, /  pull_request:\n/)
  assert.doesNotMatch(triggerBlock, /feat\/\*\*|fix\/\*\*/)
})

test('quality gate cancels only obsolete runs in the same PR or main lane', () => {
  assert.match(
    workflow,
    /concurrency:\n  group: quality-gate-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true\n/,
  )
  assert.match(
    workflow,
    /VOCAB_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/,
  )
})
```

Add the following script to `package.json`:

```json
"check:quality-gate-workflow": "node --test ./scripts/check-quality-gate-workflow.node-test.mjs"
```

Insert `pnpm run check:quality-gate-workflow` immediately after `pnpm run check:gates-chain` in the `gates` command.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm run check:quality-gate-workflow
```

Expected: two failures. The current workflow still contains `feat/**` and `fix/**`, and has no workflow-level `concurrency` block.

- [ ] **Step 3: Verify the gate-chain registration is reachable**

Run:

```bash
pnpm run check:gates-chain
```

Expected: PASS with 25 reachable `check:*` scripts and one intentional exclusion.

### Task 2: Make the workflow single-source

**Files:**
- Modify: `.github/workflows/quality-gate.yml`

- [ ] **Step 1: Remove feature and fix branch push triggers**

Change the trigger to:

```yaml
on:
  push:
    branches:
      - main
  pull_request:
```

- [ ] **Step 2: Add workflow-level concurrency**

Insert after the trigger block:

```yaml
concurrency:
  group: quality-gate-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Keep the existing vocabulary baseline expression unchanged:

```yaml
VOCAB_BASE_REF: ${{ github.event.pull_request.base.sha || github.event.before }}
```

- [ ] **Step 3: Run the focused tests and verify GREEN**

Run:

```bash
pnpm run check:quality-gate-workflow
pnpm run check:gates-chain
```

Expected: both commands exit 0; the contract reports 2 passing tests and the chain reports 25 reachable checks.

- [ ] **Step 4: Commit the RED/GREEN implementation**

```bash
git add .github/workflows/quality-gate.yml scripts/check-quality-gate-workflow.node-test.mjs package.json
git diff --cached --check
git commit -m "fix(ci): run one quality gate per pull request"
```

### Task 3: Verify, review, and deliver

**Files:**
- Modify only if verification or review exposes a scoped defect.

- [ ] **Step 1: Run the complete repository gate**

Run:

```bash
pnpm run gates
```

Expected: exit 0, including lint, type checks, tests, renderer build, and Electron build.

- [ ] **Step 2: Review the final diff against the specification**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- .github/workflows/quality-gate.yml scripts/check-quality-gate-workflow.node-test.mjs package.json docs/superpowers/specs/2026-08-27-quality-gate-single-run-design.md docs/superpowers/plans/2026-08-27-quality-gate-single-run.md
```

Expected: only the approved spec, plan, workflow, contract test, and package script wiring differ.

- [ ] **Step 3: Push and open a pull request**

```bash
git push -u origin codex/ci-single-run-20260827
gh pr create --base main --head codex/ci-single-run-20260827 --title "fix(ci): run one quality gate per pull request" --body-file /tmp/nomi-ci-single-run-pr.md
```

The PR body must include the #205 failure evidence, trigger/data-flow change, RED/GREEN commands, and full-gate result.

- [ ] **Step 4: Validate the real GitHub event shape**

For the PR HEAD, verify GitHub creates exactly one `Quality Gate` and one `Mac Package`, plus unrelated checks such as CLA/Workers. Wait for required checks to complete successfully.

- [ ] **Step 5: Merge without bypass**

Guard the PR head SHA, state, mergeability, and required checks, then run:

```bash
gh pr merge <number> --repo aqm857886159/Nomi --merge
```

Do not use `--admin`. Afterward verify the PR state is `MERGED` and the merge commit is reachable from live `main`.

## Plan self-review

- Spec coverage: trigger deduplication, concurrency, stable event-specific baseline, fail-closed behavior, automated regression coverage, full gates, live PR observation, and protected merge are all mapped to tasks.
- Placeholder scan: no deferred implementation or ambiguous code step remains; `<number>` is a runtime value returned by PR creation, not an unspecified implementation detail.
- Consistency: the new package script name, test filename, workflow keys, and verification commands match across all tasks.

## 2026-08-28 补充：当前 HEAD 恢复入口

### 根因

PR #210 通过 GitHub 的 expected-head 原子写入更新分支时，CLA 与 Cloudflare 收到了新提交，但 `pull_request` Quality Gate 没有生成；关闭并重开 PR 也只重跑了 `pull_request_target` 的 CLA。当前 workflow 又没有 `workflow_dispatch`，因此只能制造无意义提交或绕过门禁，二者都不可接受。

### 实施

1. 先扩展 `scripts/check-quality-gate-workflow.node-test.mjs`，要求 `workflow_dispatch.inputs.base_ref` 存在且默认 `origin/main`，并要求 `VOCAB_BASE_REF` 在 PR base、push before、手动 base_ref 之间按事件证据依次选择。Actions checkout 处于 detached HEAD，远端跟踪 ref 可达而本地 `main` 不保证存在。
2. 运行契约测试观察 RED。
3. 在 `.github/workflows/quality-gate.yml` 添加手动恢复入口与显式基线输入，不增加功能分支 push 触发器。
4. 运行定向测试、完整 `pnpm run gates`，然后对 PR 的精确 HEAD 手动 dispatch，等待 Quality Gate 与 Mac Package 都通过。

### 首次恢复运行反馈

首次按 `base_ref=main` 触发的当前 HEAD 运行在词表门岗按设计失败：checkout 已完整抓取历史，但只保证 `origin/main` 可解析，不保证创建本地 `main` 分支。该运行证明恢复入口命中了正确 HEAD，也证明基线必须使用 checkout 后可达的 Git ref。契约因此收紧为默认 `origin/main`；不添加静默 fallback，传入不可达 ref 时仍然 fail closed。

### 不动项

- 不降低门禁内容，不跳过 Mac 打包，不伪造 check，不用管理员覆盖。
- 正常 PR 仍只有 `pull_request` 一套自动门禁；`main` 仍在落地后复验。
- 手动恢复不自动猜测不可取得的旧 SHA。
