import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeTurnHooks, RuntimeTurnRequest, RuntimeTurnResult } from '../harness/runtime/runtimePort';
import { parseVendorErrorFromMessage } from '../../src/workbench/generationCanvas/runner/vendorErrorIpc';

const state = vi.hoisted(() => ({
  request: undefined as RuntimeTurnRequest | undefined,
  hooks: undefined as RuntimeTurnHooks | undefined,
  result: undefined as RuntimeTurnResult | undefined,
  choose: vi.fn(),
  run: vi.fn(),
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => process.cwd() } }));
vi.mock('./textBrainResolver', () => ({ chooseTextModel: state.choose }));
vi.mock('../memory/projectMemory', () => ({ getProjectMemory: () => ({ facts: [] }), formatMemoryForPrompt: () => 'project facts' }));
vi.mock('../skills/skillStore', () => ({ findSkillRecord: () => null }));
vi.mock('../assets/localAssetFile', () => ({ readNomiLocalAsset: () => ({ bytes: new Uint8Array([1, 2]) }) }));
vi.mock('../files/extractText', () => ({ extractTextFromLocalAsset: async () => 'actual document' }));
vi.mock('../harness/context/contextService', () => ({ createAgentContextService: () => ({ run: state.run }) }));

import { runAgentChatV2 as productionRunAgentChatV2 } from './agentChatV2';

// Invalid IPC-shaped objects deliberately exercise the main boundary's runtime validation.
const runAgentChatV2 = (payload: { prompt: string } & Record<string, unknown>, eventHooks: ReturnType<typeof hooks>) =>
  productionRunAgentChatV2(payload as unknown as Parameters<typeof productionRunAgentChatV2>[0], eventHooks);

function request(capability = 'canvas-chat') {
  return { prompt: 'current complete canvas', displayPrompt: 'short request',
    capability, history: { kind: 'persistent' as const, binding: { sessionKey: 'nomi:workbench:project:generation', threadId: 'thread-a' } },
    projectId: 'project', skillKey: 'workbench.creation.editor',
  };
}
const hooks = () => ({ emit: vi.fn(), awaitToolConfirmation: vi.fn(async () => ({ ok: true as const, result: { applied: true } })) });

beforeEach(() => {
  vi.clearAllMocks();
  state.request = undefined;
  state.hooks = undefined;
  state.result = { status: 'finished', text: 'actual', finishReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 3, cachedPromptTokens: 4, totalTokens: 15 },
    toolCalls: [], snapshot: 'PRIVATE SDK SNAPSHOT' };
  state.choose.mockReturnValue({ vendor: { key: 'vendor-a', authType: 'none', providerKind: 'openai-compatible', baseUrlHint: 'https://example.test/v1', meta: { extraHeaders: { 'X-Literal': '!do not execute ${TOKEN}' } } },
    model: { modelKey: 'gpt-4o', modelAlias: ' alias ', labelZh: 'Chosen', meta: { maxOutputTokens: 4096.9 } }, apiKey: '' });
  state.run.mockImplementation(async (_scope, prepare, runtimeHooks) => {
    state.request = await prepare(new AbortController().signal);
    state.hooks = runtimeHooks;
    return state.result;
  });
});

