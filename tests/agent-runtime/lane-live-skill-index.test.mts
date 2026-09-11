// 一条 lane 的技能索引是**活的**：会话中途导入的技能，下一个回合就在索引里、也读得到。
//
// 这一批断言钉的是三件「不报错、只会让用户以为坏了」的失败：
//   ① 索引停在开 lane 那一刻——用户刚导入的技能，模型说它不存在，要关掉项目重开（用户原话）；
//   ② 索引更新了、可信读根没跟上——提示词里写着那条技能的路径，模型 `read` 它却被判越界，
//      于是模型看得见却读不到，症状比①更难懂；
//   ③ 回合内改口——同一个回合里两次模型请求看到不同的技能集/语言，模型自相矛盾。
// 对偶的那一条同样要钉：**没变就不许重算**，否则每个回合都要付一次 pi 的 ESM 渲染。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createLaneSkillIndexSource } from '../../electron/agentLane/laneInstalledSkills.mjs';
import { createLaneCodingPaths } from '../../electron/agentLane/laneCodingPaths.mjs';
import { openLaneNativeDesktop } from '../../electron/agentLane/laneNativeDesktop.mjs';
import { createLaneFixture } from './laneFixture.mjs';
import type { SkillRecord } from '../../electron/skills/skillStore.js';

async function landSkill(root: string, name: string, extra: { scripts?: boolean; body?: string } = {}): Promise<SkillRecord> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  if (extra.scripts) await mkdir(path.join(dir, 'scripts'), { recursive: true });
  const body = extra.body ?? `---\nname: ${name}\ndescription: ${name} 的用途说明。\n---\n正文。`;
  const filePath = path.join(dir, 'SKILL.md');
  await writeFile(filePath, body);
  return { name, directoryName: name, filePath, description: `${name} 的用途说明。`, body,
    manifest: null, origin: 'user', audience: 'internal', packageVersion: 'nomi-skill-v1',
    contentHash: `hash-${name}-${body.length}` };
}

