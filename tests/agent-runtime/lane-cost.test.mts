// 三行（花费 / 上下文 / 推理）的三态门：方案 §1.7 与验收门 G3d，以及探针 P4 的单位对账。
//
// **这一族缺陷的形状**：面板上那三行永远是空的，而没有任何一层报错。根因链是三段：
//   ① 目录里没有放 per-token 价的地方（`Model.pricing` 是「生成一次扣多少点」，不是 per-token）；
//   ② 于是 `createNomiProvider` 给 pi 填 `cost: {input:0, …}`，pi 老老实实算出 0；
//   ③ 于是宿主拿 `cost.total > 0` 当「有没有价目」的判据 —— 而 0 同时长得像
//      「免费」「还没花钱」「我们没有价目」三件事。
// 三段各自都自洽、单测全绿、门岗全绿，只有用户会看到一整排空白。所以这里钉的是**三态本身**：
// 每个「不可知」都要说得出理由，每个「有值」都要和手算相等。
//
// 单位（P4 的核心）：`Model.tokenPricing` 是 **USD / 每百万 token**，因为 pi 的 `calculateCost`
// 写死 `rates.input / 1_000_000 * tokens`（`pi-ai/dist/models.js:543-547`）。写成「每千」不会报错，
// 只会让金额差 1000 倍 —— 下面那条手算断言就是为了让那种错当场翻红。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { projectLaneSnapshot, type LaneModelFacts } from '../../electron/agentLane/laneProjection.mjs';
import type { LaneMetric, LaneUsage } from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';
import type { FixtureReply } from './httpFixture.mjs';

/**
 * DeepSeek V4 Flash 官网价（峰价档），2026-09-07 实查
 * <https://api-docs.deepseek.com/quick_start/pricing/>：
 *   cache miss 输入 $0.44 / 1M · 输出 $1.32 / 1M · cache hit 输入 $0.014 / 1M。
 * 与 `electron/catalog/apimartTexts.ts` 里那条 curated 种子逐字相同 —— 两处一起改才算改对。
 */
const V4_FLASH = { inputPerMTokUsd: 0.44, outputPerMTokUsd: 1.32, cacheReadPerMTokUsd: 0.014 } as const;

const SAY_HI: FixtureReply[] = [{ type: 'text', text: 'Done.' }];

function metricOf(usage: LaneUsage, line: 'cost' | 'contextTokens' | 'reasoningTokens'): LaneMetric {
  return usage[line];
}

/** 三态里那个数；不是 `known` 就抛 —— 让「我以为它有值」当场变成一条失败而不是一个 NaN。 */
function knownValue(metric: LaneMetric, what: string): number {
  assert.equal(metric.state, 'known', `${what} should be known, got ${JSON.stringify(metric)}`);
  return metric.state === 'known' ? metric.value : Number.NaN;
}

// ── P4 · 单位对账 ─────────────────────────────────────────────────────────────

test('P4 · a priced model yields a cost that equals the hand-computed per-million-token amount', async (t) => {
  // 一次回合的用量由假端点自己说了算（`httpFixture` 把它原样发成供应商报文），
  // 所以「模型报了多少」和「我们算了多少」是两个独立来源，不是同一个数字自证。
  const usage = { input: 12_000, output: 3_000, cacheRead: 8_000, cacheWrite: 0 };
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'Done.', usage }]);
  const lane = await openLane({ ...fixture.options,
    model: { ...fixture.options.model, tokenPricing: V4_FLASH } });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Say done.' });

  const cost = knownValue(metricOf(lane.projection().usage, 'cost'), 'cost');
  // 手算：(12000 × 0.44 + 3000 × 1.32 + 8000 × 0.014) / 1e6
  //     = (5280 + 3960 + 112) / 1e6 = 0.009352 美元。
  const expected = (usage.input * V4_FLASH.inputPerMTokUsd
    + usage.output * V4_FLASH.outputPerMTokUsd
    + usage.cacheRead * V4_FLASH.cacheReadPerMTokUsd) / 1_000_000;
  assert.equal(expected.toFixed(6), '0.009352', 'the hand-computed amount is the one written in the comment');
  assert.ok(Math.abs(cost - expected) < 1e-12, `cost ${cost} should equal the hand-computed ${expected}`);
  // 量级闸：单位写成「每千」会得到 $9.35，写成「每个 token」会得到 $9352。
  // 这条断言比上面那条等式更耐改 —— 它拦的是「把两边一起改错」。
  assert.ok(cost > 1e-6 && cost < 1e-2, `a one-turn cost must land between $1e-6 and $1e-2, got ${cost}`);
});

