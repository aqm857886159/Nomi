// 技能加载迁到 pi 之后的**逐条对照**（`docs/plan/2026-09-18-skill-loading-migration.md` §2）。
//
// 每条断言的编号 S<n> 对应那份清单里的一行：清单上判为「pi 已覆盖」或「我们薄薄保留」的条目，
// 这里都要有一条会红的断言——没变成断言的清单条目，等于没对照过（2026-09-18 结构评审的结论：
// 958 个声明过的不变量因为没人核，等于不存在）。用户原话：「注意防止我们原本的那个地方可能有一些发现的问题，
// 防止新架构复发，可以之后对照一下。」
//
// 跑的是真的 pi 加载器（`loadSourcedSkills`）、真的盘、真的 `read` 工具与可信读根；只有远端模型是假的。
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { formatSkillInvocation, type Skill } from '@earendil-works/pi-agent-core';

import { createLaneCodingPaths } from '../../electron/agentLane/laneCodingPaths.mjs';
import { openLaneNativeDesktop } from '../../electron/agentLane/laneNativeDesktop.mjs';
import {
  createLaneSkillIndexSource,
  discoverSkillRecords,
  isLooseSkillFile,
  laneSkillRequiresCodingTools,
  loadPiSkillFormatter,
  renderLaneSkillSection,
  toLaneSkillIndexEntry,
  toPiSkills,
} from '../../electron/agentLane/laneSkillCatalog.mjs';
import { renderSelectedSkillPrompt } from '../../electron/agentLane/laneSkillPrompt.mjs';
import {
  SELECTED_SKILL_FRAMING, SKILL_TOOL_AUTHORITY_PLACEMENT, SKILL_TOOL_AUTHORITY_SECTION,
} from '../../electron/shared/agentLane/skillPromptPlacement.js';
import { CAPABILITY_ALIAS_ENTRIES } from '../../electron/shared/agentCapabilities/registry.js';
import { projectSkillsForRenderer } from '../../electron/skills/skillIpc.js';
import { computeSkillContentHash, exportSkillPackageByName, readSkillPackageFiles, SKILL_PACKAGE_VERSION, validateSkillPackage, writeSkillImport } from '../../electron/skills/skillPackage.js';
import { readSkillManifest } from '../../electron/skills/skillManifestSchema.js';
import { parseSkillFrontmatter } from '../../electron/skills/skillFrontmatter.js';
import { deriveSkillNeeds } from '../../electron/skills/skillCapability.js';
import {
  getSkillDiscoveryRoots, listSkillSummariesForMcp, readSkillContentForMcp, type SkillRecord,
} from '../../electron/skills/skillStore.js';
import { createLaneFixture } from './laneFixture.mjs';

const repoRoot = process.cwd();
const REPO_SKILLS = path.join(repoRoot, 'skills');
const CHATCUT_FIXTURE = path.join(repoRoot, 'tests/fixtures/skills/chatcut-video-gen');