describe('Agent facade delegates exactly one turn to pi + bound context', () => {
  it.each([32_768, 262_144])('passes declared model context window %i independently from the output cap', async (contextWindow) => {
    const selected = state.choose.getMockImplementation()!();
    state.choose.mockReturnValue({ ...selected, model: { ...selected.model, meta: { contextWindow, maxOutputTokens: 2048 } } });
    await runAgentChatV2(request(), hooks());
    expect(state.request?.model).toMatchObject({ contextWindow, maxOutputTokens: 2048 });
  });

  it.each([undefined, null, '32768', true, false, Number.NaN, Infinity, -Infinity, 0, -1, 0.4, 32_768.5])(
    'omits invalid context-window metadata %s without changing the output cap', async (contextWindow) => {
      const selected = state.choose.getMockImplementation()!();
      state.choose.mockReturnValue({ ...selected, model: { ...selected.model, meta: { contextWindow, maxOutputTokens: 2048 } } });
      await runAgentChatV2(request(), hooks());
      expect(state.request?.model).not.toHaveProperty('contextWindow');
      expect(state.request?.model.maxOutputTokens).toBe(2048);
    },
  );

  it('leaves undeclared capacity and output caps absent for the runtime compatibility defaults', async () => {
    const selected = state.choose.getMockImplementation()!();
    state.choose.mockReturnValue({ ...selected, model: { ...selected.model, meta: undefined } });
    await runAgentChatV2(request(), hooks());
    expect(state.request?.model).not.toHaveProperty('contextWindow');
    expect(state.request?.model).not.toHaveProperty('maxOutputTokens');
  });

  it.each([undefined, '4096', true, Number.NaN, Infinity, 0, -1, 0.4])('does not coerce invalid model output-token metadata %s into a runtime limit', async (maxOutputTokens) => {
    const selected = state.choose.getMockImplementation()!();
    state.choose.mockReturnValue({ ...selected, model: { ...selected.model, meta: { contextWindow: 32_768, maxOutputTokens } } });
    await runAgentChatV2(request(), hooks());
    expect(state.request?.model.contextWindow).toBe(32_768);
    expect(state.request?.model).not.toHaveProperty('maxOutputTokens');
  });

  it.each([
    ['creation-editor', ['read_full_text', 'read_selection', 'insert_at_cursor', 'replace_selection', 'append_to_end', 'author_skill'], 8],
    ['creation-chat', ['read_full_text', 'read_selection', 'author_skill'], 8],
    ['canvas-chat', [], 8],
    ['canvas-refine', ['set_node_prompt'], 8],
    ['storyboard', ['read_canvas_state', 'propose_storyboard_plan'], 24],
    ['single-shot', [], 1],
  ] as const)('%s is an explicit capability independent of skill naming', async (capability, names, maxSteps) => {
    await runAgentChatV2({ ...request(capability), ...(capability === 'single-shot' ? { history: { kind: 'ephemeral' as const } } : {}), selectedNodeIds: ['selected-a'] }, hooks());
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.request?.tools.map((tool) => tool.name)).toEqual(names);
    expect(state.request?.capability.maxSteps).toBe(maxSteps);
  });

  it('canvas-agent gets all eleven canonical tools', async () => {
    await runAgentChatV2(request('canvas-agent'), hooks());
    expect(state.request?.tools).toHaveLength(11);
  });

  it('rejects missing capability, missing history and cross-project binding before model selection', async () => {
    await expect(runAgentChatV2({ ...request(), capability: undefined }, hooks())).rejects.toThrow(/capability/i);
    await expect(runAgentChatV2({ ...request(), history: undefined }, hooks())).rejects.toThrow(/history/i);
    await expect(runAgentChatV2({ ...request(), projectId: 'other' }, hooks())).rejects.toThrow(/project/i);
    expect(state.choose).not.toHaveBeenCalled();
  });

  it('preserves the structured credential failure from real model selection', async () => {
    const failure = Object.assign(new Error('Text model credential is locked'), {
      code: 'text_model_credential_locked' as const,
    });
    state.choose.mockImplementation(() => { throw failure; });
    await expect(runAgentChatV2(request(), hooks())).rejects.toBe(failure);
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.choose).toHaveBeenCalledTimes(1);
  });

  it('separates durable display/document text from current full context and preserves connection identity', async () => {
    await runAgentChatV2({ ...request(), agentModelKey: 'chosen-model', agentVendorKey: 'chosen-vendor', temperature: Number.NaN,
      attachments: [{ url: 'doc', contentType: 'text/plain', fileName: 'doc.txt', kind: 'file' as const }] }, hooks());
    expect(state.request?.user.durableText).toContain('short request');
    expect(state.request?.user.durableText).toContain('actual document');
    expect(state.request?.user.durableText).not.toContain('current complete canvas');
    expect(state.request?.user.currentContextText).toBe('current complete canvas');
    expect(state.request?.model).toMatchObject({ providerId: 'vendor-a', modelId: 'alias', authType: 'none', maxOutputTokens: 4096, temperature: 0.7,
      headers: { 'X-Literal': '!do not execute ${TOKEN}' } });
    expect(state.choose).toHaveBeenCalledWith('chosen-model', false, 'chosen-vendor');
  });

  it('rejects refine targets outside the immutable explicit selection without invoking the host', async () => {
    const host = hooks();
    await runAgentChatV2({ ...request('canvas-refine'), selectedNodeIds: ['selected-a'] }, host);
    const decision = await state.hooks?.awaitToolConfirmation({ toolCallId: 'one', toolName: 'set_node_prompt', args: { nodeId: 'other', prompt: 'x' } }, new AbortController().signal);
    expect(decision).toMatchObject({ ok: false, denied: true });
    expect(host.awaitToolConfirmation).not.toHaveBeenCalled();
  });

  it('returns real usage/status/tool decisions but never opaque snapshot or credentials', async () => {
    state.result = { ...state.result!, status: 'cancelled', finishReason: 'aborted', toolCalls: [{ toolCallId: 'call', toolName: 'read_canvas_state', args: {}, status: 'ok', result: { read: true }, decision: { ok: true, silent: true, result: { read: true } } }] };
    const result = await runAgentChatV2(request(), hooks());
    expect(result).toMatchObject({ status: 'cancelled', raw: { cancelled: true }, usage: state.result.usage, toolCalls: state.result.toolCalls });
    expect(result).not.toHaveProperty('snapshot');
    expect(result).not.toHaveProperty('model');
  });

  it('keeps actual consumption after an empty length diagnostic and does not reject a settled turn', async () => {
    state.result = { ...state.result!, text: '', finishReason: 'length' };
    const eventHooks = hooks();
    const result = await runAgentChatV2(request(), eventHooks);
    expect(result).toMatchObject({ status: 'error', usage: state.result.usage });
    expect(eventHooks.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('输出长度上限') }));
  });

  it.each([[401, 'auth'], [402, 'balance'], [429, 'quota'], [500, 'server']] as const)('maps actual pi HTTP %s facts into the existing vendor error contract and retains usage', async (status, category) => {
    state.result = { ...state.result!, status: 'error', finishReason: 'error', error: {
      kind: 'http', message: 'upstream failed', status, body: JSON.stringify({ error: { message: 'actual upstream reason' } }), url: 'https://fixture.invalid/v1/chat/completions',
    } };
    const eventHooks = hooks();
    const result = await runAgentChatV2(request(), eventHooks);
    const message = eventHooks.emit.mock.calls.find(([event]) => event.type === 'error')?.[0].message as string;
    expect(parseVendorErrorFromMessage(message)).toMatchObject({ category, httpStatus: status, vendorKey: 'vendor-a', upstreamMsg: 'actual upstream reason' });
    expect(result).toMatchObject({ status: 'error', text: 'actual', usage: state.result.usage });
    expect(result).not.toHaveProperty('snapshot');
  });
});
