import { describe, expect, it, vi } from 'vitest';
import type { Model } from '../catalog/types';
import { NativeMediaInputError } from '../ai/nativeFilePayload';

const fixture = vi.hoisted(() => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4)]);
  return { wav, mp4, missing: new Set<string>(), reads: [] as string[] };
});

vi.mock('../assets/projectAssetStore', () => ({
  resolveProjectAgentAttachmentClaims: (_projectId: string, claims: ReadonlyArray<{ assetId: string }>) => claims.map(claim => {
    const audio = claim.assetId === 'audio';
    return { assetId: claim.assetId, version: 1, display: { url: `nomi-local://asset/native/${claim.assetId}`,
      fileName: audio ? 'voice.wav' : 'scene.mp4', contentType: audio ? 'audio/wav' : 'video/mp4', kind: 'file' } };
  }),
}));
vi.mock('../assets/localAssetFile', () => ({
  readNomiLocalAsset: (url: string) => {
    fixture.reads.push(url);
    return fixture.missing.has(url) ? null : { bytes: url.endsWith('/audio') ? fixture.wav : fixture.mp4 };
  },
}));

import { createDesktopLaneInput } from './laneDesktopInput';
import { callModelOnce } from './laneModelCall.mjs';
import { startTextUpstream, reply } from '../../tests/fixtures/textTasks/textUpstream';
import { configureLaneContextBudget } from './laneContextBudget.mjs';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';

function setup(supportsAudioInput = true, supportsVideoInput = true) {
  const model = { vendorKey: 'relay', modelKey: 'custom-omni', kind: 'text',
    meta: { supportsAudioInput, supportsVideoInput } } as Model;
  const context = { approvalPolicy: { mode: 'request' as const }, attachments: [{ assetId: 'audio', version: 1 }, { assetId: 'video', version: 1 }] };
  const input = createDesktopLaneInput({ projectId: 'native', capture: () => context,
    activate: () => undefined, prepare: async value => value, model: () => ({ model, kind: 'google-generative-ai' }) });
  const message = { role: 'nomi.input', content: 'Compare these originals', timestamp: 1, context } as const;
  return { input, context, message };
}

function googleMessage(content: Awaited<ReturnType<ReturnType<typeof createDesktopLaneInput>['providerContent']>>) {
  return { role: 'user', parts: typeof content === 'string' ? [{ text: content }] : content.map(part =>
    part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: part.mimeType, data: part.data } }) };
}

