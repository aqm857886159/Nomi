import { describe, expect, it } from 'vitest';
import { callModelOnce } from './laneModelCall.mjs';
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig';
import { createModels } from '@earendil-works/pi-ai';
import { AgentHarness } from '@earendil-works/pi-agent-core';
import { MemorySessionRepo } from '@earendil-works/pi-agent-core/harness/session';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createNomiProvider } from './laneModelProvider.mjs';
import { bindNativeFile, rewriteNativeFilePayload } from '../ai/nativeFilePayload';

// Payload fixtures exercise byte preservation, not media quality or model understanding.
const audio = Buffer.from('RIFF\x24\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\0\0\0\0', 'binary').toString('base64');
const video = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex').toString('base64');
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
const model = (): NomiModelConfig => ({
  kind: 'google-generative-ai', providerId: 'native-input-test', modelId: 'gemini-4-argon',
  baseURL: 'https://relay.invalid/v1beta', authType: 'api-key', apiKey: 'test-only',
  inputModalities: ['text', 'image', 'audio', 'video'],
});

describe('native multimodal input through the production model-call and SDK boundary', () => {
  it('preserves mixed originals through actual AgentHarness hooks and a follow-up', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'received' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    };
    const runtime = await createNomiProvider(model(), fetch);
    const models = createModels({ credentials: runtime.credentials });
    models.setProvider(runtime.provider);
    const session = await new MemorySessionRepo().create({}, BACKGROUND_CONTEXT);
    const { harness } = await AgentHarness.create({ session, models, model: runtime.model, tools: [] }, BACKGROUND_CONTEXT);
    const originals = [bindNativeFile({ type: 'file', mimeType: 'audio/wav', fileName: 'original.wav', data: audio }),
      bindNativeFile({ type: 'file', mimeType: 'video/mp4', fileName: 'original.mp4', data: video })];
    harness.hooks.on('before_payload', event => ({ payload: rewriteNativeFilePayload(event.payload, event.model.api, originals).payload }));
    try {
      const lane = await harness.lane('main', BACKGROUND_CONTEXT);
      const first = await lane.prompt({ role: 'user', timestamp: 1, content: [{ type: 'text', text: 'Compare these originals.' }, { type: 'image', mimeType: 'image/png', data: image },
        ...originals.map(file => ({ type: 'text' as const, text: file.marker }))] }, BACKGROUND_CONTEXT);
      expect(first.ok).toBe(true);
      const second = await lane.prompt('Now explain the same originals again.', undefined, BACKGROUND_CONTEXT);
      expect(second.ok).toBe(true);
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        const serialized = JSON.stringify(body);
        expect(serialized).toContain(audio);
        expect(serialized).toContain(video);
        expect(serialized).toContain(image);
        expect(serialized).not.toContain('[nomi-native-file:');
      }
      expect(JSON.stringify(bodies[1])).toContain('Now explain the same originals again.');
    } finally { await harness.close(BACKGROUND_CONTEXT); }
  });

  it('sends original image, audio and video bytes in one native request', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'received' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    };
    const result = await callModelOnce({ model: model(), fetch, maxRetries: 0, content: [
      { type: 'text', text: 'Compare these original inputs.' },
      { type: 'image', mimeType: 'image/png', data: image },
      { type: 'file', mimeType: 'audio/wav', fileName: 'original.wav', data: audio },
      { type: 'file', mimeType: 'video/mp4', fileName: 'original.mp4', data: video },
    ] });
    expect(result.message.stopReason).toBe('stop');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://relay.invalid/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse');
    expect(calls[0].body).toMatchObject({ contents: [{ role: 'user', parts: expect.arrayContaining([
      { text: 'Compare these original inputs.' },
      { inlineData: { mimeType: 'image/png', data: image } },
      { inlineData: { mimeType: 'audio/wav', data: audio } },
      { inlineData: { mimeType: 'video/mp4', data: video } },
    ]) }] });
    expect(JSON.stringify(calls[0].body)).not.toContain('[nomi-native-file:');
  });

  it('refuses unsupported original media before any provider request', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error('must not call'); };
    await expect(callModelOnce({ model: { ...model(), inputModalities: ['text', 'image'] }, fetch,
      content: [{ type: 'file', mimeType: 'video/mp4', fileName: 'original.mp4', data: video }],
    })).rejects.toMatchObject({ name: 'NativeMediaInputError', code: 'unsupported' });
    expect(calls).toBe(0);
  });
});
