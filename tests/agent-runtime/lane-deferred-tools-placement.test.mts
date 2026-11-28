import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zstdDecompressSync } from 'node:zlib';
import {
  normalizeContext,
  type Api,
  type Context,
  type Model,
  type ProviderStreams,
  type Tool,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { createCodingTools, createReadOnlyTools } from '@earendil-works/pi-coding-agent';
import { LANE_MODEL_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { LANE_CODING_TOOL_NAMES } from '../../electron/agentLane/laneCodingTools.mjs';
import { laneToolMenu, LANE_TOOL_REQUEST_TOOL_NAME }
  from '../../electron/agentLane/laneToolGroups.mjs';
import { laneToolModelDescription } from '../../electron/shared/agentLane/laneToolContract.js';
import { toPublishedJsonSchema } from '../../electron/shared/agentCapabilities/modelVisibleJsonSchema.js';
import { createHttpFixture } from './httpFixture.mjs';

const TRANSPORTS: { api: Api; streams: ProviderStreams; compat: Model<Api>['compat'] }[] = [
  {
    api: 'anthropic-messages',
    streams: anthropicMessagesApi(),
    compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true, supportsCacheControlOnTools: true },
  },
  {
    api: 'openai-responses',
    streams: openAIResponsesApi(),
    compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true },
  },
  {
    api: 'openai-codex-responses',
    streams: openAICodexResponsesApi(),
    compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true },
  },
  { api: 'openai-completions', streams: openAICompletionsApi(), compat: {} },
];

// Synthetic, unsigned JWT ONLY for the local Codex serializer's account-id parser.
const CODEX_FIXTURE_TOKEN = `e30.${Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'pd1-loopback' },
})).toString('base64url')}.fixture`;

function toolsForMenu(): { locked: Tool[]; unlocked: Tool[]; added: Tool[] } {
  const catalog: Tool[] = LANE_MODEL_TOOL_CATALOG.map((tool) => ({
    name: tool.name, description: laneToolModelDescription(tool),
    parameters: toPublishedJsonSchema(tool.schema) as Tool['parameters'],
  }));
  const unlock: Tool = {
    name: LANE_TOOL_REQUEST_TOOL_NAME, description: 'Unlock the coding tool group.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as Tool['parameters'],
  };
  const byName = new Map([...catalog, unlock,
    ...createCodingTools('/pd1-fixture'), ...createReadOnlyTools('/pd1-fixture')]
    .map((tool) => [tool.name, tool]));
  const select = (unlocked: boolean): Tool[] => laneToolMenu({
    activeGroup: unlocked ? 'coding' : null,
  }).activeToolNames.map((name) => {
    const tool = byName.get(name);
    assert.ok(tool, `Missing real catalog/factory tool: ${name}`);
    return tool;
  });
  const locked = select(false);
  const unlocked = select(true);
  return { locked, unlocked, added: unlocked.slice(locked.length) };
}

type WireTool = { type?: string; name?: string; function?: { name: string }; defer_loading?: boolean; cache_control?: unknown };
function wireTools(body: Record<string, unknown>): WireTool[] {
  if (body.tools === undefined) return [];
  assert.ok(Array.isArray(body.tools), 'Request tools when present must be an array');
  return body.tools as WireTool[];
}
const names = (tools: WireTool[]) => tools.map((tool) => tool.name ?? tool.function?.name);

