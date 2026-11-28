import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { openLaneNativeDesktop } from '../../electron/agentLane/laneNativeDesktop.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
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
  const skill: SkillRecord = { name: 'fixture', directoryName: 'demo', filePath, packageDir: root, description: 'Temporary metadata fixture', body,
    content: 'No user content.', manifest: null, origin: 'user', audience: 'internal', packageVersion: 'nomi-skill-v1', contentHash: 'fixture', requiresCodingTools: false };
  const desktop = await openLaneNativeDesktop({ projectDir: fixture.projectDir, settingsRoot, skills: [skill] });
  t.after(() => desktop.close());
  assert.equal(desktop.skillIndex.current().entries.length, 1);
  assert.equal(desktop.tools.length, process.platform === 'win32' ? 10 : 9);
  const read = desktop.tools.find((tool) => tool.name === 'read')!;
  const content = await read.execute('skill', { path: filePath } as never);
  assert.match(JSON.stringify(content), /Temporary metadata fixture/);
  const write = desktop.tools.find((tool) => tool.name === 'write')!;
  await assert.rejects(write.execute('skill-write', { path: filePath, content: 'replace' } as never));
  const session = await openLaneSession({ projectDir: fixture.projectDir, laneName: 'main' });
  fixture.after(async () => { await session.release(); });
  desktop.bindActiveTools(session.session);
  await desktop.unlockCoding();
  await assert.rejects(write.execute('authorized-skill-write', { path: filePath, content: 'replace' } as never));
  if (process.platform === 'darwin') {
    assert.equal(desktop.sandboxActive, true, desktop.sandboxInactive?.detail);
    const bash = desktop.tools.find((tool) => tool.name === 'bash')!;
    const allowed = await bash.execute('bash-project', { command: 'echo native-sandbox-ok', timeout: 3 } as never);
    assert.match(JSON.stringify(allowed), /native-sandbox-ok/);
    const denied = await bash.execute('bash-skill', { command: `cat '${filePath}'`, timeout: 3 } as never)
      .then((res) => (res as { isError?: boolean }).isError === true, () => true);
    assert.equal(denied, true, 'The existing OS sandbox must still deny the settings root.');
  }
});

test('Windows platform assembly wires pi 1.7.0 PowerShell tool alongside bash and requires confirmation outside sandbox', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const settingsRoot = await mkdtemp(path.join(tmpdir(), 'nomi-win32-settings-'));
  t.after(() => rm(settingsRoot, { recursive: true, force: true }));
  const desktop = await openLaneNativeDesktop({
    projectDir: fixture.projectDir,
    settingsRoot,
    skills: [],
    platform: 'win32',
  });
  t.after(() => desktop.close());
  assert.equal(desktop.tools.length, 10);
  assert.ok(desktop.tools.some((tool) => tool.name === 'powershell'));
  assert.ok(desktop.promptSections.snippets.some((line) => line.startsWith('powershell:')));
  const psApproval = desktop.resolveApprovalSubject({
    toolName: 'powershell',
    args: { command: 'Get-ChildItem' },
  });
  assert.ok(psApproval);
  assert.equal(psApproval.forceConfirmation, true, 'PowerShell bypasses Anthropic bash sandbox and must require user confirmation.');
});

test('native desktop assembly failure releases its sandbox before returning the error', async (t) => {
  const fixture = await createLaneFixture(t, []);
  await assert.rejects(openLaneNativeDesktop({ projectDir: fixture.projectDir,
    settingsRoot: path.join(fixture.projectDir, 'settings'), skills: [],
    deferredGroups: [{ name: 'collision', toolNames: ['read'] }] }), /Duplicate deferred tool name/);
  assert.equal(SandboxManager.getProxyPort(), undefined);
});