/**
 * 用量刻意压在 10 万以内：喂一个超过 `contextWindow` 的数字会让 pi 走溢出恢复 + 重试退避，
 * 一条本来 90ms 的测试要空等 7 秒 —— 而它证明的东西一个字都没多。
 */
const CACHE_TOKENS = 100_000;

test('P4 · cache reads are billed at the cache rate, not the input rate', async (t) => {
  // 为什么单独一条：`cacheRead` 便宜一个数量级，把它按输入价算会让金额悄悄高一截 ——
  // 高一截不会像 1000 倍那样显眼，所以需要一条只盯着它的断言。
  const fixture = await createLaneFixture(t, [
    { type: 'text', text: 'Done.', usage: { input: 0, output: 0, cacheRead: CACHE_TOKENS, cacheWrite: 0 } }]);
  const lane = await openLane({ ...fixture.options,
    model: { ...fixture.options.model, tokenPricing: V4_FLASH } });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Say done.' });

  const cost = knownValue(metricOf(lane.projection().usage, 'cost'), 'cost');
  const atCacheRate = (CACHE_TOKENS * V4_FLASH.cacheReadPerMTokUsd) / 1_000_000;
  const atInputRate = (CACHE_TOKENS * V4_FLASH.inputPerMTokUsd) / 1_000_000;
  assert.ok(Math.abs(cost - atCacheRate) < 1e-12,
    `cache-read tokens must bill at the cache rate ($${atCacheRate}), not the input rate ($${atInputRate}); got ${cost}`);
});

test('P4 · an omitted cache rate falls back to the input rate, never to free', async (t) => {
  // 供应商不单列缓存价时，缓存读写就是按输入价结算的。`?? 0` 会把它白送出去 ——
  // 那是一个我们没资格给用户的折扣。
  const fixture = await createLaneFixture(t, [
    { type: 'text', text: 'Done.', usage: { input: 0, output: 0, cacheRead: CACHE_TOKENS, cacheWrite: 0 } }]);
  const lane = await openLane({ ...fixture.options, model: { ...fixture.options.model,
    tokenPricing: { inputPerMTokUsd: V4_FLASH.inputPerMTokUsd, outputPerMTokUsd: V4_FLASH.outputPerMTokUsd } } });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Say done.' });

  const cost = knownValue(metricOf(lane.projection().usage, 'cost'), 'cost');
  const atInputRate = (CACHE_TOKENS * V4_FLASH.inputPerMTokUsd) / 1_000_000;
  assert.ok(Math.abs(cost - atInputRate) < 1e-12,
    `an omitted cache rate must bill at the input rate ($${atInputRate}), got ${cost}`);
});

// ── G3d · 三态：不可知 ≠ 0 ────────────────────────────────────────────────────

test('G3d · 首轮：一条回合都还没结算时，三行全部「不可知」，一个 0 都不画', async (t) => {
  const fixture = await createLaneFixture(t, SAY_HI);
  const lane = await openLane({ ...fixture.options,
    model: { ...fixture.options.model, tokenPricing: V4_FLASH, reasoning: true } });
  t.after(() => lane.close());

  // 刻意**不发**任何提示词：这就是用户打开面板的第一眼。
  const { usage } = lane.projection();
  assert.deepEqual(usage.cost, { state: 'unknown', reason: 'no-settled-turn' },
    '有价目、但一分钱都还没花：那个 0 是「还没开始」，不是「花了 0 块」');
  assert.deepEqual(usage.contextTokens, { state: 'unknown', reason: 'no-settled-turn' },
    '首轮估算不含系统提示词与工具 schema，低估几千 token —— 与其画一个低估值，不如说不知道');
  assert.deepEqual(usage.reasoningTokens, { state: 'unknown', reason: 'no-settled-turn' });
});

