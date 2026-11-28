import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs';
import { createLaneFixture } from './laneFixture.mjs';

test('host close returns sandbox and session ownership when trace flush fails during close', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const lane = await openLane({ ...fixture.options,
    native: { settingsRoot: path.join(fixture.projectDir, 'fixture-settings'), skills: [] } });
  t.mock.method(SessionManager.prototype, 'getEntries', () => {
    throw new Error('fixture_session_close_failure');
  });
  try {
    await assert.rejects(lane.close(), /fixture_session_close_failure/);
    assert.equal(SandboxManager.getProxyPort(), undefined, 'The sandbox proxy is closed after the close failure.');
  } finally {
    t.mock.restoreAll();
    await SandboxManager.reset();
  }
  const reopened = await openLaneHistory({ projectDir: fixture.projectDir });
  await reopened.close();
});

test('history close releases single-owner lock so the conversation can be reopened', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const lane = await openLaneHistory({ projectDir: fixture.projectDir });
  await lane.close();
  const reopened = await openLaneHistory({ projectDir: fixture.projectDir });
  await reopened.close();
});

test('history construction failure still releases its single-owner lock', async (t) => {
  const fixture = await createLaneFixture(t, []);
  t.mock.method(SessionManager.prototype, 'getLeafId', () => {
    throw new Error('fixture_history_failure');
  });
  try {
    await assert.rejects(openLaneHistory({ projectDir: fixture.projectDir }), /fixture_history_failure/);
  } finally {
    t.mock.restoreAll();
  }
  const reopened = await openLaneHistory({ projectDir: fixture.projectDir });
  await reopened.close();
});
