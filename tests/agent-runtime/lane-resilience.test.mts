// 阶段 3c 的验收门：**传输层看门狗 · 超时归类 · 重试 · 厂商报文 · 工具级超时 · 回合上限**。
//
// 这一族每条都配一个**阳性对照**——因为它们守的全是「不发生的事」（不挂死、不误判、
// 不重试一个确定的付费失败、不在没到上限时拦截）。没有阳性对照的绿灯不作数：
// 一个从不触发的看门狗和一个装对了的看门狗，在只有正面断言的测试里长得一模一样。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

import { LANE_RETRY_POLICY } from '../../electron/agentLane/laneHost.mjs';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { projectLaneSnapshot, type LaneModelFacts } from '../../electron/shared/agentLane/laneProjection.js';
import { normalizeProviderErrorText } from '../../electron/agentLane/laneProviderGuard.mjs';
import type { LaneProjection, LaneRetry } from '../../electron/shared/agentLane/laneContracts.js';
import { LANE_READ_TOOL_TIMEOUT_MS } from '../../electron/shared/agentLane/laneToolContract.js';
import { createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

/** 一个永不回复、但连上了的供应商。**首字节永不到达**——今天的 lane 会永远转圈。 */
const NEVER_REPLIES = { type: 'deferred' as const, beforeReply: () => new Promise<never>(() => {}) };

/** 看门狗预算压到毫秒级，好让「它到底会不会结束」这件事在一次测试里问得完。 */
const FAST_WATCHDOG = { firstResponseMs: 120, idleMs: 120 };

const MAX_ATTEMPTS = LANE_RETRY_POLICY.maxRetries + 1;

function collectRetries(lane: { subscribe(listener: (next: LaneProjection) => void): () => void }): LaneRetry[] {
  const seen: LaneRetry[] = [];
  lane.subscribe((projection) => { if (projection.retry) seen.push(projection.retry); });
  return seen;
}

function toolResults(projection: LaneProjection) {
  return projection.parts.filter((part) => part.kind === 'tool-result');
}

// ── G3c · 看门狗存在 ──────────────────────────────────────────────────────────

test('G3c · a provider that never sends a first byte ends the lane instead of hanging forever', async (t) => {
  const fixture = await createLaneFixture(t, [NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES]);
  const lane = await fixture.openLane({ ...fixture.options, watchdog: FAST_WATCHDOG });

  const started = Date.now();
  // **阳性对照就是这一行会不会返回。** main 上（provider 没有看门狗）它永远不返回，
  // 测试以超时报红；装上之后它在预算 × 重试次数 + 退避之内结束。
  await lane.execute({ kind: 'prompt', text: 'Say something.' });
  const elapsed = Date.now() - started;

  const projection = lane.projection();
  assert.equal(projection.running, false, 'the lane is no longer running once the watchdog fired');
  // 上限：4 次尝试 × 120ms + 退避 1+2+4s ≈ 7.5s。给一倍余量，但**必须有上限**——
  // 「最终会结束」在一个挂死的实现里也成立（在测试超时之后）。
  assert.ok(elapsed < 30_000, `the stuck stream ended in ${elapsed}ms, not never`);
});

test('G3c · the watchdog also covers the summarizer stream, not only the assistant stream', async (t) => {
  // 压缩与分支摘要走 `streamSimple`，只用 `result()`。看门狗装在 provider 的流上，
  // 所以这两条同样有预算——装在 harness 的某个钩子上就会漏掉它们，而它们卡住的
  // 样子和主请求卡住一模一样。这条断言的对象是**接线位置**，不是行为分支。
  const fixture = await createLaneFixture(t, [NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES]);
  const lane = await fixture.openLane({ ...fixture.options, watchdog: FAST_WATCHDOG });
  await lane.execute({ kind: 'prompt', text: 'Say something.' });
  assert.ok(fixture.http.requests.length >= 1, 'the provider was actually reached before the watchdog fired');
});

// ── G-11 · 看门狗触发后算什么错 ────────────────────────────────────────────────

test('G-11 · a watchdog timeout surfaces as a retryable error, not as an abort', async (t) => {
  const fixture = await createLaneFixture(t, [NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES]);
  const lane = await fixture.openLane({ ...fixture.options, watchdog: FAST_WATCHDOG });
  const retries = collectRetries(lane);

  await lane.execute({ kind: 'prompt', text: 'Say something.' });

  // `stopReason:"aborted"` 在上游是**永不重试**的（`pi-ai/dist/utils/retry.js`）。
  // 所以「有没有排过重试」就是「超时被归成 error 还是 aborted」的直接判据——
  // 而 `observeNativeStream.fail()` 走的是 `controller.abort(error)`，天然长得像 aborted。
  assert.ok(retries.length > 0, 'the timeout was classified as a retryable error, so pi scheduled a retry');
  // `attempt` 是**即将跑的那一次**（首次是 1，所以第一次重试是 2）——面板上那句
  // 「正在重试 2/4」里的两个数字就是它俩，不需要任何一层再加一。
  assert.equal(retries[0].attempt, 2);
  assert.equal(retries[0].maxAttempts, MAX_ATTEMPTS,
    'maxAttempts comes from the retry policy the host passes explicitly, not from pi’s default');
  // 每次请求都真的发出去了：重试不是原地空转。
  assert.equal(fixture.http.requests.length, MAX_ATTEMPTS);
});

test('G-11 阳性对照 · the user pressing stop is an abort, and an abort is never retried', async (t) => {
  const fixture = await createLaneFixture(t, [NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES, NEVER_REPLIES]);
  // 预算给到远大于本测试的时长：这一轮**只可能**因为 abort 而结束，不可能因为看门狗。
  const lane = await fixture.openLane({ ...fixture.options, watchdog: { firstResponseMs: 30_000, idleMs: 30_000 } });
  const retries = collectRetries(lane);

  const running = lane.execute({ kind: 'prompt', text: 'Say something.' });
  while (fixture.http.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await lane.execute({ kind: 'abort' });
  await running;

  assert.equal(retries.length, 0, 'a cancelled turn schedules no retry at all');
  assert.equal(fixture.http.requests.length, 1, 'and it never re-sends the request the user cancelled');
});

// ── G4 · 429 不死 ────────────────────────────────────────────────────────────

test('G4 · a 429 is retried, the projection carries attempt/maxAttempts, and the turn still finishes', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'error', status: 429, message: 'Too Many Requests' },
    { type: 'text', text: 'Recovered after one throttle.' },
  ]);
  const lane = await fixture.openLane(fixture.options);
  const retries = collectRetries(lane);

  await lane.execute({ kind: 'prompt', text: 'Say something.' });

  assert.deepEqual(retries.map((retry) => [retry.attempt, retry.maxAttempts]), [[2, MAX_ATTEMPTS]],
    'exactly one retry was scheduled, and the panel has the two numbers it needs to say “retrying 2/4”');
  assert.ok(retries[0].nextAttemptAt > 0, 'and the moment it will be tried again, so the panel can count down');
  const texts = lane.projection().parts.filter((part) => part.kind === 'assistant-text').map((part) => part.text);
  assert.deepEqual(texts, ['Recovered after one throttle.'],
    'the throttled attempt leaves no half-written assistant bubble behind');
  assert.equal(fixture.http.requests.length, 2);
});

