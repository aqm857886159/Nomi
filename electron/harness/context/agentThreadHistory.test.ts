import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  RunAgentTurn,
  RuntimeSnapshotCodec,
  RuntimeTurnHooks,
  RuntimeTurnRequest,
  RuntimeTurnResult,
} from '../runtime/runtimePort';
import { createAgentContextService } from './contextService';
import { createAgentContextStore } from './contextStore';
import type { AgentContextScope } from './contextBinding';
import { createProjectAgentContextBinding } from '../../shared/contracts/projectAgentContextBinding';

/**
 * The lossless-history contract of a resident thread.
 *
 * Before this, the Host re-narrated prior turns into a Chinese prose blob
 * (`用户：…` / `Nomi：…`) and dropped every tool item, so a third turn could not
 * cite what the first turn actually read or changed. The thread's durable Pi
 * context is now the single carrier, and these tests pin what it must preserve.
 */

const PROJECT = Object.freeze({
  projectId: 'project-1',
  immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8',
  projectGeneration: 3,
});

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCall?: { id: string; name: string; args: unknown } }
  | { role: 'toolResult'; toolCallId: string; toolName: string; result: string };

const hooks: RuntimeTurnHooks = { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) };

const codec: RuntimeSnapshotCodec = {
  importLegacy: async (turns) => JSON.stringify(turns.map((turn) => ({ role: turn.role, text: turn.content }))),
  inspect: async (snapshot) => ({ retainedMessages: (JSON.parse(snapshot) as Message[]).length }),
};

/**
 * A stand-in for the version-locked Pi session: it restores whatever history the
 * caller handed it and exports the appended transcript. It never re-reads a
 * prose summary, which is exactly the property the Host now depends on.
 */
function transcriptRuntime(script: readonly (readonly Message[])[]): {
  run: RunAgentTurn;
  restored: (string | undefined)[];
} {
  const restored: (string | undefined)[] = [];
  let turn = 0;
  const run: RunAgentTurn = async (request: RuntimeTurnRequest): Promise<RuntimeTurnResult> => {
    restored[restored.length] = request.snapshot;
    const prior = request.snapshot ? (JSON.parse(request.snapshot) as Message[]) : [];
    const appended = [...prior, { role: 'user' as const, text: request.user.durableText }, ...script[turn]];
    turn += 1;
    return {
      status: 'finished', text: 'ok', finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 2 },
      toolCalls: [], snapshot: JSON.stringify(appended),
    };
  };
  return { run, restored };
}

describe('resident thread history is carried without loss', () => {
  let root: string;
  let file: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-thread-history-'));
    file = path.join(root, '.nomi', 'agent-thread-context-v1.json');
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const serviceFor = (run: RunAgentTurn) => createAgentContextService({
    store: createAgentContextStore({ resolveFile: () => file }), codec, runAgentTurn: run,
  });
  const paths = () => ({ cwd: path.join(root, 'work'), tempRoot: root, agentDir: path.join(root, 'agent') });
  const turnRequest = (text: string) => async () => ({
    ...paths(),
    model: { kind: 'anthropic' as const, providerId: 'p', modelId: 'm', baseURL: 'https://x.test', authType: 'none' as const },
    systemPrompt: 'Nomi', user: { durableText: text }, tools: [],
    capability: { maxSteps: 8 as const }, compaction: { enabled: true },
  });

  it("lets a third turn cite the first turn's tool call and result", async () => {
    const scope: AgentContextScope = {
      kind: 'persistent', binding: createProjectAgentContextBinding(PROJECT, 'thread-resident'),
    };
    const { run, restored } = transcriptRuntime([
      [
        { role: 'assistant', text: '读了时间轴', toolCall: { id: 'call-1', name: 'read_timeline', args: {} } },
        { role: 'toolResult', toolCallId: 'call-1', toolName: 'read_timeline', result: 'clip-7 是最长的一段 · 12.4s' },
      ],
      [{ role: 'assistant', text: '已删除 clip-7' }],
      [{ role: 'assistant', text: '已还原 clip-7' }],
    ]);
    const service = serviceFor(run);

    await service.run(scope, turnRequest('检查时间轴'), hooks);
    await service.run(scope, turnRequest('把刚才你说的最长那段删掉'), hooks);
    await service.run(scope, turnRequest('改回去'), hooks);

    expect(restored[0]).toBeUndefined();
    const third = JSON.parse(restored[2]!) as Message[];
    // The first turn's tool call and its result survive into the third turn's input.
    expect(third).toContainEqual({ role: 'toolResult', toolCallId: 'call-1', toolName: 'read_timeline', result: 'clip-7 是最长的一段 · 12.4s' });
    expect(third.some((m) => m.role === 'assistant' && m.toolCall?.name === 'read_timeline')).toBe(true);
    // Roles stay separate; nothing is flattened back into one prose blob.
    expect(third.filter((m) => m.role === 'user').map((m) => m.text))
      .toEqual(['检查时间轴', '把刚才你说的最长那段删掉']);
  });

  it('survives an app restart: a fresh store and service resume the same thread', async () => {
    const scope: AgentContextScope = {
      kind: 'persistent', binding: createProjectAgentContextBinding(PROJECT, 'thread-resident'),
    };
    const first = transcriptRuntime([[
      { role: 'assistant', text: '读了时间轴', toolCall: { id: 'call-1', name: 'read_timeline', args: {} } },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'read_timeline', result: 'clip-7 · 12.4s' },
    ]]);
    await serviceFor(first.run).run(scope, turnRequest('检查时间轴'), hooks);

    // A brand new process: new store, new service, only the on-disk record survives.
    const afterRestart = transcriptRuntime([[{ role: 'assistant', text: '已删除 clip-7' }]]);
    await serviceFor(afterRestart.run).run(scope, turnRequest('把最长那段删掉'), hooks);

    const resumed = JSON.parse(afterRestart.restored[0]!) as Message[];
    expect(resumed).toContainEqual({ role: 'toolResult', toolCallId: 'call-1', toolName: 'read_timeline', result: 'clip-7 · 12.4s' });
  });

  it('does not leak one thread of a project into another', async () => {
    const script = [[{ role: 'assistant' as const, text: 'ok' }]];
    const other = transcriptRuntime(script);
    await serviceFor(transcriptRuntime(script).run).run(
      { kind: 'persistent', binding: createProjectAgentContextBinding(PROJECT, 'thread-a') },
      turnRequest('第一条线程'), hooks,
    );
    await serviceFor(other.run).run(
      { kind: 'persistent', binding: createProjectAgentContextBinding(PROJECT, 'thread-b') },
      turnRequest('第二条线程'), hooks,
    );
    expect(other.restored[0]).toBeUndefined();
  });

  it('keeps an ephemeral scope stateless so single-shot work never inherits or writes a transcript', async () => {
    const script = [[{ role: 'assistant' as const, text: 'ok' }], [{ role: 'assistant' as const, text: 'ok' }]];
    const { run, restored } = transcriptRuntime(script);
    const service = serviceFor(run);
    await service.run({ kind: 'ephemeral' }, turnRequest('规划方向'), hooks);
    await service.run({ kind: 'ephemeral' }, turnRequest('评审图片'), hooks);
    expect(restored).toEqual([undefined, undefined]);
    expect(fs.existsSync(file)).toBe(false);
  });
});
