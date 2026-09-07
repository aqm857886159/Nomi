import { describe, expect, it } from 'vitest'
import { collectFolderFiles, packageFromFolder, type DirEntryLike } from './skillDropIntake'

/** 造一棵假的 FileSystemEntry 树。`readEntries` 刻意按 Chromium 的分批语义返回。 */
function dir(name: string, children: DirEntryLike[], batchSize = 100): DirEntryLike {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      let cursor = 0
      return {
        readEntries(ok: (entries: DirEntryLike[]) => void) {
          const batch = children.slice(cursor, cursor + batchSize)
          cursor += batch.length
          ok(batch)
        },
      }
    },
  }
}

function file(name: string, text: string): DirEntryLike {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file(ok: (f: File) => void) {
      ok({ text: () => Promise.resolve(text) } as unknown as File)
    },
  }
}

const SKILL_MD = ['---', 'name: dropped-skill', 'description: 拖进来的技能', '---', '', '# 正文'].join('\n')

describe('collectFolderFiles', () => {
  it('保住子目录，二进制如实计入 skipped', async () => {
    const root = dir('audit-code', [
      file('SKILL.md', SKILL_MD),
      dir('references', [file('shots.md', '镜头清单')]),
      file('logo.png', 'binary'),
    ])
    const { files, skipped } = await collectFolderFiles(root)
    expect(files['SKILL.md']).toContain('# 正文')
    expect(files['references/shots.md']).toBe('镜头清单')
    expect(skipped).toEqual(['logo.png'])
  })

  it('忽略隐藏文件与 macOS 打包残留（不当作「跳过的内容」惊扰用户）', async () => {
    const root = dir('s', [file('SKILL.md', SKILL_MD), file('.DS_Store', 'x'), dir('__MACOSX', [file('a.md', 'x')])])
    const { files, skipped } = await collectFolderFiles(root)
    expect(Object.keys(files)).toEqual(['SKILL.md'])
    expect(skipped).toEqual([])
  })

  it('目录 reader 要读到空为止——只读一次会静默丢文件', async () => {
    // 101 个文件 + 每批最多 2 个：只读一次的实现只会拿到 2 个。
    const many = Array.from({ length: 101 }, (_, i) => file(`n${i}.md`, `body-${i}`))
    const root = dir('s', [file('SKILL.md', SKILL_MD), ...many], 2)
    const { files } = await collectFolderFiles(root)
    expect(Object.keys(files).length).toBeGreaterThan(50)
  })

  it('超过深度上限的层不再往下走（防深层炸弹）', async () => {
    const deep = dir('a', [dir('b', [dir('c', [dir('d', [file('too-deep.md', 'x')])])])])
    const root = dir('s', [file('SKILL.md', SKILL_MD), deep])
    const { files } = await collectFolderFiles(root)
    expect(Object.keys(files)).not.toContain('a/b/c/d/too-deep.md')
  })
})

describe('packageFromFolder', () => {
  it('目录名取 frontmatter 的 name（与选文件那条路同口径）', async () => {
    const parsed = await packageFromFolder(dir('audit-code', [file('SKILL.md', SKILL_MD)]))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload.dirName).toBe('dropped-skill')
  })

  it('没有 frontmatter 时退回文件夹名', async () => {
    const parsed = await packageFromFolder(dir('audit-code', [file('SKILL.md', '# 只有正文')]))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload.dirName).toBe('audit-code')
  })

  it('没有 SKILL.md 就报 noSkillMd（而不是静默建一个空技能）', async () => {
    const parsed = await packageFromFolder(dir('legacy', [file('skill.json', '{"name":"legacy"}')]))
    expect(parsed).toEqual({ ok: false, reason: 'noSkillMd' })
  })

  it('空文件夹报 empty', async () => {
    const parsed = await packageFromFolder(dir('empty', []))
    expect(parsed).toEqual({ ok: false, reason: 'empty' })
  })
})