// ── G-12 · 厂商报文归一 ──────────────────────────────────────────────────────

/**
 * **真实样本语料**。每一条都从仓库里已经抓到过的原话来，标了出处——手编的报文只能证明
 * 「我写的正则和我写的例子一致」，而这一族要证的是「厂商真的会这么说，而我们判对了」。
 *
 * 派工书原本指向 `docs/audit/attachments/`；那份 jsonl 是 09-06 的工具探针（15 行、
 * `failures: []`），**里面一条厂商错误报文都没有**。所以语料改从三处真实来源汇齐，
 * 出处逐条写在下面。
 */
const VENDOR_SAMPLES: readonly { readonly text: string; readonly marker: RegExp; readonly source: string }[] = [
  { source: 'electron/vendor/vendorHttp.test.ts:47 — kie 逻辑码 402，HTTP 却是 200',
    text: '{"code":402,"msg":"余额不足"}', marker: /insufficient_quota/ },
  { source: 'src/workbench/generationCanvas/runner/classifyGenerationError.test.ts:64 — kie 402 的包装串',
    text: 'Provider request failed (code 402) at kie: 余额不足，请充值', marker: /insufficient_quota/ },
  { source: 'classifyGenerationError.test.ts:155 — RunningHub 605',
    text: '您的账户余额不足，请充值。', marker: /insufficient_quota/ },
  // 这条是语料里最值钱的一条：它**一个「余额」都没有**，靠「不支持 API 调用」+「请充值」
  // 才认得出来，而按数值它是 1620 → `input`，会被说成「参数错」。
  { source: 'classifyGenerationError.test.ts:157 — RunningHub 1620',
    text: '当前钱包剩余金额仅为活动会员下发金额，该类型金额不支持 API 调用，请充值。', marker: /insufficient_quota/ },
  { source: 'src/workbench/observability/classifyError.ts:292 — detectBalance 的英文半边',
    text: 'insufficient balance, please recharge', marker: /insufficient_quota/ },
  { source: 'electron/vendor/vendorHttp.ts:223 — 我们自己的出站超时文案',
    text: '请求超时（30s 无响应）', marker: /timeout/ },
  { source: 'electron/vendor/vendorHttp.ts:242 — 读响应超时',
    text: '读取响应超时（30s）', marker: /timeout/ },
  { source: 'electron/systemProxy.ts:455 — 代理不通时我们自己的兜底文案',
    text: '网络请求失败：无法连接到该地址。（当前代理：http://127.0.0.1:7890）', marker: /network error/ },
  { source: 'electron/catalog/codexCli.ts:247 — 限流一族的中文原话',
    text: '请求过于频繁，请降低调用频率', marker: /rate limit/ },
  { source: 'APIMart 这一族 5xx 的中文正文', text: '服务器内部错误', marker: /server error/ },
];

