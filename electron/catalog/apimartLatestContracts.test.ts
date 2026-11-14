import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import contracts from '../../tests/fixtures/apimart/audio-contracts.json';
import pricingApi from '../../tests/fixtures/apimart/text-pricing-api.json';
import generations from '../../tests/fixtures/apimart/model-generations.json';
import { buildHttpRequest, buildTemplateContext } from '../ai/requestPipeline';
import { nomiModelConfigFor } from '../ai/vendorModelConnection';
import { callModelOnce } from '../agentLane/laneModelCall.mjs';
import { firstMappedString } from '../tasks/responseParsing';
import { resolveArchetypeForModel } from '../shared/modelArchetypes';
import { APIMART_AUDIO_MODELS } from './apimartAudios';
import { APIMART_TEXT_MODELS, apimartTextPricingApi } from './apimartTexts';
import { applyHeadlessParamDefaults, taskTemplateParams } from './taskParams';
import { applyBuiltinSeeds } from './seedBuiltins';
import { createCatalogAvailability } from './catalogModelAvailability';
import { selectTextModelCandidates } from '../ai/textBrainResolver';
import { curatedCatalogLifecycle } from './seedModelIdentity';
import { selectTaskMapping, type CatalogState, type HttpOperation } from './types';
import { CATALOG_LATEST_SAMPLES, actualChargeOf, runCatalogLatestSamples, settleSampleTask } from '../../tests/ux/catalogLatestSamples';

const VERSIONS = ['v6', 'v6-wild', 'v6-mini'];
const BRAINS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna',
  'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5.1',
  'gemini-4-argon', 'gemini-3.8-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash',
  'qwen3.8-max', 'qwen3.8-flash', 'qwen3.8-27b', 'qwen3.8-2.4t-a95b',
  'glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'grok-4.7', 'minimax-m3', 'step-3.7-flash'];

function unknownFields(body: unknown, allowed: string[]): string[] {
  return Object.keys(body as object).filter(key => !allowed.includes(key));
}

function preview(modelKey: string, extras: Record<string, unknown> = {}) {
  const model = APIMART_AUDIO_MODELS.find(row => row.modelKey === modelKey)!;
  const mapping = model.mappings.find(row => row.taskKind === 'text_to_audio')!;
  const selection = { vendorKey: 'apimart', modelKey, modelMeta: { archetypeId: model.archetypeId }, taskKind: 'text_to_audio' };
  const request = { kind: 'text_to_audio' as const, prompt: 'A thunderstorm with distant bells',
    extras: applyHeadlessParamDefaults(extras, selection, mapping.create.defaultParams, mapping.create.body) };
  const context = buildTemplateContext({ request, params: taskTemplateParams(request, { ...selection, operation: mapping.create }),
    model: { modelKey }, modelKey, apiKey: 'fixture-only' });
  return { model, mapping, context, built: buildHttpRequest({ baseUrl: 'https://api.apimart.ai', authType: 'bearer', apiKey: 'fixture-only', context, operation: mapping.create }) };
}

