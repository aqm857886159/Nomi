import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createLaneCodingTools, loadPiCodingToolFactories } from '../../electron/agentLane/laneCodingTools.mjs';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'nomi-native-paths-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const skill = path.join(root, 'settings', 'skills', 'demo');
  const outside = path.join(root, 'outside');
  for (const dir of [project, skill, outside]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), 'trusted package fixture');
  await writeFile(path.join(outside, 'secret.txt'), 'outside canary');
  const tools = await createLaneCodingTools(Object.assign({
    projectDir: project,
    sandbox: { active: true, operations: { exec: async () => { throw new Error('bash not used'); } }, close: async () => undefined },
    bashTimeoutMs: 5_000, factories: await loadPiCodingToolFactories(),
  }, { trustedSkillRoots: [skill] }));
  const run = async (name: string, args: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name)!;
    return tool.execute('fixture', args as never, new AbortController().signal);
  };
  return { project, skill, outside, run };
}

test('installed Skill is readable, while write and edit remain project-only', async (t) => {
  const { project, skill, run } = await fixture(t);
  assert.match(JSON.stringify(await run('read', { path: path.join(skill, 'SKILL.md') })), /trusted package fixture/);
  await assert.rejects(run('write', { path: path.join(skill, 'SKILL.md'), content: 'changed' }));
  await assert.rejects(run('edit', { path: path.join(skill, 'SKILL.md'), oldText: 'trusted', newText: 'changed' }));
  await run('write', { path: path.join(project, 'nested', 'answer.txt'), content: 'project result' });
  assert.equal(await readFile(path.join(project, 'nested', 'answer.txt'), 'utf8'), 'project result');
});

test('project and Skill symlinks cannot read or write outside their respective roots', async (t) => {
  const { project, skill, outside, run } = await fixture(t);
  for (const dir of [project, skill]) {
    await symlink(outside, path.join(dir, 'escape'));
    await assert.rejects(run('read', { path: path.join(dir, 'escape', 'secret.txt') }));
    await assert.rejects(run('write', { path: path.join(dir, 'escape', 'new.txt'), content: 'escape' }));
  }
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'outside canary');
  await assert.rejects(readFile(path.join(outside, 'new.txt')), /ENOENT/);
});

test('Skill allowlist does not permit sibling packages, same prefixes or parent traversal', async (t) => {
  const { skill, run } = await fixture(t);
  const sibling = `${skill}-evil`;
  await mkdir(sibling);
  await writeFile(path.join(sibling, 'SKILL.md'), 'untrusted');
  await assert.rejects(run('read', { path: path.join(sibling, 'SKILL.md') }));
  await assert.rejects(run('read', { path: path.join(skill, '..', 'demo-evil', 'SKILL.md') }));
});

test('a trusted package root replaced by a symlink is rejected after assembly', async (t) => {
  const { skill, outside, run } = await fixture(t);
  await rename(skill, `${skill}-original`);
  await symlink(outside, skill);
  await assert.rejects(run('read', { path: path.join(skill, 'secret.txt') }));
});


test('native find rejects a glob that traverses above the permitted project', async (t) => {
  const { project, run } = await fixture(t);
  await assert.rejects(run('find', { path: project, pattern: '../outside/*.txt' }));
});

test('a dangling symlink cannot turn a permitted new file into an outside write', async (t) => {
  const { project, outside, run } = await fixture(t);
  const target = path.join(outside, 'not-created.txt');
  await symlink(target, path.join(project, 'dangling.txt'));
  await assert.rejects(run('write', { path: path.join(project, 'dangling.txt'), content: 'must not escape' }));
  await assert.rejects(readFile(target), /ENOENT/);
});