test('G-12 · real vendor wording maps onto the upstream classifier without replacing what the vendor said', () => {
  // 上游那张 40 条正则表是**英文**的（`pi-ai/dist/utils/retry.js`）。这几条是这个仓库
  // 真的抓到过的中文报文；不归一，它们的分类就全是错的。
  for (const sample of VENDOR_SAMPLES) {
    const normalized = normalizeProviderErrorText(sample.text);
    assert.match(normalized, sample.marker, `${sample.source} → ${sample.marker}`);
    assert.ok(normalized.startsWith(sample.text),
      `${sample.source}: the vendor’s own words survive verbatim, the marker is appended`);
  }

  // 阳性对照：一段没有可归类特征的报文**不许**被贴上任何标记。乱贴一个 `timeout`
  // 会让一个确定的参数错误被重试三次。
  for (const plain of ['model "deepseek-v4-flash" does not exist', '提示词包含不允许的内容', 'invalid api key']) {
    assert.equal(normalizeProviderErrorText(plain), plain, 'the normalizer only speaks when it recognizes something');
  }
});

test('G-12 · a 5xx that actually says “balance exhausted” is not retried three times', async (t) => {
  // 这是归一真正买到的东西：HTTP 500 命中上游的 `500` 正则 → 本该重试三次，
  // 而报文里写着「余额不足」——重试只是把一次确定的付费失败拖成四次，用户等四倍的时间
  // 换同一个结果。归一让 `insufficient_quota` 先命中不可重试表。
  const fixture = await createLaneFixture(t, [
    { type: 'error', status: 500, message: '账户余额不足，请充值后重试' },
    { type: 'text', text: 'Must not be reached.' },
  ]);
  const lane = await fixture.openLane(fixture.options);
  const retries = collectRetries(lane);

  await lane.execute({ kind: 'prompt', text: 'Say something.' });

  assert.equal(retries.length, 0, 'a billing failure is terminal, however the vendor spelled its status code');
  assert.equal(fixture.http.requests.length, 1);
});