describe('APIMart audio official field contracts and request previews', () => {
  it('rehearses the paid runner sample loop through the production request preview', async () => {
    const results = await runCatalogLatestSamples(async sample => {
      const result = preview(sample.modelKey, sample.params);
      expect(result.built.body).toHaveProperty('model');
      expect(JSON.stringify(result.built.body)).not.toContain('{{');
      return { status: 'succeeded' };
    });
    expect(results).toHaveLength(4);
  });

  it('resumes a paid run at one sample without re-submitting the ones before it, and refuses an unknown resume point', async () => {
    const submitted: string[] = [];
    const results = await runCatalogLatestSamples(async sample => {
      submitted.push(sample.modelKey);
      return { status: 'succeeded' };
    }, { from: 'nomi-audio' });
    const resumeAt = CATALOG_LATEST_SAMPLES.findIndex(sample => sample.modelKey === 'nomi-audio');
    expect(submitted).toEqual(CATALOG_LATEST_SAMPLES.slice(resumeAt).map(sample => sample.modelKey));
    expect(submitted).not.toContain('suno-v6-mini');
    expect(results).toHaveLength(CATALOG_LATEST_SAMPLES.length - resumeAt);
    await expect(runCatalogLatestSamples(async () => ({ status: 'succeeded' }), { from: 'suno-v5.5' })).rejects.toThrow(/unknown resume sample/);
  });

  it('keeps every receipt written before a mid-run failure, the failed one included, and stops without retrying', async () => {
    const written: Array<Record<string, unknown>> = [];
    const submitted: string[] = [];
    const failAt = CATALOG_LATEST_SAMPLES[2]!.modelKey;
    const run = runCatalogLatestSamples(async (sample, note) => {
      submitted.push(sample.modelKey);
      note({ taskId: `task-${sample.modelKey}` });
      // 第三单受理了（有任务号）、然后轮询超时抛出：回执里仍要有它的任务号，不能当成没下单。
      if (sample.modelKey === failAt) throw new Error(`task task-${sample.modelKey} still running after 1ms`);
      return { status: 'succeeded', taskId: `task-${sample.modelKey}`, charge: actualChargeOf({ data: { credits_cost: 3 } }) };
    }, { record: receipt => { written.push(receipt); } });
    await expect(run).rejects.toThrow(new RegExp(`${failAt}: stop; do not retry`));
    expect(submitted).toEqual(CATALOG_LATEST_SAMPLES.slice(0, 3).map(sample => sample.modelKey));
    expect(written).toHaveLength(3);
    expect(written.slice(0, 2)).toEqual(CATALOG_LATEST_SAMPLES.slice(0, 2).map(sample => expect.objectContaining({
      key: sample.modelKey, ok: true, status: 'succeeded', taskId: `task-${sample.modelKey}`, charge: { amount: 3, unit: 'credits', provider: 'apimart' } })));
    expect(written[2]).toMatchObject({ key: failAt, ok: false, taskId: `task-${failAt}`, error: expect.stringContaining('still running') });
    // 扣费读不到就是「不知道」，不是 0。
    expect(actualChargeOf({ data: { status: 'completed' } })).toBeNull();
  });

  it('a failed status (not a throw) is also a receipt and also stops the run', async () => {
    const written: Array<Record<string, unknown>> = [];
    await expect(runCatalogLatestSamples(async sample => ({ status: sample.modelKey === CATALOG_LATEST_SAMPLES[0]!.modelKey ? 'failed' : 'succeeded', taskId: 'T-failed' }),
      { record: receipt => { written.push(receipt); } })).rejects.toThrow(/stop; do not retry/);
    expect(written).toEqual([expect.objectContaining({ key: CATALOG_LATEST_SAMPLES[0]!.modelKey, ok: false, status: 'failed', taskId: 'T-failed' })]);
  });

  it('follows an accepted order through the bridge shapes: run gives the task, result wraps it as { vendor, result }', async () => {
    const asked: string[] = [];
    let polls = 0;
    const settled = await settleSampleTask({ id: 'T1', status: 'queued' }, async taskId => {
      asked.push(taskId);
      polls += 1;
      return { vendor: 'apimart', result: { id: 'T1', status: polls < 2 ? 'running' : 'succeeded', assets: [] } };
    }, { timeoutMs: 1000, intervalMs: 1 });
    expect(settled.status).toBe('succeeded');
    expect(asked).toEqual(['T1', 'T1']);
  });

  it('stops before asking the vendor when an accepted order has no task id', async () => {
    const asked: string[] = [];
    await expect(settleSampleTask({ status: 'queued' }, async taskId => { asked.push(taskId); return {}; },
      { timeoutMs: 1000, intervalMs: 1 })).rejects.toThrow(/no task id/);
    expect(asked).toEqual([]);
  });

  it('checks every declared version against independently recorded official wire fields', () => {
    for (const model of APIMART_AUDIO_MODELS) {
      for (const mapping of model.mappings.filter(row => row.taskKind === 'text_to_audio')) {
        const kind = mapping.create.path?.endsWith('/sounds') ? 'sounds' : model.modelKey === 'nomi-audio' ? 'tts'
          : model.modelKey.startsWith('flowmusic') ? 'lyria' : 'music';
        expect(unknownFields(mapping.create.body, contracts[kind].fields), `${model.modelKey}: ${contracts[kind].url}`).toEqual([]);
      }
    }
  });

  it('detects the same field-name class outside Suno and outside the current version', () => {
    expect(unknownFields({ sound_type: 'loop' }, contracts.sounds.fields)).toEqual(['sound_type']);
    expect(unknownFields({ sound_tempo: 80 }, contracts.music.fields)).toEqual(['sound_tempo']);
    expect(unknownFields({ speech_input: 'hello' }, contracts.tts.fields)).toEqual(['speech_input']);
    expect(unknownFields({ prompt: 'music' }, contracts.lyria.fields)).toEqual(['prompt']);
  });

  it.each(VERSIONS)('previews independent Suno %s music and sound identities through production templates', version => {
    const music = preview(`suno-${version}`, { instrumental: true });
    expect(music.built.url).toBe('https://api.apimart.ai/v1/music/generations');
    expect(music.built.body).toEqual({ model: 'suno', version, custom: false, prompt: 'A thunderstorm with distant bells', instrumental: true });
    const sounds = preview(`suno-sounds-${version}`, { sound_type: 'loop', sound_tempo: 80, sound_key: 'Cm' });
    expect(sounds.built.url).toBe('https://api.apimart.ai/v1/music/generations/sounds');
    expect(sounds.built.body).toEqual({ model: 'suno', version, prompt: 'A thunderstorm with distant bells', type: 'loop', bpm: 80, key: 'Cm' });
    for (const sample of [music, sounds]) {
      expect(sample.built.headers.Authorization).toBe('Bearer fixture-only');
      expect(sample.model.archetypeId).toContain('v6');
      const archetype = resolveArchetypeForModel({ modelKey: sample.model.modelKey, vendorKey: 'apimart', meta: { archetypeId: sample.model.archetypeId } })!;
      expect(archetype.modes).toHaveLength(1);
      expect(archetype.modes[0]!.slots).toEqual([]);
      expect(curatedCatalogLifecycle(sample.model.modelKey)).not.toBe('legacy');
      const create = { code: 200, data: [{ status: 'submitted', task_id: 'task-official-example' }] };
      expect(firstMappedString(create, sample.mapping.create.response_mapping!, 'task_id')).toBe('task-official-example');
      expect(firstMappedString(create, sample.mapping.create.provider_meta_mapping!, 'task_id')).toBe('task-official-example');
      const query: HttpOperation = sample.mapping.query!;
      const result = { data: { id: 'task-official-example', status: 'completed', result: { music: [{ audio_url: 'https://example.com/result.mp3' }] } } };
      expect(firstMappedString(result, query.response_mapping!, 'audio_url')).toBe('https://example.com/result.mp3');
      expect(firstMappedString({ data: { result: { music: [] } } }, query.response_mapping!, 'audio_url')).toBe('');
      expect(sample.mapping.statusMapping?.succeeded).toContain('completed');
      expect(sample.mapping.statusMapping?.failed).toContain('failed');
    }
  });

  it('preserves the synchronous speech route and honest unknown generation price', () => {
    const sample = preview('nomi-audio');
    expect(sample.built.body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'alloy', speed: 1, response_format: 'wav' });
    expect(sample.mapping.create.audioResponse).toEqual({ type: 'binary', contentType: 'audio/wav', extension: 'wav' });
    const state = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-11-07').state;
    expect(state.models.find(row => row.vendorKey === 'apimart' && row.modelKey === 'nomi-audio')?.pricing).toBeUndefined();
  });
});