async function tempRoot(t: { after(fn: () => unknown): void }, prefix = 'nomi-skill-catalog-'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function landSkill(root: string, dir: string, body: string, extra: { scripts?: boolean; references?: boolean } = {}): Promise<string> {
  const skillDir = path.join(root, dir);
  await mkdir(skillDir, { recursive: true });
  if (extra.scripts) await mkdir(path.join(skillDir, 'scripts'), { recursive: true });
  if (extra.references) { await mkdir(path.join(skillDir, 'references'), { recursive: true }); await writeFile(path.join(skillDir, 'references/notes.md'), '附件正文'); }
  const filePath = path.join(skillDir, 'SKILL.md');
  await writeFile(filePath, body);
  return filePath;
}

const skillMd = (name: string, description = `${name} 的用途说明。`, body = '正文。') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;

// ─────────────────────────────────────────────────────────────────────────────
// 能力回归 ①：`my-skill.md` 形式分发的技能（S1 / S36 / S40 / S18 / S21）
// ─────────────────────────────────────────────────────────────────────────────

test('S1 · 根目录下的 my-skill.md 是技能：进目录、进 lane 索引、read 读得到、能进提示词（迁移前：不在目录里，而 lane 对这种路径直接抛）', async (t) => {
  const root = await tempRoot(t);
  const loosePath = path.join(root, 'my-skill.md');
  await writeFile(loosePath, skillMd('my-skill', '一个以单文件分发的技能。', '# 方法\n先定调子再定镜头。'));
  await landSkill(root, 'packaged', skillMd('packaged'));

  const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.deepEqual(records.map((record) => record.directoryName).sort(), ['my-skill', 'packaged']);
  const loose = records.find((record) => record.directoryName === 'my-skill')!;
  assert.equal(loose.filePath, loosePath);
  assert.equal(loose.packageDir, root, '单文件技能的包根就是它所在的技能根');
  assert.equal(loose.name, 'my-skill');
  assert.equal(loose.description, '一个以单文件分发的技能。');
  assert.equal(loose.content, '# 方法\n先定调子再定镜头。', 'content 来自 pi：已去 frontmatter');
  assert.ok(isLooseSkillFile(loose.filePath));
  assert.equal(diagnostics.filter((d) => d.code !== 'invalid_metadata').length, 0, JSON.stringify(diagnostics));

  // S36：索引里每条 filePath 都是绝对路径（pi 的 NodeExecutionEnv 出的是绝对路径）。
  for (const record of records) assert.ok(path.isAbsolute(record.filePath), record.filePath);

  // S18：它的描述进渲染层 DTO，不是「暂无说明」。
  const dto = projectSkillsForRenderer(records).find((item) => item.directoryName === 'my-skill')!;
  assert.equal(dto.description, '一个以单文件分发的技能。');

  // S21：单文件技能的包 = 那一个文件，以 SKILL.md 为键呈现；MCP 读回来的就是它，内容寻址仍成立。
  assert.equal(loose.contentHash, computeSkillContentHash({ 'SKILL.md': await readFile(loosePath, 'utf8') }));
  assert.deepEqual(listSkillSummariesForMcp('local-authenticated', records).find((s) => s.directoryName === 'my-skill')?.filePaths, ['SKILL.md']);
  assert.match(readSkillContentForMcp('my-skill', 'local-authenticated', records, { packageVersion: loose.packageVersion, contentHash: loose.contentHash })?.body ?? '', /先定调子再定镜头/);
  // 导出去就是标准的 <dir>/SKILL.md 包（外部宿主只看见一种形状）。
  const exported = exportSkillPackageByName('my-skill', 0, records);
  assert.equal(exported?.files['SKILL.md'], await readFile(loosePath, 'utf8'));

  // S40：lane 索引与可信读根同源——看得见就读得到。
  const source = createLaneSkillIndexSource(() => records);
  const index = await source.refresh();
  assert.ok(index.entries.some((entry) => entry.name === 'my-skill'));
  assert.match(index.promptSection, /<location>[^<]*my-skill\.md<\/location>/);
  assert.ok(index.trustedSkillRoots.includes(root));
  const project = await tempRoot(t, 'nomi-skill-project-');
  const paths = await createLaneCodingPaths(project, () => index.trustedSkillRoots);
  await paths.readSkill(loosePath);

  // 选中它进提示词：pi 的信封，正文一个字不少。
  const prompt = renderSelectedSkillPrompt(loose);
  assert.ok(prompt.includes(`<skill name="my-skill" location="${loosePath}">`));
  assert.ok(prompt.includes('先定调子再定镜头。'));
});

test('S1 · 原生装配：单文件技能能被 lane 的 read 工具真的读到（迁移前 laneInstalledSkills 对它抛「require an absolute SKILL.md path」）', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const settingsRoot = await tempRoot(t, 'nomi-skill-settings-');
  const root = path.join(settingsRoot, 'skills');
  await mkdir(root, { recursive: true });
  const loosePath = path.join(root, 'loose-skill.md');
  await writeFile(loosePath, skillMd('loose-skill', '单文件技能。', '单文件正文。'));
  const records = (await discoverSkillRecords([{ path: root, origin: 'user' }])).records;
  const desktop = await openLaneNativeDesktop({ projectDir: fixture.projectDir, settingsRoot, skills: () => records });
  t.after(() => desktop.close());
  assert.deepEqual(desktop.skillIndex.current().entries.map((entry) => entry.name), ['loose-skill']);
  const read = desktop.tools.find((tool) => tool.name === 'read')!;
  const content = await read.execute('loose', { path: loosePath } as never, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT);
  assert.match(JSON.stringify(content), /单文件正文/, '看得见就必须读得到');
});

