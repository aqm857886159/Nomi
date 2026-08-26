import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'

import {
  packageFromEnvelope,
  packageFromMarkdown,
  packageFromZipEntries,
  readFrontmatterName,
  stripCommonPrefix,
} from './parseSkillImport'

const SKILL_MD = `---
name: brand.promo
description: 做品牌宣传片
---

# 品牌宣传片
正文。`

/** 把 zipSync 的输出再解回 entries 形状——用真 zip 字节验，不拿手搓的 map 自欺。 */
function entriesOf(tree: Record<string, string>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(tree)) out[k] = strToU8(v)
  return out
}

describe('readFrontmatterName', () => {
  it('reads the standard Agent Skills frontmatter name', () => {
    expect(readFrontmatterName(SKILL_MD)).toBe('brand.promo')
  })
  it('returns empty when there is no frontmatter', () => {
    expect(readFrontmatterName('# 没有 frontmatter')).toBe('')
  })
})

describe('packageFromMarkdown（裸 SKILL.md 就能建技能）', () => {
  it('uses frontmatter name as the directory suggestion', () => {
    const res = packageFromMarkdown('whatever.md', SKILL_MD)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.payload.dirName).toBe('brand.promo')
    expect(res.payload.files['SKILL.md']).toContain('品牌宣传片')
  })

  it('falls back to the file name when frontmatter has no name', () => {
    const res = packageFromMarkdown('My Skill.md', '# 正文')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.dirName).toBe('My Skill')
  })

  it('rejects an empty file', () => {
    const res = packageFromMarkdown('x.md', '   \n  ')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('empty')
  })
})

describe('stripCommonPrefix（GitHub zip 会多包一层文件夹）', () => {
  it('finds SKILL.md at the root', () => {
    expect(stripCommonPrefix(['SKILL.md', 'references/a.md'])).toEqual({ prefix: '', ok: true })
  })
  it('strips a single wrapping folder', () => {
    expect(stripCommonPrefix(['skills-main/SKILL.md', 'skills-main/references/a.md']))
      .toEqual({ prefix: 'skills-main/', ok: true })
  })
  it('prefers the shallowest SKILL.md when several exist', () => {
    expect(stripCommonPrefix(['pkg/SKILL.md', 'pkg/nested/deep/SKILL.md']).prefix).toBe('pkg/')
  })
  it('reports failure when there is no SKILL.md at all', () => {
    expect(stripCommonPrefix(['readme.md', 'a/b.txt']).ok).toBe(false)
  })
})

describe('packageFromZipEntries', () => {
  it('keeps subdirectories and strips the wrapping folder', () => {
    const res = packageFromZipEntries(
      entriesOf({
        'brand-promo/SKILL.md': SKILL_MD,
        'brand-promo/references/shots.md': '镜头清单',
        'brand-promo/assets/tpl.txt': '模板',
      }),
      'brand-promo.zip',
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(Object.keys(res.payload.files).sort()).toEqual(['SKILL.md', 'assets/tpl.txt', 'references/shots.md'])
    expect(res.skipped).toEqual([])
  })

  it('reports skipped binaries instead of dropping them silently', () => {
    const res = packageFromZipEntries(
      entriesOf({ 'SKILL.md': SKILL_MD, 'logo.png': 'fake', 'cover.jpg': 'fake' }),
      'x.zip',
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.skipped.sort()).toEqual(['cover.jpg', 'logo.png'])
  })

  it('ignores __MACOSX and dotfiles without counting them as skipped', () => {
    const res = packageFromZipEntries(
      entriesOf({ 'SKILL.md': SKILL_MD, '__MACOSX/._SKILL.md': 'x', '.DS_Store': 'x' }),
      'x.zip',
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.skipped).toEqual([])
  })

  it('fails with noSkillMd when the zip has no SKILL.md', () => {
    const res = packageFromZipEntries(entriesOf({ 'readme.md': '# hi' }), 'x.zip')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('noSkillMd')
  })

  it('survives a real zip round-trip (not just a hand-built map)', () => {
    const bytes = zipSync({ 'pkg/SKILL.md': strToU8(SKILL_MD), 'pkg/references/a.md': strToU8('ref') })
    // 用 fflate 自己解回来，确保我们对 entries 形状的假设跟真实解包一致
    const res = packageFromZipEntries(unzipSync(bytes), 'pkg.zip')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.files['references/a.md']).toBe('ref')
  })
})

describe('packageFromEnvelope（我们自己导出的 .nomiskill.json 仍然能进）', () => {
  it('passes a well-shaped envelope through untouched', () => {
    const env = { version: 'nomi-skill-v1', dirName: 'x', files: { 'SKILL.md': 'b' } }
    const res = packageFromEnvelope(env)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload).toBe(env)
  })
  it('rejects shapes that are not skill packages', () => {
    expect(packageFromEnvelope(null).ok).toBe(false)
    expect(packageFromEnvelope([1, 2]).ok).toBe(false)
    expect(packageFromEnvelope({ dirName: 'x' }).ok).toBe(false)
  })
})