test('G3d · 无价目模型：花费「不可知」，不是 $0.00；token 那几列照常有数', async (t) => {
  const fixture = await createLaneFixture(t, SAY_HI);
  // 目录里没有这个模型的 per-token 价（DeepSeek V3.2 / V3.1-terminus 就是这种）。
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Say done.' });

  const { usage } = lane.projection();
  assert.deepEqual(usage.cost, { state: 'unknown', reason: 'model-has-no-pricing' });
  // 阳性对照：这一轮**确实**烧了 token。少了这条，一个「什么都报不可知」的实现也能全绿。
  assert.ok(knownValue(usage.contextTokens, 'contextTokens') > 0,
    'the same turn must still report a real context number — only the money is unknown');
});

test('G3d · 免费模型：花费是「不适用」，和「不可知」不是同一句话', async (t) => {
  const fixture = await createLaneFixture(t, SAY_HI);
  const lane = await openLane({ ...fixture.options, model: { ...fixture.options.model, free: true } });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Say done.' });

  assert.deepEqual(lane.projection().usage.cost, { state: 'not-applicable', reason: 'model-is-free' },
    '「查过了，不花钱」和「我们不知道花了多少」是两个答案，面板上说的是两句不同的话');
});

test('G3d · 刚压缩完：上下文「不可知」，因为旧数字描述的是压缩前的上下文', async (t) => {
  // **这一条为什么是纯函数级的**：`lane.compact()` 住在 pi 的 `AgentLane` 上，而阶段 3b 的
  // `LaneHandle` 只暴露 prompt / abort（面板还没有「压缩」这个动作，为一条测试加一个没有 UI
  // 的命令就是留一段死代码）。所以这里先用真 lane 跑出一份**真快照形状**，再往转录尾巴上
  // 放一条真类型的 `CompactionEntry` —— 合成的只有那一条标记，其余全是 pi 自己产的。
  const fixture = await createLaneFixture(t, SAY_HI);
  const lane = await openLane({ ...fixture.options,
    model: { ...fixture.options.model, tokenPricing: V4_FLASH } });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Say done.' });

  const facts: LaneModelFacts = { model: laneModel(), pricing: 'priced' };
  const settled = snapshotWith([
    { id: 'e1', parentId: null, seq: 1, timestamp: 1, type: 'message',
      message: assistant({ input: 900, output: 100, cacheRead: 0, cacheWrite: 0 }) },
  ]);
  // 阳性对照先跑：同一份转录**没有**压缩条目时必须是 `known`。缺了它，一个
  // 「上下文永远不可知」的实现在下面那条断言上也是绿的。
  assert.equal(knownValue(projectLaneSnapshot(settled, facts).usage.contextTokens, 'contextTokens'), 900);

  const compacted = snapshotWith([
    ...settled.transcript,
    { id: 'e2', parentId: 'e1', seq: 2, timestamp: 2, type: 'compaction',
      summary: 'earlier conversation', retainedTail: [], tokensBefore: 900, fromHook: false },
  ]);
  assert.deepEqual(projectLaneSnapshot(compacted, facts).usage.contextTokens,
    { state: 'unknown', reason: 'just-compacted' },
    '压缩之后到下一条助手回复之前，上一轮的 prompt 数字已经不回答「现在装了多少」这个问题');

  // 压缩之后又跑了一轮 → 重新有数。这条钉的是「不可知」是**一段状态**，不是一个粘住的开关。
  const resumed = snapshotWith([
    ...compacted.transcript,
    { id: 'e3', parentId: 'e2', seq: 3, timestamp: 3, type: 'message',
      message: assistant({ input: 120, output: 30, cacheRead: 0, cacheWrite: 0 }) },
  ]);
  // 120 = input 120 + cacheRead 0 + cacheWrite 0。**输出不算在里面**：上下文占用问的是
  // 「下一次请求要带多少进去」，而 pi 对「输入」的定义就是那三列之和（`calculateCost` 第一行）。
  assert.equal(knownValue(projectLaneSnapshot(resumed, facts).usage.contextTokens, 'contextTokens'), 120);
});