// ── 价目：从 APIMart 公开价目接口的原始快照重算（tests/fixtures/apimart/text-pricing-api.json），不抄一份算好的数 ──
// 规则和 apimartTexts.ts 的 APIMART_TEXT_PRICING_RULE 同一条：列表价 × price_factor；分档取最高档；峰谷取峰；
// 缓存读取（隐式 / 显式）取高，缓存写入（5 分钟 / 1 小时）取高；接口里整个没有的字段 = 不填。
type PriceRow = Record<string, number | undefined>;
type PricingRecord = { price_factor: number; rates: PriceRow; tiers?: PriceRow[]; time_pricing?: { windows: Array<{ rate: number }> } };
const PRICE_FIELDS = {
  inputPerMTokUsd: ['input'],
  outputPerMTokUsd: ['output'],
  cacheReadPerMTokUsd: ['cached_input', 'explicit_cached_input'],
  cacheWritePerMTokUsd: ['cache_write', 'cache_write_5m', 'cache_write_1h'],
} as const;
const snapshot = pricingApi as unknown as {
  url: string; fetchedAt: string; priced: string[]; unpricedOnPurpose: Record<string, string>; models: Record<string, PricingRecord>;
};

function declaredFromPricingApi(record: PricingRecord): Record<keyof typeof PRICE_FIELDS, number | undefined> {
  const rows = [record.rates, ...(record.tiers ?? [])];
  const peak = Math.max(1, ...(record.time_pricing?.windows ?? []).map(window => window.rate));
  const highest = (fields: readonly string[]) => {
    const values = rows.flatMap(row => fields.map(field => row[field]).filter((value): value is number => typeof value === 'number'));
    return values.length ? Math.max(...values) * record.price_factor * peak : undefined;
  };
  return Object.fromEntries(Object.entries(PRICE_FIELDS).map(([key, fields]) => [key, highest(fields)])) as Record<keyof typeof PRICE_FIELDS, number | undefined>;
}

