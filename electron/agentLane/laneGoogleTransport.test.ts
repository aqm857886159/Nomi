import { createModels, type Context } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { createNomiProvider } from './laneModelProvider.mjs';
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig';
import { laneVendorFailureText } from '../shared/agentLane/laneAssistantFault';
import { parseVendorErrorFromMessage } from '../../src/workbench/generationCanvas/runner/vendorErrorIpc';
import { MAX_NATIVE_REQUEST_BYTES } from '../ai/nativeFilePayload';

const config = (extra: Partial<NomiModelConfig> = {}): NomiModelConfig => ({
  kind: 'google-generative-ai', providerId: 'relay', modelId: 'gemini-4-argon',
  baseURL: 'https://relay.invalid/custom/v1beta', authType: 'api-key', apiKey: 'test-google-key',
  headers: { 'X-Relay-Route': 'native', Authorization: 'Bearer relay-test-token' }, maxOutputTokens: 512, temperature: 0.4, ...extra,
} as NomiModelConfig);
const context = (): Context => ({ messages: [{ role: 'user', content: 'Describe the original media.', timestamp: 0 }], tools: [] });
const thoughtSignature = 'c2lnbmF0dXJlLW9yaWdpbmFs';
const sse = (parts: object[], finishReason = 'STOP') => new Response(`data: ${JSON.stringify({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 },
})}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
async function streamWith(fetch: typeof globalThis.fetch, ctx = context(), extra: Partial<NomiModelConfig> = {}) {
  const runtime = await createNomiProvider(config(extra), fetch);
  const models = createModels({ credentials: runtime.credentials });
  models.setProvider(runtime.provider);
  return { ...runtime, models, stream: models.streamSimple(runtime.model, ctx) };
}

describe('Google native transport uses the shared Nomi provider boundary', () => {
  it('sends the exact model and configured prefix through the injected fetch, with native options', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return sse([{ text: 'Original media received.' }]);
    };
    const { stream } = await streamWith(fetch);
    const result = await stream.result();
    expect(result.stopReason).toBe('stop');
    expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'Original media received.' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://relay.invalid/custom/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse');
    expect(calls[0].headers.get('x-relay-route')).toBe('native');
    expect(calls[0].headers.get('x-goog-api-key')).toBe('test-google-key');
    expect(calls[0].headers.get('authorization')).toBe('Bearer relay-test-token');
    expect(calls[0].body).toMatchObject({ generationConfig: { maxOutputTokens: 512, temperature: 0.4 } });
    expect(calls[0].body).not.toHaveProperty('max_tokens');
    expect(result.usage).toMatchObject({ input: 7, output: 3, totalTokens: 10 });
  });

  it('omits an unconfigured output limit and honors a per-call native output limit', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse([{ text: 'Ready.' }]);
    };
    const runtime = await createNomiProvider(config({ maxOutputTokens: undefined, temperature: undefined }), fetch);
    const models = createModels({ credentials: runtime.credentials });
    models.setProvider(runtime.provider);
    await models.streamSimple(runtime.model, context()).result();
    expect(bodies[0].generationConfig).not.toHaveProperty('maxOutputTokens');
    await models.streamSimple(runtime.model, context(), { maxTokens: 73 }).result();
    expect(bodies[1]).toMatchObject({ generationConfig: { maxOutputTokens: 73 } });
  });

  it('preserves gateway query parameters without letting the SDK append its endpoint into the query', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return sse([{ text: 'Routed.' }]);
    };
    const { stream } = await streamWith(fetch, context(), { baseURL: 'https://relay.invalid/prefix/v1beta?route=a&tag=one&tag=two' });
    expect((await stream.result()).stopReason).toBe('stop');
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/prefix/v1beta/models/gemini-4-argon:streamGenerateContent');
    expect(url.searchParams.get('alt')).toBe('sse');
    expect(url.searchParams.get('route')).toBe('a');
    expect(url.searchParams.getAll('tag')).toEqual(['one', 'two']);
  });

  it('rejects an oversized final SDK wire request before the configured transport is called', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => sse([{ text: 'Should not be dispatched.' }]));
    const { stream } = await streamWith(fetch, { messages: [{ role: 'user', content: 'x'.repeat(MAX_NATIVE_REQUEST_BYTES), timestamp: 0 }], tools: [] });
    expect((await stream.result()).stopReason).toBe('error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps native audio/video payload rewriting and tool continuation in the real SDK', async () => {
    const bodies: Array<{ contents: unknown[] }> = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? sse([{ functionCall: { name: 'read_asset', args: { id: 'original' } }, thoughtSignature }])
        : sse([{ text: 'Checked.' }]);
    };
    const ctx = context();
    ctx.tools = [{ name: 'read_asset', description: 'Read a selected original', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }];
    const runtime = await createNomiProvider(config(), fetch);
    const models = createModels({ credentials: runtime.credentials });
    models.setProvider(runtime.provider);
    const options = { onPayload: (payload: unknown) => {
      const p = payload as { contents: Array<{ parts: object[] }> };
      p.contents[0].parts.push({ inlineData: { mimeType: 'audio/wav', data: 'YXVkaW8=' } }, { inlineData: { mimeType: 'video/mp4', data: 'dmlkZW8=' } });
      return p;
    } };
    const first = await models.streamSimple(runtime.model, ctx, options).result();
    expect(first.stopReason).toBe('toolUse');
    const call = first.content.find(part => part.type === 'toolCall');
    expect(call).toMatchObject({ name: 'read_asset', arguments: { id: 'original' } });
    if (!call || call.type !== 'toolCall') throw new Error('Missing native tool call');
    ctx.messages.push(first, { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: 'Found' }], isError: false, timestamp: 1 });
    const second = await models.streamSimple(runtime.model, ctx, options).result();
    expect(second.stopReason).toBe('stop');
    expect(bodies[0].contents[0]).toMatchObject({ parts: expect.arrayContaining([
      { inlineData: { mimeType: 'audio/wav', data: 'YXVkaW8=' } },
      { inlineData: { mimeType: 'video/mp4', data: 'dmlkZW8=' } },
    ]) });
    expect(JSON.stringify(bodies[1].contents)).toContain(thoughtSignature);
    expect(JSON.stringify(bodies[1].contents)).toContain('functionResponse');
  });

  it('preserves the AbortSignal at the injected transport', async () => {
    let entered: (() => void) | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      entered?.();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      });
    };
    const runtime = await createNomiProvider(config(), fetch);
    const models = createModels({ credentials: runtime.credentials });
    models.setProvider(runtime.provider);
    const controller = new AbortController();
    const stream = models.streamSimple(runtime.model, context(), { signal: controller.signal });
    await started;
    controller.abort();
    expect((await stream.result()).stopReason).toBe('aborted');
  });

  it('uses the shared redacted failure diagnostic for provider HTTP errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ error: { code: 403, message: 'Rejected test-google-key', status: 'PERMISSION_DENIED' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
    const { stream } = await streamWith(fetch);
    const result = await stream.result();
    expect(result.stopReason).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(1);
    const diagnostic = laneVendorFailureText(result);
    expect(diagnostic).toBeTruthy();
    expect(JSON.stringify(parseVendorErrorFromMessage(diagnostic!))).not.toContain('test-google-key');
    expect(parseVendorErrorFromMessage(diagnostic!)).toMatchObject({ httpStatus: 403 });
  });
});
