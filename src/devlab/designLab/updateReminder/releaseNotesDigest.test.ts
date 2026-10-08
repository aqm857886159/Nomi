import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { digestHighlights, digestReleaseNotes, isHotfixVersion, mergeDigests, shortVersion } from './releaseNotesDigest'

// 真实发版说明做输入：样张要画的就是这两份，约定结构变了这里先红。
const notes = (version: string): string => fs.readFileSync(path.resolve(process.cwd(), `docs/release-notes/v${version}.md`), 'utf8')

describe('digestReleaseNotes · 真实发版说明', () => {
  it('0.23.0 中文：H1 标题句、按二级标题分组、每组最多 3 条、只取加粗短语、剥 PR 号', () => {
    const digest = digestReleaseNotes(notes('0.23.0'), 'zh')
    expect(digest.title).toBe('逐张确认，说到做到')
    expect(digest.groups.map((group) => group.heading)).toEqual([
      'Agent 生成前的确认卡',
      '网络出问题时不重复提交',
      '用国内地址也能传参考图',
      '生成途中切项目',
    ])
    expect(digest.groups[0].items).toEqual(['每张单独决定', '中途点 × 就停'])
    // 原文 6 条，截到 3 条；加粗短语后面的正文不要。
    expect(digest.groups[1].items).toEqual(['请求发出去以后连接断了，不再自动重发', '只有确定没发出去才会自动重试', '提交卡住会超时'])
    expect(digest.hiddenGroups).toBe(9)
    for (const group of digest.groups) {
      for (const item of group.items) expect(item).not.toMatch(/#\d+|\*\*|[。.]$/)
    }
  })

  it('0.23.0 英文：没有 What changed 段 → 不硬凑（无标题、无分组），界面只显示版本号与完整说明', () => {
    expect(digestReleaseNotes(notes('0.23.0'), 'en')).toEqual({ title: null, groups: [], hiddenGroups: 0 })
  })

  it('0.23.1 两种语言各取各的段，互不混入', () => {
    const zh = digestReleaseNotes(notes('0.23.1'), 'zh')
    expect(zh.title).toBe('Mac 升级与退出热修')
    expect(zh.groups).toEqual([{ heading: '修了什么', items: ['安装更新后项目打不开', '旧版 Agent 记录拖住项目', '点「退出」没反应'] }])

    const en = digestReleaseNotes(notes('0.23.1'), 'en')
    expect(en.title).toBeNull()
    expect(en.groups).toEqual([{ heading: null, items: ['Projects open after an interrupted update', 'Older Agent receipts no longer block a project', 'Quit no longer gets stuck'] }])
  })

  it('子列表里的加粗不算这一条（「画布」组的节点更清爽下面还有一层列表）', () => {
    const digest = digestReleaseNotes(notes('0.23.0'), 'zh', { maxGroups: 20 })
    const canvas = digest.groups.find((group) => group.heading === '画布')
    expect(canvas?.items).toEqual(['节点更清爽', '节点工具栏一行放得下', '分镜所见即所发'])
  })
})

describe('digestReleaseNotes · 结构对不上', () => {
  it('空串 / 纯文本 / 没有加粗的列表 → 空结果，不抛', () => {
    expect(digestReleaseNotes('', 'zh')).toEqual({ title: null, groups: [], hiddenGroups: 0 })
    expect(digestReleaseNotes('Nomi 0.23.1 修了几个问题', 'zh')).toEqual({ title: null, groups: [], hiddenGroups: 0 })
    expect(digestReleaseNotes('## 修了什么\n\n- 一条没有加粗的', 'zh').groups).toEqual([{ heading: '修了什么', items: [] }])
  })

  it('英文段按 ### 分组，第一个 ### 之前的列表归无名组', () => {
    const md = '# Nomi v1.0.0 — 标题\n\n## What changed\n\n- **Loose** one\n\n### Canvas\n\n- **A**: a\n- **B**: b\n'
    expect(digestReleaseNotes(md, 'en').groups).toEqual([
      { heading: null, items: ['Loose'] },
      { heading: 'Canvas', items: ['A', 'B'] },
    ])
  })
})

describe('合并与版本号', () => {
  it('跳版合成一张：标题取最新一版，条目从新到旧摊平取 3 条', () => {
    const merged = mergeDigests([digestReleaseNotes(notes('0.23.1'), 'zh'), digestReleaseNotes(notes('0.23.0'), 'zh')])
    expect(merged).toEqual({ title: 'Mac 升级与退出热修', items: ['安装更新后项目打不开', '旧版 Agent 记录拖住项目', '点「退出」没反应'] })
    expect(digestHighlights(digestReleaseNotes(notes('0.23.0'), 'zh'))).toEqual(['每张单独决定', '中途点 × 就停', '请求发出去以后连接断了，不再自动重发'])
  })

  it('热修 = 第三位非 0；胶囊只在 .0 时省略第三位', () => {
    expect(isHotfixVersion('0.23.1')).toBe(true)
    expect(isHotfixVersion('0.24.0')).toBe(false)
    expect(shortVersion('0.24.0')).toBe('0.24')
    expect(shortVersion('0.23.1')).toBe('0.23.1')
  })
})