// ─────────────────────────────────────────────────────────────────────────────
// 能力回归 ②：真实第三方技能（S31 / S55）
// ─────────────────────────────────────────────────────────────────────────────

test('S31 · 本机真实的 ChatCut 技能装得进来：name 不等于目录只是 warning，未知键放行，正文原样', async (t) => {
  assert.ok(fs.existsSync(path.join(CHATCUT_FIXTURE, 'SKILL.md')), '夹具在 tests/fixtures/skills/chatcut-video-gen（逐字拷自 ~/.claude/skills）');
  const root = await tempRoot(t);
  await cp(CHATCUT_FIXTURE, path.join(root, 'chatcut-video-gen'), { recursive: true });
  const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.equal(records.length, 1, JSON.stringify(diagnostics));
  const [record] = records;
  // 前提：它点名的工具 Nomi 一个都没有——否则这条测试证明不了「装得进来」有意义。
  const ours = new Set(CAPABILITY_ALIAS_ENTRIES.map((entry) => entry.alias));
  for (const foreign of ['submit_video', 'track_progress', 'browse_assets']) {
    assert.ok(record.body.includes(foreign), `夹具该点名 ${foreign}`);
    assert.equal(ours.has(foreign), false, `${foreign} 不该是 Nomi 的工具`);
  }
  assert.equal(record.name, 'video-gen', 'name 来自 frontmatter，不被目录名覆盖');
  assert.equal(record.directoryName, 'chatcut-video-gen');
  // pi 对「name 与目录不一致」只发 invalid_metadata warning，技能照常加载（零拦截）。
  assert.ok(diagnostics.some((d) => d.code === 'invalid_metadata' && /does not match parent directory/.test(d.message)), JSON.stringify(diagnostics));
  assert.equal(diagnostics.filter((d) => d.type !== 'warning').length, 0, '没有 error 档：warning 不失败');
  assert.equal(record.manifest, null, '它没有 metadata.nomi，纯知识层技能就该这样进来');
  assert.equal(record.manifestError, undefined);
  // 包导入那条路也照收。
  assert.equal(validateSkillPackage({ version: SKILL_PACKAGE_VERSION, dirName: 'chatcut-video-gen', files: { 'SKILL.md': record.body } }).ok, true);
  // references/ 一并进包与内容寻址。
  assert.ok(listSkillSummariesForMcp('local-authenticated', records)[0]!.filePaths.includes('references/kling.md'));
});

