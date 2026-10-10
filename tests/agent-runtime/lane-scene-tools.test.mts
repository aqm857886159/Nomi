import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import { createLaneFixture } from './laneFixture.mjs';
import type { FixtureReply } from './httpFixture.mjs';

const policy = { mode: 'safe-auto' as const, spend: 'confirm' as const };
const PROBE = 'director_probe';

type ToolBody = { tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role: string; content?: unknown }> };
const toolNames = (body: unknown) => ((body as ToolBody).tools ?? []).map(tool => tool.function?.name);
const systemText = (body: unknown) => JSON.stringify(((body as ToolBody).messages ?? []).filter(message => message.role === 'system'));

/** One director-only tool next to the normal fixture tools. Execution is real (pi runs it); only its effect is a counter. */
async function openSceneLane(t: Parameters<typeof createLaneFixture>[0], replies: FixtureReply[]) {
  const fixture = await createLaneFixture(t, replies);
  let ran = 0;
  const base = fixture.options.tools[0];
  const probe = bindLaneTool({ ...base, name: PROBE, residentScene: 'director' }, async () => { ran += 1; return { ok: true, text: 'staged' }; });
  let captured: LaneComposerContext = { approvalPolicy: policy };
  const lane = await fixture.openLane({ ...fixture.options, tools: [...fixture.options.tools, probe],
    input: { capture: () => captured, activate: () => {}, providerContent: async message => message.content, rewritePayload: payload => payload } });
  return { fixture, lane, ran: () => ran, setDirectorOpen: (open: boolean) => { captured = { approvalPolicy: policy, ...(open ? { directorOpen: true as const } : {}) }; } };
}

test('a director-only tool is absent from the model tool list until the director is open, then leaves again', async t => {
  const { fixture, lane, setDirectorOpen } = await openSceneLane(t, [
    { type: 'text', text: 'closed' }, { type: 'text', text: 'open' }, { type: 'text', text: 'closed again' },
  ]);
  for (const open of [false, true, false]) {
    setDirectorOpen(open);
    await lane.execute({ kind: 'prompt', text: open ? 'Stage this shot.' : 'Hello.' });
  }
  const [closed, open, closedAgain] = fixture.http.requests.map(request => request.body);
  assert.ok(!toolNames(closed).includes(PROBE), 'not in the director: the tool is not in the list');
  assert.ok(toolNames(open).includes(PROBE), 'in the director: the tool is in the list');
  assert.ok(!toolNames(closedAgain).includes(PROBE), 'leaving the director removes it again');
  // The rest of the list does not move: only the scene tool joins / leaves.
  assert.deepEqual(toolNames(open).filter(name => name !== PROBE), toolNames(closed));
  assert.deepEqual(toolNames(closedAgain), toolNames(closed));
});

test('outside the director the model is told to ask the user to open it; inside it the notice is gone', async t => {
  const { fixture, lane, setDirectorOpen } = await openSceneLane(t, [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  setDirectorOpen(false);
  await lane.execute({ kind: 'prompt', text: 'Preview a push-in on shot 2.' });
  setDirectorOpen(true);
  await lane.execute({ kind: 'prompt', text: 'Preview a push-in on shot 2.' });
  const [closed, open] = fixture.http.requests.map(request => systemText(request.body));
  assert.match(closed, /Not available this turn: director_probe/);
  assert.match(closed, /open the 3D director/);
  assert.match(closed, /Never say or imply you did it/);
  assert.doesNotMatch(open, /Not available this turn/);
});

test('a call to a hidden scene tool is refused and does not run (visibility does not become authority either way)', async t => {
  const { fixture, lane, ran, setDirectorOpen } = await openSceneLane(t, [
    { type: 'tool', calls: [{ id: 'hidden-1', name: PROBE, arguments: {} }] }, { type: 'text', text: 'ok' },
    { type: 'tool', calls: [{ id: 'shown-1', name: PROBE, arguments: {} }] }, { type: 'text', text: 'ok' },
  ]);
  setDirectorOpen(false);
  await lane.execute({ kind: 'prompt', text: 'Stage it.' });
  assert.equal(ran(), 0, 'not in the director: the tool never ran');
  assert.ok(lane.projection().parts.some(part => part.kind === 'tool-result' && part.isError), 'the model gets an error result, not a success');
  setDirectorOpen(true);
  await lane.execute({ kind: 'prompt', text: 'Stage it again.' });
  assert.equal(ran(), 1, 'in the director: the same tool runs');
  assert.equal(fixture.http.requests.length, 4);
});

// Loopback prefix cache (NOT a provider number): a request "hits" only if tools + system equal the previous request's.
// Entering / leaving the director changes the prefix once; staying in either scene keeps it.
test('entering and leaving the director changes the prefix once each; staying put keeps it', async t => {
  const prefixes: string[] = [];
  const usageTable: Array<{ turn: string; cacheRead: number; cacheWrite: number }> = [];
  const labels = ['outside #1', 'outside #2', 'enter director', 'inside #2', 'leave director', 'outside #3'];
  const reply = (): FixtureReply => ({ type: 'deferred', beforeReply: async () => {
    const body = fixture.http.requests.at(-1)!.body;
    const prefix = JSON.stringify([(body as ToolBody).tools, systemText(body)]);
    const prefixTokens = Math.ceil(prefix.length / 4);
    const hit = prefixes.at(-1) === prefix;
    prefixes.push(prefix);
    const usage = hit ? { input: 20, output: 4, cacheRead: prefixTokens, cacheWrite: 0 } : { input: 20, output: 4, cacheRead: 0, cacheWrite: prefixTokens };
    usageTable.push({ turn: labels[prefixes.length - 1], cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite });
    return { type: 'text', text: 'ok', usage };
  } });
  const { fixture, lane, setDirectorOpen } = await openSceneLane(t, labels.map(reply));
  for (const [index, open] of [false, false, true, true, false, false].entries()) {
    setDirectorOpen(open);
    await lane.execute({ kind: 'prompt', text: `turn ${index}` });
  }
  assert.deepEqual(usageTable.map(row => row.cacheRead > 0), [false, true, false, true, false, true],
    'cold, warm, cold on entering, warm, cold on leaving, warm');
  t.diagnostic(`loopback simulated prefix cache: ${JSON.stringify(usageTable)}`);
});