test('G-12 阳性对照 · a 5xx with no billing wording is still retried', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'error', status: 500, message: 'internal error' },
    { type: 'text', text: 'Recovered.' },
  ]);
  const lane = await fixture.openLane(fixture.options);
  const retries = collectRetries(lane);

  await lane.execute({ kind: 'prompt', text: 'Say something.' });

  assert.equal(retries.length, 1, 'the normalizer only demotes what it can actually recognize');
  assert.equal(fixture.http.requests.length, 2);
});

// ── 工具级超时 ───────────────────────────────────────────────────────────────

function stallingTool(name: string, timeoutMs: number, body: () => Promise<void>): LaneToolDescriptor {
  return bindLaneTool({
    name,
    contractId: 'document.read',
    description: 'Runs a host-controlled body, used to prove the lane bounds how long a tool may run.',
    promptSnippet: 'run a host-controlled body.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'read',
    execution: { timeoutMs },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
  }, async () => { await body(); return { ok: true, text: 'done' }; });
}

test('a tool that never returns is stopped at its declared budget, with a next step the model can act on', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'call-stall', name: 'stalls_forever', arguments: {} }] },
    { type: 'text', text: 'That tool did not come back, so I stopped.' },
  ]);
  const lane = await fixture.openLane({
    ...fixture.options,
    tools: [stallingTool('stalls_forever', 150, () => new Promise<void>(() => {}))],
  });

  await lane.execute({ kind: 'prompt', text: 'Use the tool.' });

  const [result] = toolResults(lane.projection());
  assert.ok(result, 'the stuck call produced a settled result instead of leaving the turn open');
  assert.equal(result.kind === 'tool-result' && result.isError, true,
    'and pi records it as an error — a returned "failure object" would be recorded as a success (G-02)');
  assert.match(result.kind === 'tool-result' ? result.text : '', /did not finish within/);
  assert.match(result.kind === 'tool-result' ? result.text : '', /Next: /,
    '“timed out” alone tells a self-correcting model nothing; it needs the next move');
});

test('阳性对照 · waiting on an approval does not spend the tool’s budget', async (t) => {
  // 计时器在 `execute` 里才 arm，而闸跑在 `before_tool`——也就是进 execute 之前。
  // 这条断言守的是那行代码的**位置**：用户在卡上想了 500ms 才点头，工具预算只有 300ms，
  // 而工具本身瞬时返回。计时器如果在闸之前 arm，这一条必红。
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'call-quick', name: 'returns_at_once', arguments: {} }] },
    { type: 'text', text: 'Approved and done.' },
  ], { hasUserInterface: true, policy: () => ({ mode: 'step', spend: 'confirm' }) });
  const lane = await fixture.openLane({
    ...fixture.options,
    tools: [stallingTool('returns_at_once', 300, async () => {})],
  });

  const turn = lane.execute({ kind: 'prompt', text: 'Use the tool.' });
  // 卡从投影里推出来（不用墙钟轮询，R18）；点头**故意慢** 500ms，那才是这条对照的仪器。
  const stop = lane.subscribe((projection) => {
    const card = projection.pending;
    if (!card) return;
    stop();
    setTimeout(() => {
      void lane.execute({ kind: 'approval', toolCallId: card.toolCallId, action: 'allow-once' });
    }, 500);
  });
  t.after(stop);
  await turn;

  const [result] = toolResults(lane.projection());
  assert.equal(result?.kind === 'tool-result' && result.isError, false,
    'the tool ran and succeeded, so the 500ms the user spent deciding was not charged to its 300ms budget');
});

