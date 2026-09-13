# C1 先红后绿证据

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

浏览器变异与阶段截图见 `acceptance.json`；Electron 真机见 `electron-acceptance.json`。

## narration-before.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback

 ❯ src/workbench/observability/processFeedback.test.ts (4 tests | 4 failed) 6ms
     × uses the approved phase wording and elapsed time from the first second 4ms
     × omits unknown queue position and includes a real position 1ms
     × keeps soft timeout in flight 0ms
     × provides English from the same owner 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/workbench/observability/processFeedback.test.ts > C1 honest narration boundary > uses the approved phase wording and elapsed time from the first second
AssertionError: expected '准备生成' to be '排队中' // Object.is equality

Expected: "排队中"
Received: "准备生成"

 ❯ src/workbench/observability/processFeedback.test.ts:7:39
      5| describe('C1 honest narration boundary', () => {
      6|   it('uses the approved phase wording and elapsed time from the first …
      7|     expect(narrateProgress('queued')).toBe('排队中')
       |                                       ^
      8|     expect(narrateProgress('generating', { elapsedMs: 1000 })).toBe('生…
      9|     expect(narrateProgress('retrying', { elapsedMs: 18000 })).toContai…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  src/workbench/observability/processFeedback.test.ts > C1 honest narration boundary > omits unknown queue position and includes a real position
AssertionError: expected '排队中 · 前面还有 2 个任务' to be '排队 · 前面 2 个' // Object.is equality

Expected: "排队 · 前面 2 个"
Received: "排队中 · 前面还有 2 个任务"

 ❯ src/workbench/observability/processFeedback.test.ts:14:66
     12|   it('omits unknown queue position and includes a real position', () =…
     13|     expect(narrateProgress('comfyui-queued')).not.toMatch(/前面|%/)
     14|     expect(narrateProgress('comfyui-queued', { queueAhead: 2 })).toBe(…
       |                                                                  ^
     15|   })
     16|   it('keeps soft timeout in flight', () => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  src/workbench/observability/processFeedback.test.ts > C1 honest narration boundary > keeps soft timeout in flight
AssertionError: expected '仍在生成 · 已超常规时长（已等 6 分钟）' to be '比平时久 · 已等 6 分钟 · 仍在后台跑' // Object.is equality

Expected: "比平时久 · 已等 6 分钟 · 仍在后台跑"
Received: "仍在生成 · 已超常规时长（已等 6 分钟）"

 ❯ src/workbench/observability/processFeedback.test.ts:17:72
     15|   })
     16|   it('keeps soft timeout in flight', () => {
     17|     expect(narrateProgress('still-generating', { elapsedMs: 360000 }))…
       |                                                                        ^
     18|   })
     19|   it('provides English from the same owner', async () => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  src/workbench/observability/processFeedback.test.ts > C1 honest narration boundary > provides English from the same owner
AssertionError: expected 'Generating' to be 'Generating · 1s elapsed' // Object.is equality

Expected: "Generating · 1s elapsed"
Received: "Generating"

 ❯ src/workbench/observability/processFeedback.test.ts:21:70
     19|   it('provides English from the same owner', async () => {
     20|     await i18n.changeLanguage('en')
     21|     try { expect(narrateProgress('generating', { elapsedMs: 1000 })).t…
       |                                                                      ^
     22|     finally { await i18n.changeLanguage('zh-CN') }
     23|   })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  1 failed (1)
      Tests  4 failed (4)
   Start at  22:04:44
   Duration  310ms (transform 159ms, setup 23ms, import 188ms, tests 6ms, environment 0ms)


```

## narration-after.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  22:06:14
   Duration  290ms (transform 155ms, setup 21ms, import 188ms, tests 3ms, environment 0ms)


```

## typecheck-mutation-red.log

```text
src/workbench/observability/narrate.ts(36,14): error TS2741: Property '"mutation-unmapped-stage"' is missing in type '{ queued: "queued"; 'comfyui-queued': "queued"; resolving: "submitting"; requesting: "submitting"; waiting: "submitting"; generating: "generating"; 'still-generating': "generating"; retrying: "generating"; 'comfyui-node': "generating"; finalizing: "finalizing"; }' but required in type 'Record<GenerationProgressPhase, GenerationFeedbackPhase>'.
src/workbench/observability/narrate.ts(65,7): error TS2741: Property '"mutation-unmapped-stage"' is missing in type '{ queued: (ctx: ProgressNarrationContext) => string; resolving: () => string; requesting: () => string; waiting: () => string; generating: (ctx: ProgressNarrationContext) => string; ... 4 more ...; 'comfyui-queued': (ctx: ProgressNarrationContext) => string; }' but required in type 'Record<GenerationProgressPhase, (ctx: ProgressNarrationContext) => string>'.

```

## typecheck-mutation-restored.log

```text

```

## fake-percent-mutation-red.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback

 ❯ src/workbench/observability/generationFeedback.test.ts (3 tests | 2 failed) 8ms
     × omits numbers without provider evidence and preserves a real percentage 7ms
     × does not mistake queue zero for a percentage 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/workbench/observability/generationFeedback.test.ts > C1 feedback atom > omits numbers without provider evidence and preserves a real percentage
AssertionError: expected '<span data-generation-status="true" d…' not to contain '%'

Expected: "%"
Received: "<span data-generation-status="true" data-phase="generating" data-reduced-motion="false" class="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-body font-medium leading-snug shadow-nomi-sm bg-nomi-paper text-nomi-ink"><span data-process-dot="true" class="size-1.5 shrink-0 rounded-full bg-nomi-accent" aria-hidden="true"></span><span data-generation-message="true">生成中 · 已等 18 秒</span><span class="font-nomi-mono tabular-nums">0%</span></span>"

 ❯ src/workbench/observability/generationFeedback.test.ts:12:30
     10| describe('C1 feedback atom', () => {
     11|   it('omits numbers without provider evidence and preserves a real per…
     12|     expect(html(node())).not.toContain('%')
       |                              ^
     13|     expect(html(node())).not.toMatch(/前面.*个/)
     14|     expect(html(node(60))).toContain('60%')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/workbench/observability/generationFeedback.test.ts > C1 feedback atom > does not mistake queue zero for a percentage
AssertionError: expected '<span data-generation-status="true" d…' not to contain '%'

Expected: "%"
Received: "<span data-generation-status="true" data-phase="queued" data-reduced-motion="false" class="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-body font-medium leading-snug shadow-nomi-sm bg-nomi-paper text-nomi-ink"><span data-process-dot="true" class="size-1.5 shrink-0 rounded-full bg-nomi-ink-30" aria-hidden="true"></span><span data-generation-message="true">排队中</span><span class="font-nomi-mono tabular-nums">0%</span></span>"

 ❯ src/workbench/observability/generationFeedback.test.ts:24:29
     22|   it('does not mistake queue zero for a percentage', () => {
     23|     const value = node(0); value.progress!.phase = 'comfyui-queued'
     24|     expect(html(value)).not.toContain('%')
       |                             ^
     25|   })
     26| })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  22:13:45
   Duration  268ms (transform 143ms, setup 20ms, import 177ms, tests 8ms, environment 0ms)


```

## fake-percent-mutation-restored.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  22:14:08
   Duration  305ms (transform 172ms, setup 22ms, import 212ms, tests 6ms, environment 0ms)


```

## geometry-real-aspect-red.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback

 ❯ src/workbench/generationCanvas/nodes/computeMediaMetaPatch.test.ts (4 tests | 1 failed) 3ms
   × preserves an acknowledged generation footprint when the returned frame has a different aspect ratio 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/workbench/generationCanvas/nodes/computeMediaMetaPatch.test.ts > preserves an acknowledged generation footprint when the returned frame has a different aspect ratio
AssertionError: expected { width: 340, height: 191 } to be undefined

- Expected:
undefined

+ Received:
{
  "height": 191,
  "width": 340,
}

 ❯ src/workbench/generationCanvas/nodes/computeMediaMetaPatch.test.ts:47:23


⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
   Start at  22:37:29
   Duration  121ms (transform 37ms, setup 23ms, import 25ms, tests 3ms, environment 0ms)


```

## geometry-real-aspect-green.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  22:38:11
   Duration  109ms (transform 30ms, setup 23ms, import 18ms, tests 1ms, environment 0ms)


```

## invalid-percent-red.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback

 ❯ src/workbench/observability/generationFeedback.test.ts (5 tests | 1 failed) 11ms
   × rejects invalid percentages before they can become seemingly real zero or one hundred 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/workbench/observability/generationFeedback.test.ts > rejects invalid percentages before they can become seemingly real zero or one hundred
AssertionError: expected +0 to be undefined

- Expected:
undefined

+ Received:
0

 ❯ src/workbench/observability/generationFeedback.test.ts:38:95
     36|
     37| it('rejects invalid percentages before they can become seemingly real …
     38|   for (const percent of [-1, 101, NaN, Infinity]) expect(createProgres…
       |                                                                                               ^
     39|   expect(createProgress({ percent: 60 }).percent).toBe(60)
     40| })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
   Start at  22:47:05
   Duration  261ms (transform 139ms, setup 19ms, import 171ms, tests 11ms, environment 0ms)


```

## invalid-percent-green.log

```text

 RUN  v4.1.8 /Users/aoqimin/Desktop/Nomi-process-feedback


 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  22:47:39
   Duration  294ms (transform 159ms, setup 22ms, import 195ms, tests 11ms, environment 0ms)


```

## 合入 main #653 后的最终走查门岗

- 首轮 contracts：75 项跑完，70 通过、2 阻断（新增测试直接 electron.launch、两处无探针消失断言）、3 advisory。
- 改用 `_launchApp.mjs` 的隔离真实 Nomi 进程及 `_assert.mjs` 的 proveProbe → expectAbsent；两条门岗均转绿，无基线放宽。
- Electron 导航会重置媒体仿真，测试在导航后设置 reducedMotion；matchMedia 实测 false → true，未修改生产动效。
- 两份 process-feedback E2E 再跑通过；真实 Nomi 窗口截图已由主会话查看。

## 设计系统 #654 合并核对

重新生成 Tailwind 后设计系统 31 用例通过；过程反馈仅两张真帧的取消按钮受 main 已批准 danger-soft 语义色影响。主会话查看明暗实际图、旧图与差异图后，仅重录 pf-preview / pf-preview-dark，2 用例通过，其余基线不变。

## 全量单测兼容回归

首次全量：11996 通过、2 跳过、2 失败。旧上传错误断言更新为明确未计费；实验室将 nomi-pf-stage 派发入口与监听归到同一宿主模块，E2E 调用该入口。89 项相关回归转绿；过程反馈矩阵、旅程及浏览器变异复跑通过。