describe('text prices follow the APIMart public pricing API, recomputed from its raw answer', () => {
  it.each(snapshot.priced)('%s: every declared rate is the API effective rate (highest tier, peak, longest cache write)', modelKey => {
    const definition = APIMART_TEXT_MODELS.find(row => row.modelKey === modelKey);
    expect(definition, `${modelKey} is in the pricing snapshot but not declared`).toBeDefined();
    const { source, ...declared } = definition!.tokenPricing ?? {};
    expect(source).toEqual({ url: apimartTextPricingApi(modelKey), checkedAt: snapshot.fetchedAt });
    const expected = declaredFromPricingApi(snapshot.models[modelKey]!);
    for (const key of Object.keys(PRICE_FIELDS) as Array<keyof typeof PRICE_FIELDS>) {
      const want = expected[key];
      if (want === undefined) expect(declared[key as keyof typeof declared], `${modelKey}.${key}: the API has no such rate`).toBeUndefined();
      else expect(declared[key as keyof typeof declared], `${modelKey}.${key}`).toBeCloseTo(want, 9);
    }
  });

  it('prices exactly the snapshot set; the only chat brain left unpriced is the one recorded as unpriced on purpose', () => {
    const chat = APIMART_TEXT_MODELS.filter(row => !row.meta?.promptRefineOnly);
    expect(chat.filter(row => row.tokenPricing).map(row => row.modelKey).sort()).toEqual([...snapshot.priced].sort());
    expect(chat.filter(row => !row.tokenPricing && !row.free).map(row => row.modelKey)).toEqual(Object.keys(snapshot.unpricedOnPurpose));
  });

  it('the recomputation itself is not a copy: tiers, peak windows and cache variants all change the answer', () => {
    const base = { price_factor: 0.8, rates: { input: 1, output: 2, cache_write: 0, cache_write_1h: 3 } };
    const tiered = declaredFromPricingApi({ ...base, tiers: [{ input: 1, output: 2 }, { input: 5, output: 6 }] });
    expect(tiered.inputPerMTokUsd).toBeCloseTo(4, 9);
    expect(tiered.outputPerMTokUsd).toBeCloseTo(4.8, 9);
    expect(declaredFromPricingApi({ ...base, time_pricing: { windows: [{ rate: 1 }, { rate: 0.5 }] } }).inputPerMTokUsd).toBeCloseTo(0.8, 9);
    expect(declaredFromPricingApi(base).cacheWritePerMTokUsd).toBeCloseTo(2.4, 9);
    expect(declaredFromPricingApi({ price_factor: 0.8, rates: { input: 1, output: 2 } }).cacheReadPerMTokUsd).toBeUndefined();
  });
});

