import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const composer = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx'))
const row = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'))
const actions = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx'))
const anchorRow = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx'))

/**
 * 2026-09-11 用户实测：点「生成」之后按钮纹丝不动——没有按下态、没有忙态，
 * 和"没点着"长得一样，于是接着点第二下、第三下（每一下都是一次真实排队）。
 * 所以忙态**不只是回执**，它同时是闸：`disabled` 让第二下点不进去。
 */
describe('行内「生成」有忙态，而且忙态就是闸', () => {
  it('忙态由行状态派生，不在按钮里自己记一份', () => {
    expect(row).toContain("generating={exec?.status === 'generating'}")
    expect(composer).toContain('generating = false')
  })

  it('忙态 = disabled + aria-busy + 转圈 + 换字，四件齐', () => {
    expect(composer).toContain('disabled={generating}')
    expect(composer).toContain('aria-busy={generating}')
    expect(composer).toContain("data-storyboard-generate-state={generating ? 'busy' : 'idle'}")
    expect(composer).toContain('animate-spin')
    expect(composer).toContain("generating ? t('storyboardEditor.frame.generating') : t('storyboardEditor.frame.generate')")
  })

  /** 失败行的「重试」会重新扣费，所以它更不该让人点第二下；长相对齐旁边那颗免费的「重新拉取结果」。 */
  it('失败行的「重试」按下即忙，和免费的「重新拉取」同一副长相', () => {
    expect(actions).toContain('if (retrying) return; setRetrying(true); onGenerate()')
    expect(actions).toContain('disabled={retrying}')
    expect(actions).toContain("data-storyboard-retry-state={retrying ? 'busy' : 'idle'}")
  })
})

describe('参考卡「生成中」压在能托住字的那层上', () => {
  /**
   * `bg-nomi-scrim` 只有 0.42 alpha：白字压在亮底图上实测 1.8:1（AA 要 4.5）。
   * scrim 负责压暗底图，托字是 `overlay-chip-strong` 的活（最坏情况 4.5:1）。
   */
  it('字与进度条在 overlay-chip-strong 胶囊里，不是直接躺在 scrim 上', () => {
    expect(anchorRow).toContain('data-anchor-generating-chip="true"')
    expect(anchorRow).toContain('bg-nomi-overlay-chip-strong px-2 py-1 text-center text-nomi-media-ink')
    expect(anchorRow).not.toMatch(/bg-nomi-scrim[^"]*text-(center [^"]*)?nomi-(paper|media-ink)/)
  })
})
