import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { createLaneSkillIndexSource, discoverSkillRecords } from './laneSkillCatalog.mjs'
import type { SkillDiscoveryRoot } from '../skills/skillStore'

const dirs: string[] = []
function tempRoot(prefix: string): string {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

async function writeSkill(
  root: string,
  name: string,
  opts: { description?: string; tools?: string; extraFile?: string } = {},
): Promise<string> {
  const dir = path.join(root, name)
  await fsp.mkdir(dir, { recursive: true })
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${opts.description ?? `${name} description`}`,
    ...(opts.tools ? [`tools: ${opts.tools}`] : []),
    '---',
    `Body for ${name}.`,
  ]
  const filePath = path.join(dir, 'SKILL.md')
  await fsp.writeFile(filePath, lines.join('\n'), 'utf8')
  if (opts.extraFile) {
    await fsp.mkdir(path.join(dir, 'assets'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'assets', 'note.txt'), opts.extraFile, 'utf8')
  }
  return filePath
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) cleanupTestTemp(dir)
})

describe('laneSkillCatalog 根目录树未变复用索引（反例覆盖新增/改 frontmatter/软链）', () => {
  it('未改动目录时连续两次 refresh 不重读 SKILL.md，FS 调用降至个位数', async () => {
    const builtinRoot = tempRoot('nomi-skill-builtin-')
    const userRoot = tempRoot('nomi-skill-user-')
    for (let i = 1; i <= 20; i += 1) {
      await writeSkill(builtinRoot, `builtin-skill-${String(i).padStart(2, '0')}`, { extraFile: `asset-${i}` })
    }
    await writeSkill(userRoot, 'user-alpha')
    const roots: SkillDiscoveryRoot[] = [
      { path: builtinRoot, origin: 'builtin' },
      { path: userRoot, origin: 'user' },
    ]
    const index = createLaneSkillIndexSource(async () => (await discoverSkillRecords(roots)).records, {
      loadFormatter: async () => ({
        formatSkillsForPrompt: (skills) => `<skills>${skills.map((s) => `${s.name}:${s.description}`).join('|')}</skills>`,
      }),
    })

    // 第 1 次冷扫建立缓存
    const first = await index.refresh()
    expect(first.entries).toHaveLength(21)

    // 统计第 2 次 & 第 3 次连续 refresh（模拟同一回合 laneHost:625 + laneHost:276）的 FS 调用数
    const readFileSpy = vi.spyOn(fsp, 'readFile')
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
    const readdirSpy = vi.spyOn(fsp, 'readdir')
    const readdirSyncSpy = vi.spyOn(fs, 'readdirSync')
    const lstatSpy = vi.spyOn(fsp, 'lstat')

    const second = await index.refresh()
    const third = await index.refresh()
    expect(second).toBe(first)
    expect(third).toBe(first)

    // 两次 refresh 合计：零正文读盘、零同步遍历，轻量 stat/readdir 保持个位数每轮
    expect(readFileSpy).not.toHaveBeenCalled()
    expect(readFileSyncSpy).not.toHaveBeenCalled()
    expect(readdirSyncSpy).not.toHaveBeenCalled()
    const totalCallsPerRefresh = (lstatSpy.mock.calls.length + readdirSpy.mock.calls.length) / 2
    expect(totalCallsPerRefresh).toBeLessThanOrEqual(8)
  })

  it('反例 1：两次发送之间在用户目录新增技能包或散装 .md，第二次 refresh 必须立刻看到', async () => {
    const builtinRoot = tempRoot('nomi-skill-add-builtin-')
    const userRoot = tempRoot('nomi-skill-add-user-')
    await writeSkill(builtinRoot, 'base-skill')
    const roots: SkillDiscoveryRoot[] = [
      { path: builtinRoot, origin: 'builtin' },
      { path: userRoot, origin: 'user' },
    ]
    const index = createLaneSkillIndexSource(async () => (await discoverSkillRecords(roots)).records, {
      loadFormatter: async () => ({
        formatSkillsForPrompt: (skills) => skills.map((s) => s.name).sort().join(','),
      }),
    })

    await index.refresh()
    expect(index.current().entries.map((e) => e.name)).toEqual(['base-skill'])

    // 两次发送之间新增一个包技能 + 一个散装根 .md 技能
    await writeSkill(userRoot, 'newly-added-pack', { description: 'Fresh pack skill' })
    await fsp.writeFile(
      path.join(userRoot, 'loose-tip.md'),
      '---\nname: loose-tip\ndescription: Loose skill file\n---\nLoose body.',
      'utf8',
    )

    await index.refresh()
    expect(index.current().entries.map((e) => e.name).sort()).toEqual(['base-skill', 'loose-tip', 'newly-added-pack'])
    expect(index.current().promptSection).toContain('newly-added-pack')
    expect(index.current().promptSection).toContain('loose-tip')
  })

  it('反例 2：两次发送之间修改已有技能 SKILL.md 的 frontmatter，第二次 refresh 必须看到新描述与新 tools', async () => {
    const userRoot = tempRoot('nomi-skill-edit-user-')
    await writeSkill(userRoot, 'editable-skill', { description: 'Old description' })
    const roots: SkillDiscoveryRoot[] = [{ path: userRoot, origin: 'user' }]
    const index = createLaneSkillIndexSource(async () => (await discoverSkillRecords(roots)).records, {
      loadFormatter: async () => ({
        formatSkillsForPrompt: (skills) => skills.map((s) => `${s.name}:${s.description}`).join('|'),
      }),
    })

    await index.refresh()
    expect(index.current().entries[0]?.description).toBe('Old description')
    expect(index.current().entries[0]?.requiresCodingTools).toBe(false)

    // 修改已有技能的 SKILL.md frontmatter（不增删任何目录项）
    await writeSkill(userRoot, 'editable-skill', { description: 'Updated frontmatter description', tools: 'coding' })

    await index.refresh()
    expect(index.current().entries[0]?.description).toBe('Updated frontmatter description')
    expect(index.current().entries[0]?.requiresCodingTools).toBe(true)
    expect(index.current().promptSection).toContain('Updated frontmatter description')
  })

  it('反例 3：两次发送之间删除技能或替换为软链，第二次 refresh 必须立刻失效并踢出', async () => {
    const userRoot = tempRoot('nomi-skill-rm-user-')
    const outside = tempRoot('nomi-skill-outside-')
    await writeSkill(userRoot, 'victim-skill')
    await writeSkill(outside, 'outside-skill')
    const roots: SkillDiscoveryRoot[] = [{ path: userRoot, origin: 'user' }]

    const first = await discoverSkillRecords(roots)
    expect(first.records.map((r) => r.name)).toEqual(['victim-skill'])

    // 把技能包替换成指向外部目录的软链
    await fsp.rm(path.join(userRoot, 'victim-skill'), { recursive: true, force: true })
    await fsp.symlink(path.join(outside, 'outside-skill'), path.join(userRoot, 'victim-skill'))

    const second = await discoverSkillRecords(roots)
    expect(second.records).toEqual([])
    expect(second.diagnostics.some((d) => d.code === 'symlink')).toBe(true)
  })
})
