// Nested node:test process: deliberately fail before the explicit crash kill path.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLaneFixture } from './laneFixture.mjs';
import { spawnLaneCrashChild } from './laneCrashFixture.mjs';

test('injected assertion while the crash child is parked', async (t) => {
  const fixture = await createLaneFixture(t, [{ type: 'tool', calls: [
    { id: 'call-append', name: 'write_script', arguments: { where: 'end', content: 'unapproved' } },
  ] }]);
  const crash = spawnLaneCrashChild(fixture);
  await crash.sessionId;
  // This failing owner runs before child cleanup. It must not skip the other owners.
  fixture.after(() => { throw new Error('injected close failure'); });
  console.log(`FIXTURE_DIR=${fixture.projectDir}`);
  assert.fail('injected assertion before explicit child kill');
});
