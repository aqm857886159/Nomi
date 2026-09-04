# PR #455 Canvas Performance / Quality Gate 诊断

日期：2026-09-04
PR：https://github.com/aqm857886159/Nomi/pull/455
分支：`codex/ci-recovery-20260904`
PR head：`7baf3bcfa135093a53f14f5c6fd3549d9e757c31`
CI run：`33826568407`

## 当前门禁状态

本次运行中：

- `Canvas Performance (Linux)`：失败，job `100880544243`。
- `Quality Gate`：失败，job `100883670381`。
- `Canvas Acceptance (Linux) (1)`、`(2)`：通过。
- `E2E Walkthroughs (Linux)`、`Unit`、`Contracts`、`Workers Builds: nomi`：通过。
- `Mac Package`、`mac-preview`、`windows-preview`：跳过，不作为通过证据。

## Canvas Performance 真实失败日志

失败 job 执行的是：

```text
xvfb-run -a pnpm run test:canvas:performance
node tests/ux/canvas-performance-benchmark.e2e.mjs validation-gate --scale M --runs 1
```

前 14 个场景以及 `video-hover`、`reload-heavy` 均完成；失败集中在 `media-error`：

```text
▶ M / media-error
  warmup ERROR locator.waitFor: Timeout 10000ms exceeded.
  sample 1 ERROR locator.waitFor: Timeout 10000ms exceeded.

❌ 画布性能 benchmark 未通过预算或可靠性门槛
```

上传的 `tests/ux/perf-results/canvas-validation-gate.json` 记录了同一失败：

```json
{
  "scenario": "media-error",
  "error": "locator.waitFor: Timeout 10000ms exceeded ... canvas-performance-benchmark.e2e.mjs:928:19",
  "verdict": {
    "pass": false,
    "hardFailures": [
      { "reason": "scenario error: locator.waitFor: Timeout 10000ms exceeded." }
    ]
  }
}
```

失败位置是 `tests/ux/canvas-performance-benchmark.e2e.mjs:928`，即点击“重试”之后再次等待：

```js
await failure.getByRole('button', { name: '重试' }).click()
await failure.waitFor({ timeout: 10_000 })
```

## 根因判断

### Canvas Performance：测试 fixture / harness 根因，不是已证实的性能退化

当前最小根因是：测试在第 917-921 行把一个已挂载的图片 `src` 改成缺失的 `nomi-local://` 地址，并手动派发一次 `error` 事件；点击重试后，产品代码会清除当前源、递增 retry token 并重新挂载媒体，但测试没有对重试后新挂载的图片再次注入/派发失败事件，却在第 928 行要求错误层再次出现。

因此第二次 `waitFor` 超时是测试对浏览器/Electron 媒体错误事件可重复触发的假设不成立。它不是 `frameGapP95Ms`、FPS、长任务或资源预算超限：其余场景均有有效指标并通过预算；`media-error` 因场景异常没有指标。

分类：

- 直接症状：重试后的错误层等待 10 秒超时。
- 直接原因：重试后新媒体元素没有被测试再次确定性地触发 `error` 事件。
- 类根因：测试把一次性 DOM 事件注入误当成浏览器对同一失败资源的稳定重放，导致重试路径没有一个可靠的 harness seam。
- 产品代码：本次证据不能证明产品媒体队列或失败 UI 有性能回归；不应以修改产品代码作为第一修复。
- 环境：Linux Electron/Xvfb 是触发条件，但日志显示前后其他场景正常；环境不是唯一根因。环境只暴露了测试的不确定性。

另一个需要在后续修复中核对的证据问题：CI job 在 merge ref `ace2bcbc3fc48e230673e3e84e40be24e93c031b` 上执行，而 PR head 是 `7baf3bcfa135093a53f14f5c6fd3549d9e757c31`。这是 GitHub pull_request merge ref 的正常形态，不等于使用了旧 PR 代码；报告中保留该信息以避免把生成结果的 commit 字段误读成 PR head。

### Quality Gate：汇总门失败，另有 annotation hygiene 的独立阻断

Quality Gate 日志的最终失败不是第二个产品测试失败，而是两个已知结果的汇总：

1. `needs['canvas-performance'].result` 为 `failure`，workflow 的汇总脚本在 `.github/workflows/quality-gate.yml:343` 执行 `test "failure" = "success"`，所以门失败。
2. `scripts/ci-annotation-hygiene.mjs` 同时报告：

   ```text
   CI annotation hygiene failed; inspect outputs/ci-hygiene/ci-annotations.json
   CI annotation hygiene: 11 annotations, 10 delegated, 0 allowed, 1 unexpected
   ```

   唯一 unexpected annotation 是 Canvas Performance job 在 `.github:88` 的 `Process completed with exit code 1`。这属于失败任务的 CI 注解治理结果，是性能失败的级联/伴随阻断，不是新的产品根因。

## PR #455 已有改动

相对 `origin/main@45912ae01a155a3f6592f65368d0ce3d12fc034e`，PR 当前包含：

- `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts`
  - 修复主分支类型检查暴露的模型自动选择类型问题。
- `tests/ux/canvas-performance-benchmark.e2e.mjs`
  - 调整性能 benchmark 的场景、运行参数/门禁相关测试逻辑，包含 `media-error` 的注入与重试走查。
- `tests/ux/mcp-l2-journeys.e2e.mjs`
  - MCP L2 journey 的测试更新。

这些改动不是本次诊断中已经验证的修复；当前 PR 仍有真实失败门。

## 尚未执行的修复

本次没有提交产品或测试修复，也没有运行长测试。最小后续 TDD 顺序应为：

1. 保留当前失败作为 RED：复现 `media-error` 的重试失败，并断言失败确实来自第 928 行的第二次错误状态等待。
2. 在真实 Electron seam 上让重试后的新图片再次确定性进入失败态，或改用产品暴露的可观察失败状态；不能增加 timeout、skip、空数据或吞掉异常。
3. 先运行该窄红/绿测试，再运行完整 `pnpm run test:canvas:performance`。
4. 最后复核 annotation hygiene；不能只通过放宽 allowlist 隐藏真正的失败。

## 当前交付判断

- 本次没有最小修复 commit。
- 本报告是诊断交付，不宣称 Canvas Performance 或 Quality Gate 通过。
- PR #455 当前不可进入合并队列，原因是 Canvas Performance 仍失败，Quality Gate 仍失败。