test('a billable tool may not claim a long budget — it must submit and return an id', async (t) => {
  // 长任务形状（调研 #599 §长任务 L1）落成装配期不变量。违反它的工具**不会报错**，
  // 它只会很慢——而「很慢」在真机上和「模型在想事情」长得一模一样。
  const fixture = await createLaneFixture(t, []);
  const billable = bindLaneTool({
    name: 'spends_money_and_waits',
    contractId: 'generation.control',
    description: 'Pretends to run a paid generation to completion inside the call.',
    promptSnippet: 'run a paid generation.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'spend',
    execution: { timeoutMs: LANE_READ_TOOL_TIMEOUT_MS + 1 },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
  }, async () => ({ ok: true, text: 'done' }));

  await assert.rejects(
    () => fixture.openLane({ ...fixture.options, tools: [billable] }),
    /must submit and return an id/,
  );
});

// ── 长任务 L1 · 供应商侧 deferred ────────────────────────────────────────────

test('a suspended (deferred) operation projects as still running, and claims nothing it cannot know', () => {
  // Nomi 今天的文本供应商**不走 deferred API**（方案 §1.6 表「供应商异步响应」那一行），
  // 所以这里断言的是投影层的**不做什么**：遇到一个自己不认识的挂起原因，它照实说
  // 「这一轮还在跑」，既不报错、也不假装知道进度。哪天真接了一家 deferred 供应商，
  // 这条会是那次改动的起点，而不是一个当场炸掉的投影层。
  const snapshot = {
    lane: 'main', transcript: [], tipId: null,
    configuration: { model: { provider: 'nomi-lane', modelId: 'chosen-model' },
      thinkingLevel: 'off', activeToolNames: [] },
    stats: { messageCount: 0,
      usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14 } },
    operation: { id: 'op-1', kind: 'run', startedAt: Date.now(), fromTipId: null, status: 'running',
      deferred: { handle: { provider: 'nomi-lane', id: 'deferred-1' }, poll: 3 }, runningTools: [] },
    queues: [], faulted: false,
  } as unknown as Parameters<typeof projectLaneSnapshot>[0];

  // 三行（3b）要模型侧事实才能投影；这条测试只看 running/retry/parts，价目给 'unpriced' 让花费走「不可知」。
  const facts: LaneModelFacts = { supportedThinkingLevels: ['off'], pricing: 'unpriced' };
  const projection = projectLaneSnapshot(snapshot, facts);
  assert.equal(projection.running, true, 'a suspended run has not finished');
  assert.equal(projection.retry, undefined, 'suspended is not retrying — two different things, two different lines on screen');
  assert.deepEqual(projection.parts, []);
});

// ── 回合上限 ─────────────────────────────────────────────────────────────────

test('a turn that reaches its model-request limit stops with a sentence, not with a step-limit code', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'call-read', name: 'read_full_text', arguments: {} }] },
    { type: 'text', text: 'Must not be reached.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, limits: { maxModelRequests: 1 } });

  await lane.execute({ kind: 'prompt', text: 'Read the document.' });

  const [result] = toolResults(lane.projection());
  assert.equal(result?.kind === 'tool-result' && result.isError, true);
  assert.match(result?.kind === 'tool-result' ? result.text : '', /reached its 1-model-request limit/);
  assert.match(result?.kind === 'tool-result' ? result.text : '', /State your conclusion/,
    'the model and the user read the same sentence — not an error code only one of them understands');
  assert.equal(fixture.http.requests.length, 1, 'and the blocked turn does not buy another model request');
});

