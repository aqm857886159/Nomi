import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import contracts from '../../tests/fixtures/apimart/audio-contracts.json';
import prices from '../../tests/fixtures/apimart/text-prices.json';
import generations from '../../tests/fixtures/apimart/model-generations.json';
import { buildHttpRequest, buildTemplateContext } from '../ai/requestPipeline';
import { nomiModelConfigFor } from '../ai/vendorModelConnection';
import { callModelOnce } from '../agentLane/laneModelCall.mjs';
import { firstMappedString } from '../tasks/responseParsing';
import { resolveArchetypeForModel } from '../shared/modelArchetypes';
import { APIMART_AUDIO_MODELS } from './apimartAudios';
import { APIMART_TEXT_MODELS } from './apimartTexts';
import { applyHeadlessParamDefaults, taskTemplateParams } from './taskParams';
import { applyBuiltinSeeds } from './seedBuiltins';
import { curatedCatalogLifecycle } from './seedModelIdentity';
import { selectTaskMapping, type CatalogState, type HttpOperation } from './types';
import { runCatalogLatestSamples, settleSampleTask } from '../../tests/ux/catalogLatestSamples';

const VERSIONS = ['v6', 'v6-wild', 'v6-mini'];
const BRAINS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna',
  'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5.1',
  'gemini-4-argon', 'gemini-3.8-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash',
  'qwen3.8-max-0902', 'qwen3.8-flash', 'qwen3.8-27b', 'qwen3.8-2.4t-a95b',
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
      if (sample.kind === 'chat') {
        const model = APIMART_TEXT_MODELS.find(row => row.modelKey === sample.modelKey);
        expect(model?.tokenPricing).toBeDefined();
      } else {
        const result = preview(sample.modelKey, sample.params);
        expect(result.built.body).toHaveProperty('model');
        expect(JSON.stringify(result.built.body)).not.toContain('{{');
      }
      return { status: 'succeeded' };
    });
    expect(results).toHaveLength(14);
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

describe('current brains and old catalog compatibility', () => {
  it.each(prices)('previews $modelKey using the real shared model call and parses the official Chat SSE shape', async expected => {
    const definition = APIMART_TEXT_MODELS.find(row => row.modelKey === expected.modelKey)!;
    expect(definition.tokenPricing).toEqual({ ...expected.tokenPricing, source: expected.source });
    const config = nomiModelConfigFor({ key: 'apimart', name: 'APIMart', enabled: true, authType: 'bearer', baseUrlHint: 'https://api.apimart.ai', createdAt: '', updatedAt: '' },
      { ...definition, vendorKey: 'apimart', kind: 'text', enabled: true, createdAt: '', updatedAt: '' }, 'fixture-only');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'chat-example', object: 'chat.completion.chunk', created: 0,
      model: expected.modelKey, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const result = await callModelOnce({ model: config, content: 'Reply OK.', maxRetries: 0, maxTokens: 128,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(chunk({ role: 'assistant', content: 'OK' }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } });
      } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://api.apimart.ai/v1/chat/completions');
    expect(requests[0]!.body).toMatchObject({ model: expected.modelKey, stream: true, messages: [{ role: 'user', content: 'Reply OK.' }] });
    expect(result.message.content).toContainEqual({ type: 'text', text: 'OK' });
    expect(result.pricingBasis).toBe('priced');
  });

  it('declares exactly the current candidates without adding MiMo or changing old identities', () => {
    for (const key of BRAINS) expect(APIMART_TEXT_MODELS.find(row => row.modelKey === key), key).toBeDefined();
    expect(APIMART_TEXT_MODELS.some(row => row.modelKey.startsWith('mimo-'))).toBe(false);
    for (const key of ['deepseek-v4-flash', 'gemini-3.5-flash', 'deepseek-v3.1-terminus']) {
      expect(APIMART_TEXT_MODELS.find(row => row.modelKey === key)).toBeDefined();
    }
  });

  it('reconciles real release-written data while retaining every saved identity and executable audio mapping', () => {
    const root = new URL('../../tests/fixtures/old-user-data/curated/v0.24.1-apimart/', import.meta.url);
    const original = JSON.parse(fs.readFileSync(new URL('model-catalog.json', root), 'utf8')) as CatalogState;
    const before = structuredClone(original);
    const { state } = applyBuiltinSeeds(original, '2026-11-07');
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