async function skillsRoot(t: { after(fn: () => unknown): void }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nomi-live-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('索引源：refresh 才换代，current() 在回合内不动；记录集没变就连渲染都不重跑', async (t) => {
  const root = await skillsRoot(t);
  const first = await landSkill(root, 'tone-guide');
  let records: SkillRecord[] = [first];
  let rendered = 0;
  const source = createLaneSkillIndexSource(() => records, {
    loadFormatter: async () => ({
      formatSkillsForPrompt: (skills) => { rendered += 1; return `<available_skills>${skills.map((s) => s.name).join(',')}</available_skills>`; },
    }),
  });

  assert.deepEqual(source.current().entries, [], 'refresh 之前是空的：开 lane 那一刻还没扫过盘');
  await source.refresh();
  assert.deepEqual(source.current().entries.map((entry) => entry.name), ['tone-guide']);
  assert.match(source.current().promptSection, /tone-guide/);
  assert.equal(rendered, 1);

  // 用户在会话中途导入第二个技能。**在下一次 refresh 之前，这个回合看到的还是旧的那一份。**
  records = [first, await landSkill(root, 'shuohao-storyboard')];
  assert.equal(source.current().entries.length, 1, '回合内不许改口');
  const before = source.current();
  await source.refresh();
  assert.deepEqual(source.current().entries.map((entry) => entry.name).sort(), ['shuohao-storyboard', 'tone-guide']);
  assert.notEqual(source.current(), before, '换代了就该是另一份');
  assert.equal(rendered, 2);

  // 没变的那一次：同一份对象原样回来，pi 的渲染一次都没多跑。
  const steady = source.current();
  await source.refresh();
  await source.refresh();
  assert.equal(source.current(), steady, '记录集没变就不该重算');
  assert.equal(rendered, 2);

  // 技能正文改了（contentHash 变）→ 必须重算：description 与「要不要 coding 工具」都可能跟着变。
  records = [{ ...records[0]!, contentHash: 'hash-tone-guide-changed' }, records[1]!];
  await source.refresh();
  assert.equal(rendered, 3);
});

test('索引源：第一个技能是半路导入的，渲染器那时才加载；扫描与校验之间被删掉的技能只是不在索引里', async (t) => {
  const root = await skillsRoot(t);
  let records: SkillRecord[] = [];
  let loaded = 0;
  const source = createLaneSkillIndexSource(() => records, {
    loadFormatter: async () => { loaded += 1; return { formatSkillsForPrompt: (skills) => skills.map((s) => s.name).join(',') }; },
  });
  await source.refresh();
  assert.equal(source.current().promptSection, '');
  assert.equal(loaded, 0, '一条没有技能的 lane 不该为了拿一个空串付一次 ESM 解析');

  records = [await landSkill(root, 'late-import')];
  await source.refresh();
  assert.equal(loaded, 1, '第一个技能半路进来时才加载渲染器');
  assert.equal(source.current().promptSection, 'late-import');

  // 用户在这一次扫描与校验之间把技能删了：它不在这一刻的索引里，但**不该让整个回合失败**。
  const ghost = await landSkill(root, 'ghost');
  records = [records[0]!, ghost];
  await rm(path.join(root, 'ghost'), { recursive: true, force: true });
  await source.refresh();
  assert.deepEqual(source.current().entries.map((entry) => entry.name), ['late-import']);
});

test('可信读根跟着索引源走：根变了，pin 过的那份不许留着', async (t) => {
  const root = await skillsRoot(t);
  const project = await mkdtemp(path.join(tmpdir(), 'nomi-live-project-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await landSkill(root, 'alpha');
  await landSkill(root, 'beta');
  let roots: readonly string[] = [path.join(root, 'alpha')];
  const paths = await createLaneCodingPaths(project, () => roots);

  await paths.readSkill(path.join(root, 'alpha', 'SKILL.md'));
  await assert.rejects(paths.readSkill(path.join(root, 'beta', 'SKILL.md')), /outside this project/);
  roots = [path.join(root, 'alpha'), path.join(root, 'beta')];
  await paths.readSkill(path.join(root, 'beta', 'SKILL.md'));
  // 写仍然只许在项目里，可信技能包是只读的——把根变活不许顺手放宽这条。
  await assert.rejects(paths.write(path.join(root, 'beta', 'SKILL.md')), /outside this project/);
  // 根消失了（用户删了技能）：它退出名单，而不是让之后每一次 read 都炸。
  await rm(path.join(root, 'beta'), { recursive: true, force: true });
  roots = [path.join(root, 'alpha')];
  await assert.rejects(paths.readSkill(path.join(root, 'beta', 'SKILL.md')), /outside this project/);
  await paths.readSkill(path.join(root, 'alpha', 'SKILL.md'));
});

test('根的集合是活的，但已经认下的那个根不许被重新解析成别处', async (t) => {
  const root = await skillsRoot(t);
  const project = await mkdtemp(path.join(tmpdir(), 'nomi-live-project-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const outside = await mkdtemp(path.join(tmpdir(), 'nomi-live-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'secret.txt'), '不该被读到');
  await landSkill(root, 'alpha');
  const alpha = path.join(root, 'alpha');
  const paths = await createLaneCodingPaths(project, () => [alpha]);
  await paths.readSkill(path.join(alpha, 'SKILL.md'));

  // 把一个**已经认下的**技能根换成指向别处的软链。集合没变，所以它不该被重新 canonicalize——
  // 否则「把根变活」就顺手把它变成了一块可以被换掉的可读区。
  await rm(alpha, { recursive: true, force: true });
  await symlink(outside, alpha);
  await assert.rejects(paths.readSkill(path.join(alpha, 'secret.txt')), /outside this project/);

  // 而**新**出现的根仍然进得来——且它自己就是软链时当场拒，不靠上游记得校验。
  const evil = path.join(root, 'evil');
  await symlink(outside, evil);
  await assert.rejects(createLaneCodingPaths(project, [evil]), /must not be symbolic links/);
});

test('原生装配：技能给函数时，会话中途导入的技能下一个回合既进索引也读得到', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const settingsRoot = await mkdtemp(path.join(tmpdir(), 'nomi-live-settings-'));
  t.after(() => rm(settingsRoot, { recursive: true, force: true }));
  const root = path.join(settingsRoot, 'skills');
  await mkdir(root, { recursive: true });
  let records: SkillRecord[] = [];
  const desktop = await openLaneNativeDesktop({ projectDir: fixture.projectDir, settingsRoot, skills: () => records });
  t.after(() => desktop.close());
  assert.deepEqual(desktop.skillIndex.current().entries, []);

  const read = desktop.tools.find((tool) => tool.name === 'read')!;
  const imported = await landSkill(root, 'mid-session');
  // 落盘了，但这条 lane 还没跨过回合边界：索引与可信根都还是上一份。
  assert.deepEqual(desktop.skillIndex.current().entries, []);
  await assert.rejects(read.execute('too-early', { path: imported.filePath } as never,
    (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT), /outside this project/);

  records = [imported];
  await desktop.skillIndex.refresh();
  assert.deepEqual(desktop.skillIndex.current().entries.map((entry) => entry.name), ['mid-session']);
  assert.match(desktop.skillIndex.current().promptSection, /mid-session/);
  const content = await read.execute('after-refresh', { path: imported.filePath } as never,
    (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  assert.match(JSON.stringify(content), /正文/, '看得见就必须读得到：索引与可信根同源');
});