test('S55 · 真实 ChatCut 技能的提示词：正文原样、权威节在正文之后、语气是能力清单不是报错', async (t) => {
  const root = await tempRoot(t);
  await cp(CHATCUT_FIXTURE, path.join(root, 'chatcut-video-gen'), { recursive: true });
  const [record] = (await discoverSkillRecords([{ path: root, origin: 'user' }])).records;
  const prompt = renderSelectedSkillPrompt(record!);
  for (const foreign of ['submit_video', 'track_progress', 'browse_assets']) assert.ok(prompt.includes(foreign), `正文里的 ${foreign} 该原样在`);
  assert.ok(prompt.indexOf('关于工具，一律以本条提示词里的') > prompt.indexOf('</skill>'), '权威节在正文之后：真相靠 recency 压住');
  assert.ok(prompt.includes('你**实际拥有**的全部工具'));
  assert.ok(prompt.includes('不是错误'));
  assert.ok(prompt.includes('挑能做成的那个用'));
  assert.ok(prompt.includes('把其余步骤照常做完'));
  assert.doesNotMatch(prompt, /技能.*(写错|不合法|无效|不支持)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 发现与解析（S2 S3 S4 S10 S11 S12 S37 S38 S39 S42）
// ─────────────────────────────────────────────────────────────────────────────

test('S3/S6 · 仓内 93 个内置技能经 pi 加载：93 条、零 pi 诊断——判官与被判的是同一把尺子', async () => {
  const { records, diagnostics } = await discoverSkillRecords([{ path: REPO_SKILLS, origin: 'builtin' }]);
  assert.equal(records.length, 93); // 2026-10-04 +director-3dbox（带 requires-flag，开关关时不可选，但文件在仓内）；2026-10-05 +4 条效果（多机位九宫格 / 下一刻 / 前一刻 / 剧情四宫格）
  assert.deepEqual(diagnostics, []);
  for (const record of records) {
    assert.equal(record.origin, 'builtin');
    assert.equal(record.name, record.directoryName, `${record.directoryName}: 规范要求 name 等于目录名`);
    assert.ok(record.content.length > 0 && !record.content.startsWith('---'), `${record.directoryName}: content 已去 frontmatter`);
    assert.ok(record.body.startsWith('---'), `${record.directoryName}: body 是整份原文`);
  }
});

test('S2 · name / description 只从 frontmatter 来；目录包缺 name 回落目录名，单文件缺 name 回落文件名', async (t) => {
  const root = await tempRoot(t);
  await landSkill(root, 'no-name', '---\ndescription: 没有 name 的包\n---\n正文');
  await writeFile(path.join(root, 'loose-no-name.md'), '---\ndescription: 没有 name 的单文件\n---\n正文');
  await landSkill(root, 'renamed-dir', skillMd('declared-name', '声明的名字'));
  const { records } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  const byDir = new Map(records.map((record) => [record.directoryName, record]));
  assert.equal(byDir.get('no-name')?.name, 'no-name');
  assert.equal(byDir.get('loose-no-name')?.name, 'loose-no-name', 'pi 对单文件回落的是根目录名，那不是句柄');
  assert.equal(byDir.get('renamed-dir')?.name, 'declared-name');
  assert.equal(byDir.get('renamed-dir')?.description, '声明的名字');
});

test('S12 · 没有 description 不加载（pi 的准入条件）；正文为空但 frontmatter 全的照常加载', async (t) => {
  const root = await tempRoot(t);
  await landSkill(root, 'no-desc', '---\nname: no-desc\n---\n正文');
  await landSkill(root, 'empty-body', '---\nname: empty-body\ndescription: 只有清单\n---\n');
  const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.deepEqual(records.map((record) => record.directoryName), ['empty-body']);
  assert.ok(diagnostics.some((d) => d.code === 'invalid_metadata' && /description is required/.test(d.message)));
  assert.equal(records[0]!.content, '');
});

test('S4 · 坏的 metadata.nomi → manifest=null + manifestError（断能力，不放开全部工具）', async (t) => {
  const root = await tempRoot(t);
  await landSkill(root, 'bad-manifest', '---\nname: bad-manifest\ndescription: x\nmetadata:\n  nomi:\n    version: 1\n    tools: not-a-list\n---\n正文');
  const { records } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.manifest, null);
  assert.match(records[0]!.manifestError ?? '', /metadata\.nomi/);
});

test('S10 · 多根优先级：内置遮蔽同名用户技能，输家记 shadowed 诊断；大小写/NFC 同名视为同一个', async (t) => {
  const builtin = await tempRoot(t);
  const user = await tempRoot(t);
  await landSkill(builtin, 'shared', skillMd('shared', 'Builtin'));
  await landSkill(user, 'shared', skillMd('shared', 'User'));
  await landSkill(builtin, 'Café', skillMd('cafe', 'NFC composed'));
  await landSkill(user, 'café', skillMd('cafe', 'NFD decomposed'));
  const { records, diagnostics } = await discoverSkillRecords([{ path: builtin, origin: 'builtin' }, { path: user, origin: 'user' }]);
  const shared = records.filter((record) => record.directoryName === 'shared');
  assert.equal(shared.length, 1);
  assert.equal(shared[0]!.description, 'Builtin');
  assert.equal(shared[0]!.origin, 'builtin');
  assert.ok(diagnostics.some((d) => d.code === 'shadowed' && d.path === path.join(user, 'shared', 'SKILL.md')), JSON.stringify(diagnostics));
  assert.equal(records.filter((record) => record.name === 'cafe').length, 1, 'NFC 同名只留一个');
});

test('S11 · 无 Electron 的 Node 进程里根仍然有序：NOMI_SKILLS_DIR 在前、用户根在末', async (t) => {
  const custom = await tempRoot(t);
  const settings = await tempRoot(t);
  const previous = { skills: process.env.NOMI_SKILLS_DIR, settings: process.env.NOMI_SETTINGS_DIR };
  process.env.NOMI_SKILLS_DIR = custom;
  process.env.NOMI_SETTINGS_DIR = settings;
  t.after(() => {
    if (previous.skills === undefined) delete process.env.NOMI_SKILLS_DIR; else process.env.NOMI_SKILLS_DIR = previous.skills;
    if (previous.settings === undefined) delete process.env.NOMI_SETTINGS_DIR; else process.env.NOMI_SETTINGS_DIR = previous.settings;
  });
  const roots = getSkillDiscoveryRoots();
  assert.equal(roots[0]?.path, path.resolve(custom));
  assert.equal(roots[0]?.origin, 'builtin');
  assert.equal(roots.at(-1)?.path, path.join(path.resolve(settings), 'skills'));
  assert.equal(roots.at(-1)?.origin, 'user');
});

test('S37 · 一个读不了的技能只出 warning，其余照常加载——不让整条 lane 之后每个回合都失败', { skip: userInfo().username === 'root' ? 'root 读得了任何文件' : false }, async (t) => {
  const root = await tempRoot(t);
  const unreadable = await landSkill(root, 'unreadable', skillMd('unreadable'));
  await landSkill(root, 'fine', skillMd('fine'));
  await chmod(unreadable, 0o000);
  try {
    const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
    assert.deepEqual(records.map((record) => record.directoryName), ['fine']);
    assert.ok(diagnostics.some((d) => d.code === 'read_failed' && d.type === 'warning'), JSON.stringify(diagnostics));
  } finally {
    await chmod(unreadable, 0o644);
  }
});

test('S38/S39 · 软链的技能目录 / 软链的 SKILL.md 不进目录，各记一条诊断（pi 会跟着软链走，我们不许）', async (t) => {
  const root = await tempRoot(t);
  const outside = await tempRoot(t, 'nomi-skill-outside-');
  await landSkill(outside, 'evil', skillMd('evil', '在技能根之外'));
  await symlink(path.join(outside, 'evil'), path.join(root, 'evil'));
  await mkdir(path.join(root, 'hollow'));
  await symlink(path.join(outside, 'evil', 'SKILL.md'), path.join(root, 'hollow', 'SKILL.md'));
  await landSkill(root, 'honest', skillMd('honest'));
  const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.deepEqual(records.map((record) => record.directoryName), ['honest']);
  assert.equal(diagnostics.filter((d) => d.code === 'symlink').length, 2, JSON.stringify(diagnostics));
  // 可信读根里也没有它们：看不见的东西读不到。
  const index = await createLaneSkillIndexSource(() => records).refresh();
  assert.deepEqual(index.trustedSkillRoots, [path.join(root, 'honest')]);
});

test('S42 · 带 scripts/ 的技能 requiresCodingTools=true，是目录层算好的事实；只有知识区的为 false', async (t) => {
  const root = await tempRoot(t);
  await landSkill(root, 'with-scripts', skillMd('with-scripts'), { scripts: true });
  await landSkill(root, 'knowledge', skillMd('knowledge'), { references: true });
  await landSkill(root, 'declared', '---\nname: declared\ndescription: 声明 coding\ntools: [coding]\n---\n正文');
  const { records } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  const flag = Object.fromEntries(records.map((record) => [record.directoryName, record.requiresCodingTools]));
  assert.deepEqual(flag, { 'with-scripts': true, knowledge: false, declared: true });
  assert.equal(laneSkillRequiresCodingTools({ childDirectoryNames: ['BIN'] }), true, '大小写不该改变结论');
  assert.equal(laneSkillRequiresCodingTools({}), false);
});

test('S19 · 用户目录的技能声明 audience: mcp 仍是 internal；内置声明的才生效', async (t) => {
  const user = await tempRoot(t);
  const builtin = await tempRoot(t);
  const declared = '---\nname: NAME\ndescription: x\nmetadata:\n  nomi:\n    version: "1.0.0"\n    audience: mcp\n    tools: []\n    required-providers: []\n---\n正文';
  await landSkill(user, 'u-mcp', declared.replace('NAME', 'u-mcp'));
  await landSkill(builtin, 'b-mcp', declared.replace('NAME', 'b-mcp'));
  const { records } = await discoverSkillRecords([{ path: builtin, origin: 'builtin' }, { path: user, origin: 'user' }]);
  assert.equal(records.find((r) => r.directoryName === 'u-mcp')?.audience, 'internal');
  assert.equal(records.find((r) => r.directoryName === 'b-mcp')?.audience, 'mcp');
  assert.deepEqual(listSkillSummariesForMcp('public', records).map((s) => s.directoryName), ['b-mcp']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 我们薄薄保留的投影规则（S7 S9 S10b S14 S33）——每条都是 pi 不管、而旧代码踩过坑的
// ─────────────────────────────────────────────────────────────────────────────

test('S14 · 带 UTF-8 BOM 的 SKILL.md（Windows 记事本写的）照常加载：pi-agent-core 不剥 BOM，我们在 env 那一层剥', async (t) => {
  const root = await tempRoot(t);
  // BOM 用转义写，不写字面量：字面 BOM 会被 lint 当成不规则空白，而它正是这条用例要测的东西
  await landSkill(root, 'bom', `\ufeff---\r\nname: bom\r\ndescription: 记事本写的。\r\n---\r\n\r\n正文。\r\n`);
  const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.deepEqual(records.map((record) => [record.name, record.description]), [['bom', '记事本写的。']], JSON.stringify(diagnostics));
  assert.equal(records[0]!.content, '正文。', 'CRLF 归一、BOM 不在正文里');
  assert.deepEqual(diagnostics, []);
});

test('S9 · 损坏包（正文含 NUL）不许占坑遮蔽：内置根里那份坏的被跳过、用户根里同名的合法包顶上', async (t) => {
  const builtin = await tempRoot(t);
  const user = await tempRoot(t);
  await landSkill(builtin, 'shared', '---\nname: shared\ndescription: Broken\n---\n\0');
  await landSkill(user, 'shared', skillMd('shared', 'Valid'));
  const { records, diagnostics } = await discoverSkillRecords([{ path: builtin, origin: 'builtin' }, { path: user, origin: 'user' }]);
  assert.deepEqual(records.map((record) => [record.origin, record.description]), [['user', 'Valid']]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.type]), [['corrupt', 'warning']]);
});

test('S10b · 同一根里 foo/SKILL.md 与 foo.md 撞句柄：先到的赢、输家记诊断；导入避让也认得单文件的 stem', async (t) => {
  const root = await tempRoot(t);
  await writeFile(path.join(root, 'foo.md'), skillMd('foo', '单文件'));
  await landSkill(root, 'foo', skillMd('foo', '目录包'));
  const { records, diagnostics } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  assert.equal(records.filter((record) => record.directoryName === 'foo').length, 1);
  assert.ok(diagnostics.some((d) => d.code === 'shadowed'), JSON.stringify(diagnostics));
  // 导入一个句柄为 bar 的包，而根里已有 bar.md：落地目录要避让成 bar-2，不与单文件技能撞成同一个句柄。
  await writeFile(path.join(root, 'bar.md'), skillMd('bar', '单文件'));
  const landed = writeSkillImport(root, { version: SKILL_PACKAGE_VERSION, exportedAt: 0, dirName: 'bar', files: { 'SKILL.md': skillMd('bar', '导入的包') } });
  assert.equal(landed.dirName, 'bar-2');
});

test('S7 · 存量 skill.json 只在用户根迁进 frontmatter（跑在 pi 读盘之前）；内置根一个字不动', async (t) => {
  const user = await tempRoot(t);
  const builtin = await tempRoot(t);
  const legacy = { name: 'legacy.skill', version: '2.1.0', description: '清单里的描述', tools: [], requiredProviders: ['video'] };
  for (const [root, dir] of [[user, 'legacy-user'], [builtin, 'legacy-builtin']] as const) {
    await landSkill(root, dir, '---\nname: legacy.skill\ndescription: frontmatter 那份\n---\n\n方法论。\n');
    await writeFile(path.join(root, dir, 'skill.json'), JSON.stringify(legacy));
  }
  const { records, diagnostics } = await discoverSkillRecords([{ path: builtin, origin: 'builtin' }, { path: user, origin: 'user' }]);
  // 内置根：没迁（skill.json 还在，frontmatter 原样）；用户根：迁了（skill.json 没了，清单进了 metadata.nomi）。
  assert.ok(fs.existsSync(path.join(builtin, 'legacy-builtin', 'skill.json')));
  assert.ok(!fs.existsSync(path.join(user, 'legacy-user', 'skill.json')));
  const migrated = records.find((record) => record.origin === 'user')!;
  assert.equal(migrated.manifest?.version, '2.1.0');
  assert.equal(migrated.description, '清单里的描述');
  const untouched = records.find((record) => record.origin === 'builtin')!;
  assert.equal(untouched.manifest, null);
  assert.equal(untouched.description, 'frontmatter 那份');
  assert.ok(diagnostics.some((d) => d.code === 'legacy_manifest' && d.type === 'warning' && d.path === path.join(user, 'legacy-user')), JSON.stringify(diagnostics));
});

test('S33 · 导入回执的 neededProviders 从刚落盘的那份包本身派生（同一个 readSkillManifest owner），不再扫盘', async () => {
  const body = '---\nname: needs-video\ndescription: x\nmetadata:\n  nomi:\n    version: "1.0.0"\n    tools: []\n    required-providers:\n      - video\n---\n正文';
  const { manifest } = readSkillManifest(parseSkillFrontmatter(body));
  assert.deepEqual(deriveSkillNeeds(manifest!).providers, ['video']);
  // 包文件表：单文件技能以 SKILL.md 为键呈现，与目录包同一形状——内容寻址与导出共用这一条。
  const loose = { filePath: path.join(repoRoot, 'tests/fixtures/skills/chatcut-video-gen/SKILL.md'), packageDir: path.join(repoRoot, 'tests/fixtures/skills/chatcut-video-gen') };
  assert.ok(Object.keys(readSkillPackageFiles(loose)).includes('references/kling.md'));
});

// ─────────────────────────────────────────────────────────────────────────────
// lane 索引与 pi 的 Skill 形状（S44 S45）
// ─────────────────────────────────────────────────────────────────────────────

test('S45 · toPiSkills 的 sourceInfo 按事实填：source 等于发现来源，单文件技能是 top-level', async (t) => {
  const root = await tempRoot(t);
  await landSkill(root, 'packaged', skillMd('packaged'));
  await writeFile(path.join(root, 'loose.md'), skillMd('loose'));
  const { records } = await discoverSkillRecords([{ path: root, origin: 'user' }]);
  const skills = toPiSkills(records.map(toLaneSkillIndexEntry));
  const packaged = skills.find((skill) => skill.name === 'packaged')!;
  const loose = skills.find((skill) => skill.name === 'loose')!;
  assert.equal(packaged.sourceInfo.source, 'user');
  assert.equal(packaged.sourceInfo.origin, 'package');
  assert.equal(packaged.baseDir, path.join(root, 'packaged'));
  assert.equal(loose.sourceInfo.origin, 'top-level');
  assert.equal(loose.baseDir, root);
  // S44：进提示词的仍只有 name / description / location，且用 read。
  const section = renderLaneSkillSection(await loadPiSkillFormatter(), records.map(toLaneSkillIndexEntry));
  assert.match(section, /<available_skills>/);
  assert.match(section, /read tool/);
  assert.doesNotMatch(section, /正文。/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 选中技能进提示词（S50 S51 S53 S54）
// ─────────────────────────────────────────────────────────────────────────────

const selected = (overrides: Partial<SkillRecord> = {}): Pick<SkillRecord, 'name' | 'description' | 'filePath' | 'content'> => ({
  name: 'story-method', description: 'Story method', filePath: path.join(repoRoot, 'skills/story/SKILL.md'),
  content: '# Method\nWrite, review, revise.', ...overrides,
});

test('S53 · 信封逐字等于 pi 的 formatSkillInvocation；S51 · 交代四句在信封之前', () => {
  const skill = selected();
  const prompt = renderSelectedSkillPrompt(skill, 'omitted');
  const piSkill: Skill = { name: skill.name, description: skill.description, content: skill.content, filePath: skill.filePath };
  assert.equal(prompt, `${SELECTED_SKILL_FRAMING}\n\n${formatSkillInvocation(piSkill)}`);
  assert.ok(prompt.includes('本轮用户在输入框里挂了一条技能'));
  assert.ok(prompt.includes('要真的写进你调用工具时的入参里'));
  assert.ok(prompt.indexOf('本轮用户在输入框里挂了一条技能') < prompt.indexOf('<skill name='));
});

test('S54 · 三臂都从那一个参数可达；after_body 走的是 pi 的 additionalInstructions', () => {
  const skill = selected({ content: '# Method\n做点什么。' });
  const piSkill: Skill = { name: skill.name, description: skill.description, content: skill.content, filePath: skill.filePath };
  const after = renderSelectedSkillPrompt(skill, 'after_body');
  assert.equal(after, `${SELECTED_SKILL_FRAMING}\n\n${formatSkillInvocation(piSkill, SKILL_TOOL_AUTHORITY_SECTION)}`);
  assert.ok(after.indexOf('关于工具，一律以本条提示词里的') > after.indexOf('</skill>'));
  const before = renderSelectedSkillPrompt(skill, 'before_body');
  assert.ok(before.indexOf('关于工具，一律以本条提示词里的') < before.indexOf('<skill name='));
  const omitted = renderSelectedSkillPrompt(skill, 'omitted');
  assert.ok(!omitted.includes('关于工具，一律以本条提示词里的'));
  for (const arm of [after, before, omitted]) {
    assert.ok(arm.includes('本轮用户在输入框里挂了一条技能'));
    assert.ok(arm.includes('做点什么。\n</skill>'));
  }
  // 默认值就是暂定的那个臂；改常量即切换，不必改任何调用点。
  assert.equal(renderSelectedSkillPrompt(skill), renderSelectedSkillPrompt(skill, SKILL_TOOL_AUTHORITY_PLACEMENT));
  // 指向按名字不按方位。
  assert.ok(after.includes('`Available tools`') && after.includes('`Tool usage`'));
  assert.ok(!after.includes('以上面的工具清单'));
});

test('S50 · 进提示词的只有方法正文：拿盘上真技能，frontmatter 一个字不进', async () => {
  const { records } = await discoverSkillRecords([{ path: REPO_SKILLS, origin: 'builtin' }]);
  const record = records.find((item) => item.directoryName === 'curated-film-storyboard')!;
  const prompt = renderSelectedSkillPrompt(record);
  assert.ok(prompt.includes('宽屏'));
  for (const noise of ['license:', 'provenance:', 'metadata:', 'selectable-in-workbench']) assert.ok(!prompt.includes(noise), `frontmatter 的「${noise}」不该进提示词`);
  assert.ok(prompt.length < record.body.length + SELECTED_SKILL_FRAMING.length + SKILL_TOOL_AUTHORITY_SECTION.length);
});

test('S52 · 拼技能信封的只有 pi：仓内主进程源码里不出现手拼的 <skill name=', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'dist-electron', '.tmp'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|mts|cts)$/.test(entry.name) && !/\.test\./.test(entry.name) && fs.readFileSync(full, 'utf8').includes('<skill name=')) offenders.push(path.relative(repoRoot, full));
    }
  };
  walk(path.join(repoRoot, 'electron'));
  assert.deepEqual(offenders, []);
});
