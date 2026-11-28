import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { laneInputIntent } from '../../electron/agentLane/laneInputIntent.mjs';
import { openTempLaneSession } from './laneFixture.mjs';

function resolvedPackageVersion(specifier: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.resolve(specifier)));
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === specifier && pkg.version) return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`package.json not found for ${specifier}`);
    dir = parent;
  }
}

test('R01/R04 public fixed SDK exports, run metadata lifetime and consumed steer ancestry', async (t) => {
  assert.equal(resolvedPackageVersion('@earendil-works/pi-agent-core'), '1.7.0');
  assert.equal(resolvedPackageVersion('@earendil-works/pi-ai'), '1.7.0');
  assert.equal(resolvedPackageVersion('@earendil-works/pi-coding-agent'), '1.7.0');
  assert.equal(resolvedPackageVersion('@earendil-works/pi-schema'), '1.7.0');

  const session = await openTempLaneSession(t);
  const promptId = await session.appendMessage({ role: 'user', content: 'ORIGINAL_INTENT', timestamp: 1 });
  const runMeta = { sourceTipId: null, promptEntryIds: [promptId] };

  // Unconsumed queued steer is not persisted to SessionManager yet, so it is not part of current intent.
  const beforeSteer = laneInputIntent(session, runMeta, []);
  assert.match(beforeSteer.quote, /ORIGINAL_INTENT/);
  assert.doesNotMatch(beforeSteer.quote, /STEER_ONLY_THREE/);

  // Once consumed by Agent, steer is appended on the branch after `promptId` and enters current intent.
  await session.appendMessage({ role: 'user', content: 'STEER_ONLY_THREE', timestamp: 2 });
  const duringRun = laneInputIntent(session, runMeta, []);
  assert.match(duringRun.quote, /ORIGINAL_INTENT/);
  assert.match(duringRun.quote, /STEER_ONLY_THREE/);
  assert.deepEqual(runMeta.promptEntryIds, [promptId], 'steer does not mutate initial prompt IDs');

  // Completed operation clears activeRunMeta -> idle intent is empty.
  assert.deepEqual(laneInputIntent(session, undefined, []), { quote: '' });

  // Next operation starts from current tipId and only quotes its own input.
  const prevTip = session.getTipId();
  const nextPromptId = await session.appendMessage({ role: 'user', content: 'NEW_JOB', timestamp: 3 });
  const nextIntent = laneInputIntent(
    session,
    { sourceTipId: prevTip, promptEntryIds: [nextPromptId] },
    [],
  );
  assert.match(nextIntent.quote, /NEW_JOB/);
  assert.doesNotMatch(nextIntent.quote, /ORIGINAL_INTENT|STEER_ONLY_THREE/);
  assert.equal(nextIntent.input, undefined, 'plain new input does not inherit prepared context');
});

test('R05 SessionManager v3 branch navigation preserves exact ancestor ordering across tree jumps', async (t) => {
  const session = await openTempLaneSession(t);
  const first = await session.appendCustomEntry('fixture', { number: 1 });
  await session.appendCustomEntry('fixture', { number: 2 });
  session.branchTo(first);
  const third = await session.appendCustomEntry('fixture', { number: 3 });
  assert.deepEqual(
    session.findBranchEntries({ order: 'oldestFirst' }).map((e: { id: string }) => e.id),
    [first, third],
  );
});
