import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { openLaneNativeDesktop } from '../../electron/agentLane/laneNativeDesktop.mjs';
import { createLaneFixture } from './laneFixture.mjs';
import type { SkillRecord } from '../../electron/skills/skillStore.js';

test('production native resources read installed Skill metadata without widening sandbox settings access', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const settingsRoot = await mkdtemp(path.join(tmpdir(), 'nomi-native-settings-'));
  t.after(() => rm(settingsRoot, { recursive: true, force: true }));
  const root = path.join(settingsRoot, 'skills', 'demo');
  await mkdir(root, { recursive: true });
  const filePath = path.join(root, 'SKILL.md');
  const body = '---\nname: fixture\ndescription: Temporary metadata fixture\n---\nNo user content.';
  await writeFile(filePath, body);
  const skill: SkillRecord = { name: 'fixture', directoryName: 'demo', filePath, description: 'Temporary metadata fixture', body,
    manifest: null, origin: 'user', audience: 'internal', packageVersion: 'nomi-skill-v1', contentHash: 'fixture' };
  const desktop = await openLaneNativeDesktop({ projectDir: fixture.projectDir, settingsRoot, skills: [skill] });
  t.after(() => desktop.close());
  assert.equal(desktop.skillIndex.current().entries.length, 1);
  assert.equal(desktop.tools.length, 9);
  const read = desktop.tools.find((tool) => tool.name === 'read')!;
  const content = await read.execute('skill', { path: filePath } as never, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  assert.match(JSON.stringify(content), /Temporary metadata fixture/);
  const write = desktop.tools.find((tool) => tool.name === 'write')!;
  await assert.rejects(write.execute('skill-write', { path: filePath, content: 'replace' } as never, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT));
  const { AgentHarness } = await import('@earendil-works/pi-agent-core');
  const { createModels } = await import('@earendil-works/pi-ai');
  const { createNomiProvider } = await import('../../electron/agentLane/laneModelProvider.mjs');
  const { openLaneSession } = await import('../../electron/agentLane/laneSession.mjs');
  const configured = await createNomiProvider(fixture.options.model, globalThis.fetch);
  const models = createModels({ credentials: configured.credentials });
  models.setProvider(configured.provider);
  const session = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' }, BACKGROUND_CONTEXT);
  const { harness } = await AgentHarness.create({ session: session.session, models, model: configured.model, tools: desktop.tools }, BACKGROUND_CONTEXT);
  fixture.after(async () => { await harness.close(BACKGROUND_CONTEXT); await session.release(BACKGROUND_CONTEXT); });
  desktop.bindActiveTools(await harness.lane('main', BACKGROUND_CONTEXT));
  await desktop.unlockCoding(BACKGROUND_CONTEXT);
  await assert.rejects(write.execute('authorized-skill-write', { path: filePath, content: 'replace' } as never,
    (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT));
  if (process.platform === 'darwin') {
    assert.equal(desktop.sandboxActive, true, desktop.sandboxInactiveReason);
    const bash = desktop.tools.find((tool) => tool.name === 'bash')!;
    const allowed = await bash.execute('bash-project', { command: 'echo native-sandbox-ok', timeout: 3 } as never,
      (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
    assert.match(JSON.stringify(allowed), /native-sandbox-ok/);
    const denied = await bash.execute('bash-skill', { command: `cat '${filePath}'`, timeout: 3 } as never,
      (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT).then(() => false, () => true);
    assert.equal(denied, true, 'The existing OS sandbox must still deny the settings root.');
  }
});

test('native desktop assembly failure releases its sandbox before returning the error', async (t) => {
  const fixture = await createLaneFixture(t, []);
  await assert.rejects(openLaneNativeDesktop({ projectDir: fixture.projectDir,
    settingsRoot: path.join(fixture.projectDir, 'settings'), skills: [],
    deferredGroups: [{ name: 'collision', toolNames: ['read'] }] }), /Duplicate deferred tool name/);
  // reset() closes proxy resources but deliberately retains the SDK's configuration object.
  assert.equal(SandboxManager.getProxyPort(), undefined);
});
