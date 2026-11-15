import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const composer = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx'))
const sendButton = stripComments(read('src/workbench/generationCanvas/nodes/ComposerSendButton.tsx'))
const row = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'))
const anchorRow = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx'))

/**
 * 2026-09-11 用户实测：点「生成」之后按钮纹丝不动——没有按下态、没有忙态，
 * 和"没点着"长得一样，于是接着点第二下、第三下（每一下都是一次真实排队）。
 * 所以忙态**不只是回执**，它同时是闸：`disabled` 让第二下点不进去。
 */
describe('行内「生成」有忙态，而且忙态就是闸', () => {
  it('忙态由行状态派生，不在按钮里自己记一份', () => {
    expect(row).toContain("generating={props.actionBusy || exec?.status === 'generating'}")
    expect(composer).toContain('generating = false')
  })

  // 2026-11-14 三处一套：分镜行的「生成」是和画布同一颗发送钮（带字那一型），四件齐由那颗钮自己保证。
  it('忙态 = disabled + aria-busy + 转圈 + 换字，四件齐', () => {
    expect(composer).toContain('<ComposerSendButton')
    expect(composer).toContain('busy={generating}')
    expect(composer).toContain("label={t('storyboardEditor.frame.generate')}")
    expect(composer).toContain("'data-storyboard-generate-state': generating ? 'busy' : 'idle'")
    expect(sendButton).toContain('disabled={busy || disabled}')
    expect(sendButton).toContain('aria-busy={busy}')
    expect(sendButton).toContain('animate-spin')
    expect(sendButton).toContain("busy ? t('storyboardEditor.frame.generating') : label")
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
