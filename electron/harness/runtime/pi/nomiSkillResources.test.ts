import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createNomiSkillResourceCatalog,
  formatNomiSkillIndex,
  getNomiSkillRoots,
  type NomiLoadedSkill,
} from './nomiSkillResources.mjs';
import { discoverSkillRecordsFromRoots } from '../../../skills/skillStore';

describe('Nomi skill resource catalog', () => {
  it('discovers repository and user skills but never cwd/agentDir injection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-skill-catalog-'));
    const repository = join(root, 'repository');
    const user = join(root, 'user');
    const cwd = join(root, 'cwd');
    const agentDir = join(root, 'agent');
    await Promise.all([
      mkdir(join(repository, 'brand-promo'), { recursive: true }),
      mkdir(join(user, 'my-skill'), { recursive: true }),
      mkdir(join(cwd, 'skills', 'injected'), { recursive: true }),
      mkdir(join(agentDir, 'skills', 'injected-agent'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(repository, 'brand-promo', 'SKILL.md'), '---\nname: brand.promo\ndescription: Brand\n---\nUse brand rules.'),
      writeFile(join(user, 'my-skill', 'SKILL.md'), '---\nname: user.skill\ndescription: User\n---\nUse user rules.'),
      writeFile(join(cwd, 'skills', 'injected', 'SKILL.md'), '---\nname: injected\ndescription: Bad\n---\nDo not load.'),
      writeFile(join(agentDir, 'skills', 'injected-agent', 'SKILL.md'), '---\nname: injected-agent\ndescription: Bad\n---\nDo not load.'),
    ]);
    try {
      const catalog = createNomiSkillResourceCatalog([
        { path: repository, source: 'repository' },
        { path: user, source: 'user' },
      ]);
      const listed = catalog.list().skills;
      expect(listed.map((skill) => skill.name)).toEqual(['brand.promo', 'user.skill']);
      expect(listed.every((skill) => skill.contentHash.length === 64)).toBe(true);
      await expect(catalog.read('injected')).rejects.toThrow('Skill not found');
      await expect(catalog.read('brand.promo')).resolves.toMatchObject({ body: expect.stringContaining('Use brand rules.') });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects stale content hashes instead of loading a changed skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-skill-hash-'));
    const repository = join(root, 'repository');
    const skillDir = join(repository, 'one');
    await mkdir(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    await writeFile(skillPath, '---\nname: one\ndescription: One\n---\nOriginal');
    try {
      const catalog = createNomiSkillResourceCatalog([{ path: repository, source: 'repository' }]);
      const hash = catalog.list().skills[0]?.contentHash;
      expect(hash).toBeDefined();
      await writeFile(skillPath, '---\nname: one\ndescription: One\n---\nChanged');
      await expect(catalog.read('one', hash)).rejects.toThrow('Skill changed before load');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a package change outside SKILL.md so every transport keeps the same identity hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-skill-aux-hash-'));
    const repository = join(root, 'repository');
    const skillDir = join(repository, 'one');
    await mkdir(skillDir, { recursive: true });
    await Promise.all([
      writeFile(join(skillDir, 'SKILL.md'), '---\nname: one\ndescription: One\n---\nOriginal'),
      writeFile(join(skillDir, 'README.md'), 'Initial notes'),
    ]);
    try {
      const catalog = createNomiSkillResourceCatalog([{ path: repository, source: 'repository' }]);
      const hash = catalog.list().skills[0]?.contentHash;
      expect(hash).toBeDefined();
      await writeFile(join(skillDir, 'README.md'), 'Changed notes');
      await expect(catalog.read('one', hash)).rejects.toThrow('Skill changed before load');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('projects the canonical package record into Pi without changing metadata or discovery shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-skill-parity-'));
    const repository = join(root, 'repository');
    const packageDir = join(repository, 'camera');
    const nested = join(repository, 'nested', 'not-a-direct-package');
    await mkdir(packageDir, { recursive: true });
    await mkdir(nested, { recursive: true });
    await Promise.all([
      writeFile(join(packageDir, 'SKILL.md'), [
        '---',
        'name: camera',
        'description: Frontmatter is the only manifest',
        'disable-model-invocation: true',
        'metadata:',
        '  nomi:',
        '    version: "1.0.0"',
        '    tools: []',
        '    required-providers: []',
        '---',
        'Use the camera method.',
      ].join('\n')),
      writeFile(join(nested, 'SKILL.md'), '---\nname: nested-camera\ndescription: Nested\n---\nIgnore me.'),
      writeFile(join(repository, 'loose.md'), '---\nname: loose-camera\ndescription: Loose\n---\nIgnore me.'),
    ]);
    try {
      const roots = [{ path: repository, source: 'repository' as const }];
      const canonical = discoverSkillRecordsFromRoots([{ path: repository, origin: 'builtin' }]).records;
      const catalog = createNomiSkillResourceCatalog(roots);
      const listed = catalog.list().skills;
      expect(canonical).toHaveLength(1);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        name: canonical[0].name,
        description: canonical[0].description,
        contentHash: canonical[0].contentHash,
        directoryName: canonical[0].directoryName,
        disableModelInvocation: true,
      });
      await expect(catalog.read('camera', canonical[0].contentHash)).resolves.toMatchObject({
        name: canonical[0].name,
        body: expect.stringContaining('Use the camera method.'),
      });
      expect(listed[0].name).toBe('camera');
      expect(listed[0].description).toBe('Frontmatter is the only manifest');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not let an invalid higher-priority package shadow a valid same-directory package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-skill-precedence-'));
    const broken = join(root, 'broken');
    const valid = join(root, 'valid');
    await mkdir(join(broken, 'shared'), { recursive: true });
    await mkdir(join(valid, 'shared'), { recursive: true });
    await writeFile(join(broken, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: Broken\n---\n\0');
    await writeFile(join(valid, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: Valid\n---\nUse me.');
    try {
      const discovered = discoverSkillRecordsFromRoots([
        { path: broken, origin: 'builtin' },
        { path: valid, origin: 'user' },
      ]);
      expect(discovered.records).toHaveLength(1);
      expect(discovered.records[0]).toMatchObject({ origin: 'user', description: 'Valid' });
      expect(discovered.diagnostics).toEqual([
        expect.objectContaining({ type: 'warning', path: join(broken, 'shared') }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the canonical runtime roots, including the configured user-data Skill root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-skill-runtime-roots-'));
    const repository = join(root, 'repository');
    const settings = join(root, 'settings');
    const userSkills = join(settings, 'skills');
    const previousSkillsRoot = process.env.NOMI_SKILLS_DIR;
    const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR;
    await mkdir(join(repository, 'repo-skill'), { recursive: true });
    await mkdir(join(userSkills, 'user-skill'), { recursive: true });
    await Promise.all([
      writeFile(join(repository, 'repo-skill', 'SKILL.md'), '---\nname: repo.skill\ndescription: Repo\n---\nRepo body.'),
      writeFile(join(userSkills, 'user-skill', 'SKILL.md'), '---\nname: user.skill\ndescription: User\n---\nUser body.'),
    ]);
    process.env.NOMI_SKILLS_DIR = repository;
    process.env.NOMI_SETTINGS_DIR = settings;
    try {
      const roots = getNomiSkillRoots();
      expect(roots).toEqual(expect.arrayContaining([
        { path: repository, source: 'repository' },
        { path: userSkills, source: 'user' },
      ]));
      const catalog = createNomiSkillResourceCatalog();
      expect(catalog.list().skills.map((skill) => skill.name)).toEqual(
        expect.arrayContaining(['repo.skill', 'user.skill']),
      );
    } finally {
      if (previousSkillsRoot === undefined) delete process.env.NOMI_SKILLS_DIR;
      else process.env.NOMI_SKILLS_DIR = previousSkillsRoot;
      if (previousSettingsRoot === undefined) delete process.env.NOMI_SETTINGS_DIR;
      else process.env.NOMI_SETTINGS_DIR = previousSettingsRoot;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the model-facing skill index bounded, deterministic, and name-complete', () => {
    const skills = Array.from({ length: 30 }, (_, index) => ({
      name: `skill.${String(index).padStart(2, '0')}`,
      description: `Description ${index}`,
      contentHash: `${String(index).padStart(2, '0')}${'a'.repeat(62)}`,
    })) as NomiLoadedSkill[];
    const first = formatNomiSkillIndex(skills, { limit: 3 });
    const second = formatNomiSkillIndex([...skills].reverse(), { limit: 3 });
    expect(first).toBe(second);
    expect(first).toContain('showing 3 of 30');
    expect(first).toContain('- skill.00: Description 0');
    expect(first).toContain('More skill names are available:');
    expect(first).toContain('skill.29');
  });
});