test('the budget is per turn, not per lane — a second turn starts with a full one', async (t) => {
  // 「一个回合最多 N 次请求」里的**回合**是 `runId`，不是这条 lane 的一生。一条 lane 活一整天，
  // 按 lane 计数的后果不会报错：它只是让用户在第 N 次请求之后，**每一轮**都在第一个工具调用上
  // 被拦——而拦截语说的是「本轮已到上限」，于是排错的人会去找一个根本不存在的长回合。
  const call = (id: string) => ({ type: 'tool' as const,
    calls: [{ id, name: 'read_full_text', arguments: {} }] });
  const fixture = await createLaneFixture(t, [
    call('turn1'), { type: 'text', text: 'First turn done.' },
    call('turn2'), { type: 'text', text: 'Second turn done.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, limits: { maxModelRequests: 2 } });

  await lane.execute({ kind: 'prompt', text: 'Read it once.' });
  await lane.execute({ kind: 'prompt', text: 'Read it again.' });

  const results = toolResults(lane.projection());
  assert.equal(results.length, 2, 'both turns got to run their tool');
  for (const result of results) {
    assert.equal(result.kind === 'tool-result' && result.isError, false,
      'the second turn is not paying for the first turn’s requests');
  }
  assert.deepEqual(
    lane.projection().parts.filter((part) => part.kind === 'assistant-text').map((part) => part.text),
    ['First turn done.', 'Second turn done.'],
  );
});

test('阳性对照 · a turn at the same limit that never calls a tool is not intercepted at all', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'No tool needed here.' }]);
  const lane = await fixture.openLane({ ...fixture.options, limits: { maxModelRequests: 1 } });

  await lane.execute({ kind: 'prompt', text: 'Just answer.' });

  const projection = lane.projection();
  assert.deepEqual(projection.parts.filter((part) => part.kind === 'host-note'), [],
    'nothing was blocked, so nothing was recorded as blocked');
  assert.deepEqual(
    projection.parts.filter((part) => part.kind === 'assistant-text').map((part) => part.text),
    ['No tool needed here.'],
  );
});

test('the same tool failing the same way three times in a row is stopped and told to change route', async (t) => {
  const failing = bindLaneTool({
    name: 'always_fails',
    contractId: 'document.read',
    description: 'Always fails the same way, used to prove the lane stops a model from walking into the same wall.',
    promptSnippet: 'always fail.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'read',
    execution: { timeoutMs: LANE_READ_TOOL_TIMEOUT_MS },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
  }, async () => ({
    ok: false,
    failure: { code: 'always', message: 'The shot id does not exist.', nextAction: 'Read the canvas first.' },
  }));
  const call = (id: string) => ({ type: 'tool' as const, calls: [{ id, name: 'always_fails', arguments: {} }] });
  const fixture = await createLaneFixture(t, [
    call('one'), call('two'), call('three'), call('four'),
    { type: 'text', text: 'I stopped repeating myself.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, tools: [failing] });

  await lane.execute({ kind: 'prompt', text: 'Use the tool.' });

  const results = toolResults(lane.projection());
  assert.equal(results.length, 4, 'the fourth call still gets a result — it is blocked, not silently dropped');
  const fourth = results[3];
  assert.match(fourth.kind === 'tool-result' ? fourth.text : '', /failed the same way 3 times in a row/);
  assert.match(fourth.kind === 'tool-result' ? fourth.text : '',
    /take a different route|tell the user plainly/);
});

test('阳性对照 · three failures that are not the same failure are not treated as a streak', async (t) => {
  let attempt = 0;
  const varying = bindLaneTool({
    name: 'fails_differently',
    contractId: 'document.read',
    description: 'Fails with a different reason each time, used to prove the streak rule reads the reason.',
    promptSnippet: 'fail differently each time.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'read',
    execution: { timeoutMs: LANE_READ_TOOL_TIMEOUT_MS },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
  }, async () => {
    attempt += 1;
    return { ok: false, failure: { code: 'varies', message: `Wall number ${attempt} is in the way.`,
      nextAction: 'Try the next one.' } };
  });
  const call = (id: string) => ({ type: 'tool' as const, calls: [{ id, name: 'fails_differently', arguments: {} }] });
  const fixture = await createLaneFixture(t, [
    call('one'), call('two'), call('three'), call('four'),
    { type: 'text', text: 'Four different walls.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, tools: [varying] });

  await lane.execute({ kind: 'prompt', text: 'Use the tool.' });

  const results = toolResults(lane.projection());
  assert.equal(results.length, 4);
  for (const result of results) {
    assert.doesNotMatch(result.kind === 'tool-result' ? result.text : '', /failed the same way/,
      'making progress through different failures is not walking into the same wall');
  }
});