// ── 声明的出处：通用协议模型 = 协议页给依据，模型列表 + 真调用给封印（设计卡「按官方文档对齐」）──
describe('every text declaration names where it comes from', () => {
  it.each(APIMART_TEXT_MODELS.map(row => row.modelKey))('%s: protocol page, pricing API and live-call status are written down', modelKey => {
    const { evidence } = APIMART_TEXT_MODELS.find(row => row.modelKey === modelKey)!;
    expect(evidence.protocolDoc).toMatch(/^https:\/\/docs\.apimart\.ai\/en\/api-reference\//);
    if (evidence.modelDoc) expect(evidence.modelDoc).toMatch(/^https:\/\/docs\.apimart\.ai\/en\/api-reference\//);
    expect(evidence.pricingApi).toBe(apimartTextPricingApi(modelKey));
    if (evidence.liveCall !== '未') expect(evidence.liveCall).toEqual({ checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), record: expect.any(String) });
  });

  it('an image-input claim needs its own first-hand record; nothing claims image input on the protocol page alone', () => {
    const claimed = APIMART_TEXT_MODELS.filter(row => row.meta?.supportsImageInput === true);
    for (const row of claimed) expect(row.evidence.imageInput, `${row.modelKey} claims image input without a Vision tag or a live image call`).toEqual({ checkedAt: expect.any(String), record: expect.any(String) });
    // 读图只认一手依据：gemini-3.5-flash 是 2026-08-12 带图真调用；另 6 个是 2026-11-08 一问一个带暗号图读出来的。
    // claude-fable-5.1 那次没调成（402），不写读图。
    expect(claimed.map(row => row.modelKey)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gemini-4-argon', 'gemini-3.8-flash', 'deepseek-v4.1-flash', 'gemini-3.5-flash']);
    const state = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-11-07').state;
    const seededReaders = state.models.filter(row => row.vendorKey === 'apimart' && row.kind === 'text' && (row.meta as { supportsImageInput?: unknown } | undefined)?.supportsImageInput === true);
    expect(seededReaders.map(row => row.modelKey).sort()).toEqual([...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gemini-4-argon', 'gemini-3.8-flash', 'deepseek-v4.1-flash', 'gemini-3.5-flash']].sort());
  });

  it.each(['fresh', 'v0.24.1'])('%s keeps automatic text and image choices when only APIMart is available', (installation) => {
    const root = new URL('../../tests/fixtures/old-user-data/curated/v0.24.1-apimart/', import.meta.url);
    const base: CatalogState = installation === 'fresh'
      ? { version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }
      : JSON.parse(fs.readFileSync(new URL('model-catalog.json', root), 'utf8'));
    const { state } = applyBuiltinSeeds(base, '2026-11-08');
    state.vendors = state.vendors.map(vendor => ({ ...vendor, enabled: vendor.key === 'apimart' }));
    state.apiKeysByVendor = { apimart: { vendorKey: 'apimart', apiKey: 'fixture-only', enc: 'plain', enabled: true, createdAt: '', updatedAt: '' } };
    const availability = createCatalogAvailability(state, () => 'ok');
    for (const models of [state.models, [...state.models].reverse()]) {
      const current = { ...state, models };
      const text = selectTextModelCandidates(current, undefined, false, availability);
      expect(text.slice(0, 2).map(row => row.model.modelKey)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
      expect(selectTextModelCandidates(current, undefined, true, availability)[0]?.model.modelKey).toBe('gemini-3.5-flash');
      const preference = { vendorKey: 'apimart', modelKey: 'gpt-6-astra' };
      for (const withImage of [false, true]) {
        expect(selectTextModelCandidates(current, preference, withImage, availability).map(row => row.model.modelKey)).toEqual(['gpt-6-astra']);
      }
      const proOff = { ...current, models: models.map(row => row.vendorKey === 'apimart' && row.modelKey === 'deepseek-v4-pro' ? { ...row, enabled: false } : row) };
      expect(selectTextModelCandidates(proOff, undefined, false, availability)[0]?.model.modelKey).toBe('deepseek-v4-flash');
    }
  });

  it('ids are spelled the way the official page spells them: qwen3.8-max, not the price-list alias qwen3.8-max-0902', () => {
    expect(APIMART_TEXT_MODELS.find(row => row.modelKey === 'qwen3.8-max')?.evidence.modelDoc).toBe('https://docs.apimart.ai/en/api-reference/texts/qwen3.8-max/guide');
    const state = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-11-07').state;
    for (const removed of ['qwen3.8-max-0902']) {
      expect(APIMART_TEXT_MODELS.some(row => row.modelKey === removed), removed).toBe(false);
      expect(state.models.some(row => row.modelKey === removed), `${removed} is still seeded`).toBe(false);
    }
  });
});

describe('current brains and old catalog compatibility', () => {
  it.each(snapshot.priced)('previews %s using the real shared model call and parses the official Chat SSE shape', async modelKey => {
    const definition = APIMART_TEXT_MODELS.find(row => row.modelKey === modelKey)!;
    const config = nomiModelConfigFor({ key: 'apimart', name: 'APIMart', enabled: true, authType: 'bearer', baseUrlHint: 'https://api.apimart.ai', createdAt: '', updatedAt: '' },
      { ...definition, vendorKey: 'apimart', kind: 'text', enabled: true, createdAt: '', updatedAt: '' }, 'fixture-only');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'chat-example', object: 'chat.completion.chunk', created: 0,
      model: modelKey, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const result = await callModelOnce({ model: config, content: 'Reply OK.', maxRetries: 0, maxTokens: 128,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(chunk({ role: 'assistant', content: 'OK' }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } });
      } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://api.apimart.ai/v1/chat/completions');
    expect(requests[0]!.body).toMatchObject({ model: modelKey, stream: true, messages: [{ role: 'user', content: 'Reply OK.' }] });
    expect(result.message.content).toContainEqual({ type: 'text', text: 'OK' });
    expect(result.pricingBasis).toBe('priced');
  });

  it('declares exactly the current candidates without adding MiMo or changing old identities', () => {
    for (const key of BRAINS) expect(APIMART_TEXT_MODELS.find(row => row.modelKey === key), key).toBeDefined();
    expect(APIMART_TEXT_MODELS.some(row => row.modelKey.startsWith('mimo-'))).toBe(false);
    for (const key of ['deepseek-v4-flash', 'gemini-3.5-flash']) {
      expect(APIMART_TEXT_MODELS.find(row => row.modelKey === key)).toBeDefined();
    }
  });

  it('reconciles real release-written data while retaining every saved identity and executable audio mapping', () => {
    const root = new URL('../../tests/fixtures/old-user-data/curated/v0.24.1-apimart/', import.meta.url);
    const original = JSON.parse(fs.readFileSync(new URL('model-catalog.json', root), 'utf8')) as CatalogState;
    const before = structuredClone(original);
    const { state } = applyBuiltinSeeds(original, '2026-11-07');
    const removedTextModels = before.models.filter(row => row.vendorKey === 'apimart' && row.kind === 'text'
      && !APIMART_TEXT_MODELS.some(current => current.modelKey === row.modelKey));
    expect(removedTextModels).toHaveLength(1);
    state.apiKeysByVendor = { apimart: { vendorKey: 'apimart', apiKey: 'fixture-only', enc: 'plain', enabled: true, createdAt: '', updatedAt: '' } };
    const availability = createCatalogAvailability(state, () => 'ok');
    for (const preference of removedTextModels) {
      expect(selectTextModelCandidates(state, preference, false, availability)[0]?.model.modelKey).toBe(preference.modelKey);
    }
    expect(selectTextModelCandidates(state, undefined, false, availability)[0]?.model.modelKey).toBe('deepseek-v4-pro');
    for (const row of before.models) {
      expect(state.models.find(next => next.vendorKey === row.vendorKey && next.modelKey === row.modelKey))
        .toMatchObject({ enabled: row.enabled, labelZh: row.labelZh, modelKey: row.modelKey, createdAt: row.createdAt });
    }
    for (const modelKey of ['suno-v5.5', 'suno-sounds-v5.5']) {
      const mapping = selectTaskMapping(state.mappings, 'apimart', 'text_to_audio', modelKey)!;
      expect(mapping).toBeTruthy();
      expect(mapping.create.body).toMatchObject({ version: 'v5.5' });
      // 上一代：旧作品照跑，新节点也照常能选（用户 2026-11-07：最新代和旧一代的都可以接）。
      expect(curatedCatalogLifecycle(modelKey)).not.toBe('legacy');
    }
    const sounds = preview('suno-sounds-v5.5', { sound_type: 'loop', sound_tempo: 80, sound_key: 'Cm' });
    expect(sounds.built.body).toMatchObject({ version: 'v5.5', type: 'loop', bpm: 80, key: 'Cm' });
    // 老用户升级后看到的价：旧的一手厂商价整份换成 APIMart 价目接口的有效值（缓存价接口没有就不留），读图声明照旧。
    for (const modelKey of ['deepseek-v4-pro', 'deepseek-v4-flash', 'gemini-3.5-flash']) {
      const upgraded = state.models.find(row => row.vendorKey === 'apimart' && row.modelKey === modelKey)!;
      expect(before.models.find(row => row.modelKey === modelKey)?.tokenPricing?.source?.url).not.toContain('api.apimart.ai');
      expect(upgraded.tokenPricing).toEqual(APIMART_TEXT_MODELS.find(row => row.modelKey === modelKey)!.tokenPricing);
    }
    expect(state.models.find(row => row.modelKey === 'gemini-3.5-flash')?.tokenPricing?.cacheReadPerMTokUsd).toBeUndefined();
    expect(state.models.find(row => row.modelKey === 'gemini-3.5-flash')?.meta).toMatchObject({ supportsImageInput: true });
    expect(applyBuiltinSeeds(state, '2026-11-08').changed).toBe(false);
  });
});

// 用户 2026-11-07：「最新代和旧一代的都可以接」。最新一代和上一代都是新节点的可选项（不是 legacy，legacy 会被收进「更多」）；
// 只有比上一代更老的才是 legacy。表在 tests/fixtures/apimart/model-generations*.json，每个家族一条，新模型进目录必须先登记到这里。
describe('model generations: latest and previous stay available to new nodes', () => {
  const rows = generations as Array<{ family: string; latest: string[]; previous: string[]; older: string[] }>;
  it.each(rows)('$family: latest and previous are not legacy, older ones are', row => {
    for (const key of [...row.latest, ...row.previous]) expect(curatedCatalogLifecycle(key), key).not.toBe('legacy');
    for (const key of row.older) expect(curatedCatalogLifecycle(key), key).toBe('legacy');
    if (row.previous.length) expect(row.latest.length).toBeGreaterThan(0);
  });

  it('every declared audio and text model belongs to exactly one family generation row', () => {
    const known = rows.flatMap(row => [...row.latest, ...row.previous, ...row.older]);
    expect(new Set(known).size).toBe(known.length);
    const declared = [...APIMART_AUDIO_MODELS.map(row => row.modelKey), ...APIMART_TEXT_MODELS.filter(row => !row.meta?.promptRefineOnly).map(row => row.modelKey)];
    expect(declared.filter(key => !known.includes(key)), 'register new models in tests/fixtures/apimart/model-generations.json').toEqual([]);
  });
});