// ── 推理那一行 ────────────────────────────────────────────────────────────────

test('推理：不会思考的模型「不适用」；会思考但供应商没报的「不可知」；报了的才有数', async (t) => {
  const withReasoning = await createLaneFixture(t, [
    { type: 'text', text: 'Done.', usage: { input: 10, output: 40, reasoning: 25 } }]);
  const thinking = await openLane({ ...withReasoning.options,
    model: { ...withReasoning.options.model, reasoning: true } });
  t.after(() => thinking.close());
  await thinking.execute({ kind: 'prompt', text: 'Think then answer.' });
  assert.equal(knownValue(thinking.projection().usage.reasoningTokens, 'reasoningTokens'), 25,
    '推理 token 只在逐条助手消息上有 —— pi 的会话总计把它丢掉了，所以必须走转录');

  const plain = await createLaneFixture(t, SAY_HI);
  const noThinking = await openLane(plain.options);
  t.after(() => noThinking.close());
  await noThinking.execute({ kind: 'prompt', text: 'Say done.' });
  assert.deepEqual(noThinking.projection().usage.reasoningTokens,
    { state: 'not-applicable', reason: 'model-has-no-reasoning' },
    'getSupportedThinkingLevels 只返回 ["off"] 的模型没有推理这回事 —— 那一行整行不画');
});

test('推理档由 getSupportedThinkingLevels derive；off 被标 null 的模型关不掉思考', async (t) => {
  const plain = await createLaneFixture(t, SAY_HI);
  const off = await openLane(plain.options);
  t.after(() => off.close());
  assert.deepEqual(off.projection().thinking.supportedLevels, ['off'],
    'reasoning:false 的模型只有一档 —— 面板不许给它画一排点不动的档位');

  const gated = await createLaneFixture(t, SAY_HI);
  const lane = await openLane({ ...gated.options, model: { ...gated.options.model,
    // `null` = 这一档这个模型不支持。`off: null` 就是「关不掉思考」。
    reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' } } });
  t.after(() => lane.close());
  const { thinking } = lane.projection();
  assert.deepEqual([...thinking.supportedLevels], ['low', 'medium', 'high'],
    'thinkingLevelMap[level] === null 的档由 pi 自己剔掉，我们不另列一张表');
  assert.equal(thinking.canTurnOff, false,
    '关不掉思考的模型必须有对应态 —— 画一个按下去不生效的「关闭」比不画更糟');
});

// ── 上面几条共用的最小构件 ────────────────────────────────────────────────────

function assistant(usage: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  return {
    role: 'assistant' as const, content: [{ type: 'text' as const, text: 'ok' }],
    api: 'openai-completions' as const, provider: 'nomi-lane', model: 'chosen-model',
    usage: { ...usage, totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop' as const, timestamp: 1,
  };
}

function laneModel() {
  return {
    provider: 'nomi-lane', id: 'chosen-model', name: 'chosen-model',
    api: 'openai-completions' as const, baseUrl: 'http://127.0.0.1/v1', reasoning: false,
    input: ['text' as const], cost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 },
    contextWindow: 128_000, maxTokens: 4096,
  };
}

function snapshotWith(transcript: LaneSnapshot['transcript']): LaneSnapshot {
  const usage = transcript.reduce((sum, entry) => entry.type === 'message' && entry.message.role === 'assistant'
    ? sum + entry.message.usage.input + entry.message.usage.output : sum, 0);
  return {
    lane: 'main', transcript, tipId: transcript.at(-1)?.id ?? null,
    configuration: { model: { provider: 'nomi-lane', modelId: 'chosen-model' },
      thinkingLevel: 'medium', activeToolNames: [] },
    stats: { messageCount: transcript.length,
      usage: { input: usage, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: usage,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.0001 } } },
    operation: null, queues: [], faulted: false,
  };
}