describe('Agent original media projection', () => {
  it('rejects lost bindings in one request but forgets intentionally removed history in the next projection', async () => {
    const { input, message } = setup();
    input.beginProjection?.();
    await input.providerContent(message);
    expect(() => input.rewritePayload({ contents: [{ role: 'user', parts: [{ text: 'Lost originals' }] }] }, 'google-generative-ai'))
      .toThrow(NativeMediaInputError);
    input.beginProjection?.();
    const empty = { contents: [{ role: 'user', parts: [{ text: 'No original in the selected context' }] }] };
    expect(input.rewritePayload(empty, 'google-generative-ai')).toEqual(empty);
  });
  it('pins canonical originals across actual compaction and rehydrates them after a lane restart', async () => {
    const { input, message, context } = setup();
    let beforeCompaction: (event: unknown, context: unknown) => Promise<unknown> = async () => undefined;
    const summaryRequests: unknown[] = [];
    const models = { completeSimple: async (_model: unknown, context: unknown) => {
      summaryRequests.push(context);
      return { role: 'assistant', content: [{ type: 'text', text: 'Summary of the textual conversation' }],
        api: 'openai-completions', provider: 'relay', model: 'summary', stopReason: 'stop', timestamp: 2,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    } };
    const settings = { enabled: true, reserveTokens: 1, keepRecentTokens: 1 };
    const harness = { getCompactionSettings: async () => settings, setCompactionSettings: async () => undefined,
      getRetryPolicy: async () => ({ maxRetries: 0 }), hooks: { on: (_name: string, callback: typeof beforeCompaction) => { beforeCompaction = callback; } } };
    await configureLaneContextBudget({ harness, models, model: { contextWindow: 128000, maxTokens: 1000 },
      context: BACKGROUND_CONTEXT, options: { input } } as never);
    const followup = { ...message, content: 'Continue', timestamp: 3, context: { approvalPolicy: context.approvalPolicy } };
    const result = await beforeCompaction({ preparation: { messagesToSummarize: [message], turnPrefixMessages: [],
      retainedTail: [message, followup], isSplitTurn: false, tokensBefore: 100, fileOps: { read: new Set(), edited: new Set(), written: new Set() }, settings } }, BACKGROUND_CONTEXT) as {
        compaction: { retainedTail: typeof message[]; summary: string };
      };
    expect(summaryRequests).toHaveLength(1);
    const summary = JSON.stringify(summaryRequests[0]);
    expect(summary).not.toContain('[nomi-native-file:');
    expect(summary).not.toContain(fixture.wav.toString('base64'));
    expect(result.compaction.retainedTail.filter(item => item.context.attachments?.length)).toHaveLength(1);
    expect(result.compaction.retainedTail.map(item => item.timestamp)).toEqual([1, 3]);
    const restored = setup().input;
    restored.activate(followup.context);
    const contents = await Promise.all(result.compaction.retainedTail.map(async item => googleMessage(await restored.providerContent(item))));
    const request = JSON.stringify(restored.rewritePayload({ contents }, 'google-generative-ai'));
    expect(request).toContain(fixture.wav.toString('base64'));
    expect(request).toContain(fixture.mp4.toString('base64'));
    expect(request).not.toContain('[nomi-native-file:');
  });
  it('injects original audio through the real OpenAI SDK request boundary', async () => {
    const server = await startTextUpstream('openai-compatible', () => reply.text('heard'));
    try {
      const { input, message } = setup(true, false);
      const onlyAudio = { ...message, context: { ...message.context, attachments: [{ assetId: 'audio', version: 1 }] } };
      const content = await input.providerContent(onlyAudio);
      const result = await callModelOnce({ model: { kind: 'openai-compatible', providerId: 'relay', modelId: 'custom-omni',
        baseURL: server.baseURL, authType: 'api-key', apiKey: 'fixture-key' }, fetch: globalThis.fetch,
      content, onPayload: (payload, api) => input.rewritePayload(payload, api), signal: new AbortController().signal });
      expect(result.message.stopReason).toBe('stop');
      const body = JSON.stringify(server.requests[0].body);
      expect(body).toContain(fixture.wav.toString('base64'));
      expect(body).toContain('input_audio');
      expect(body).not.toContain('[nomi-native-file:');
    } finally { await server.close(); }
  });
  it('keeps bytes out of persisted input and restores every original into the native request', async () => {
    const { input, message, context } = setup();
    input.activate(context);
    const content = await input.providerContent(message);
    const persisted = JSON.stringify(message);
    expect(persisted).not.toContain(fixture.wav.toString('base64'));
    expect(persisted).not.toContain(fixture.mp4.toString('base64'));
    const result = input.rewritePayload({ contents: [googleMessage(content)] }, 'google-generative-ai') as { contents: Array<{ parts: unknown[] }> };
    expect(result.contents[0].parts.slice(-2)).toEqual([
      { inlineData: { mimeType: 'audio/wav', data: fixture.wav.toString('base64') } },
      { inlineData: { mimeType: 'video/mp4', data: fixture.mp4.toString('base64') } },
    ]);
    expect(JSON.stringify(result)).not.toContain('[nomi-native-file:');
    expect(JSON.stringify(content)).not.toContain(fixture.wav.toString('base64'));
  });

  it('rebuilds original history on a follow-up instead of replacing it with a summary', async () => {
    const { input, message, context } = setup();
    await input.providerContent(message);
    const followup = { ...message, timestamp: 2, content: 'What happened after that?', context: { approvalPolicy: context.approvalPolicy } };
    input.activate(followup.context);
    const original = await input.providerContent(message);
    const question = await input.providerContent(followup, context);
    const result = input.rewritePayload({ contents: [googleMessage(original), { role: 'model', parts: [{ text: 'First answer' }] }, googleMessage(question)] }, 'google-generative-ai');
    const serialized = JSON.stringify(result);
    expect(serialized).toContain(fixture.wav.toString('base64'));
    expect(serialized).toContain(fixture.mp4.toString('base64'));
    expect(serialized).toContain('What happened after that?');
  });

  it('rejects unsupported native input instead of returning only the file names', async () => {
    const { input, message } = setup(false, true);
    await expect(input.providerContent(message)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('rejects a missing original and never claims it was read', async () => {
    const { input, message } = setup();
    fixture.missing.add('nomi-local://asset/native/audio');
    try { await expect(input.providerContent(message)).rejects.toBeInstanceOf(NativeMediaInputError); }
    finally { fixture.missing.clear(); }
  });
});