for (const transport of TRANSPORTS) {
  for (const arm of ['enabled', 'default', 'top-level-redeclaration'] as const) {
    test(`P-D1 ${transport.api} / ${arm}: locked → unlock → sticky third request`, async (t) => {
      const http = await createHttpFixture([
        { type: 'tool', calls: [{ id: 'unlock1', name: LANE_TOOL_REQUEST_TOOL_NAME, arguments: {} }] },
        { type: 'text', text: 'Ready.' },
        { type: 'text', text: 'Still ready.' },
      ]);
      t.after(http.close);
      const model: Model<Api> = {
        api: transport.api, provider: 'pd1-loopback', id: 'pd1-model', name: 'PD1 fixture',
        baseUrl: transport.api === 'anthropic-messages' ? http.baseURL.replace(/\/v1$/, '') : http.baseURL,
        reasoning: false, input: ['text'], contextWindow: 128_000, maxTokens: 64,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(arm === 'enabled' ? { compat: transport.compat } : {}),
      };
      const { locked, unlocked, added } = toolsForMenu();
      const addedNames = LANE_CODING_TOOL_NAMES.filter((name) => name !== 'read');
      assert.deepEqual(unlocked.slice(0, locked.length), locked);
      assert.deepEqual(added.map((tool) => tool.name), addedNames);
      const context: Context = {
        systemPrompt: 'P-D1 deterministic transport placement fixture.', tools: locked,
        messages: [{ role: 'user', content: 'Unlock coding.', timestamp: 1 }],
      };
      for (let turn = 1; turn <= 3; turn++) {
        const reply = await transport.streams.stream(model, normalizeContext(context), {
          apiKey: transport.api === 'openai-codex-responses' ? CODEX_FIXTURE_TOKEN : 'fixture-key',
          transport: 'sse', maxTokens: 64, cacheRetention: 'short', sessionId: 'pd1-loopback',
          signal: AbortSignal.timeout(10_000),
          fetch: async (input, init) => {
            const request = new Request(input, init);
            if (request.headers.get('content-encoding') !== 'zstd') return fetch(request);
            const headers = new Headers(request.headers);
            headers.delete('content-encoding');
            headers.delete('content-length');
            return fetch(request.url, { method: request.method, headers, signal: request.signal,
              body: zstdDecompressSync(Buffer.from(await request.arrayBuffer())).toString('utf8') });
          },
        }).result();
        assert.equal(reply.stopReason, turn === 1 ? 'toolUse' : 'stop', reply.errorMessage);
        context.messages.push(reply);
        if (turn === 1) {
          const call = reply.content.find((part) => part.type === 'toolCall');
          assert.ok(call?.type === 'toolCall');
          assert.equal(call.name, LANE_TOOL_REQUEST_TOOL_NAME);
          context.messages.push({
            role: 'toolResult', toolCallId: call.id, toolName: call.name,
            content: [{ type: 'text', text: 'Coding unlocked.' }], isError: false, timestamp: 2,
          });
          if (arm === 'top-level-redeclaration') {
            context.tools = unlocked;
          } else {
            context.messages.push({
              role: 'system', content: '', toolsAdded: added, timestamp: 2,
            });
          }
        } else if (turn === 2) {
          context.messages.push({ role: 'user', content: 'Keep the same tools.', timestamp: 3 });
        }
      }
      assert.equal(http.requests.length, 3, 'No retry or missing request may masquerade as stability');
      const [first, second, third] = http.requests.map((request) => request.body);
      const initial = wireTools(first);
      const expanded = wireTools(second);
      const nativeChanges = arm === 'enabled' && transport.api !== 'openai-completions';
      const responsesInPlace = nativeChanges && transport.api.endsWith('responses');

      assert.deepEqual(wireTools(third), expanded, 'Sticky unlock must not flip the third request menu');

      if (responsesInPlace) {
        assert.equal(initial.length, 0);
        assert.equal(expanded.length, 0);
        const firstAdditions = (first.input as Record<string, unknown>[]).filter((item) => item.type === 'additional_tools');
        const secondAdditions = (second.input as Record<string, unknown>[]).filter((item) => item.type === 'additional_tools');
        assert.equal(firstAdditions.length, 1);
        assert.deepEqual(names(wireTools(firstAdditions[0]!)), locked.map((tool) => tool.name));
        assert.equal(secondAdditions.length, 2);
        assert.deepEqual(names(wireTools(secondAdditions[1]!)), addedNames);
        assert.deepEqual((third.input as unknown[]).slice(0, (second.input as unknown[]).length), second.input);
        assert.equal(third.instructions, first.instructions);
      } else if (transport.api === 'anthropic-messages' && nativeChanges) {
        assert.deepEqual(names(initial.slice(0, locked.length)), locked.map((tool) => tool.name));
        assert.deepEqual(expanded, initial, 'Native Anthropic tool_addition keeps top-level tools byte-identical');
        const additions = JSON.stringify(second.messages).match(/"type":"tool_addition"/g) ?? [];
        assert.equal(additions.length, addedNames.length);
        assert.deepEqual(second.system, first.system);
      } else {
        assert.deepEqual(names(initial), locked.map((tool) => tool.name));
        assert.deepEqual(names(expanded), unlocked.map((tool) => tool.name));
        if (transport.api === 'anthropic-messages') {
          const definitions = (tools: WireTool[]) => tools.map(({ cache_control: _marker, ...tool }) => tool);
          assert.deepEqual(definitions(expanded.slice(0, initial.length)), definitions(initial));
          assert.deepEqual(second.system, first.system);
        } else {
          assert.deepEqual(expanded.slice(0, initial.length), initial, 'Full definitions, flags and order stay stable');
        }
      }
      t.diagnostic(JSON.stringify({ api: transport.api, arm, paidCalls: 0,
        catalogCount: LANE_MODEL_TOOL_CATALOG.length, unlockFixtureCount: 1,
        topLevelCounts: http.requests.map((request) => wireTools(request.body).length),
        toolArrayBytes: http.requests.map((request) => Buffer.byteLength(JSON.stringify(request.body.tools ?? []))),
      }));
    });
  }
}
