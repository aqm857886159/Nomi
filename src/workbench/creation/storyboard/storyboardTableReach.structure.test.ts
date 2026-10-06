import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 分镜表「看得到、点得到」的结构不变量（审计 B5a，AUD-20261005-12 / 逃逸账本）。
 *
 * 这一族 bug 的特点：DOM 在、`toBeVisible` 绿、`getBoundingClientRect` 报完整尺寸（裁切不改 rect）、
 * Playwright 的 click 还会自己滚——只有真人看不见、点不到。所以真判据是走查里的 elementFromPoint
 * （`tests/ux/storyboard-table-structure.walk.mjs`）；这里钉的是**根因的形状**：
 *   ① 多选浮条不在 `overflow-hidden` 的行区里（sticky 只认最近的滚动祖先）；
 *   ② 表里每一个弹出层都走 `AnchoredPopover`（Portal 到 body），没有第二套原地 `absolute` 弹层。
 */

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const STORYBOARD_DIR = 'src/workbench/creation/storyboard'

function tsxFilesUnder(dir: string): string[] {
  const absolute = path.join(process.cwd(), dir)
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return tsxFilesUnder(relative)
    return entry.name.endsWith('.tsx') ? [relative] : []
  })
}

/** 取 `openIndex` 处那个 `<div` 到与它配对的 `</div>` 之间的文本（按 `<div` / `</div>` 计深度）。 */
function divBody(source: string, openIndex: number): string {
  const token = /<div\b|<\/div>/g
  token.lastIndex = openIndex
  let depth = 0
  for (let match = token.exec(source); match; match = token.exec(source)) {
    depth += match[0] === '</div>' ? -1 : 1
    if (depth === 0) return source.slice(openIndex, match.index)
  }
  throw new Error('div 没有配对')
}

describe('多选浮条：不能放在会裁切的行区里', () => {
  const table = stripComments(read(`${STORYBOARD_DIR}/StoryboardShotTable.tsx`))

  it('行区（overflow-hidden）里没有浮条；浮条与行区同级、坐在分镜页的滚动区里', () => {
    const marker = 'data-storyboard-rows="true"'
    const rowsMarkerAt = table.indexOf(marker)
    expect(rowsMarkerAt).toBeGreaterThan(0)
    const rowsOpenAt = table.lastIndexOf('<div', rowsMarkerAt)
    expect(table.slice(rowsOpenAt, rowsMarkerAt)).toContain('overflow-hidden')
    const rowsBody = divBody(table, rowsOpenAt)
    expect(rowsBody).not.toContain('StoryboardSelectionToolbar')
    expect(table).toContain('<StoryboardSelectionToolbar')
  })

  it('浮条本身仍是 sticky（跟屏）——它的「粘住」就是靠不在 overflow-hidden 里才成立的', () => {
    expect(read(`${STORYBOARD_DIR}/StoryboardSelectionToolbar.tsx`)).toContain('sticky bottom-2')
  })
})

describe('表内弹出层：全部走 AnchoredPopover，没有原地 absolute 弹层', () => {
  /**
   * 数门：行 ⋯ 菜单（StoryboardShotRow）、「用作…」菜单（StoryboardFrameActions）、提示词片段菜单
   * （PromptSkeletonSegments）、参考悬停预览（StoryboardHoverPreview）。
   * 底栏 ⋯（ShotComposerBar）与参考槽选择器（ShotReferenceSlotPopover → AssetPickerPopover）早就走它；
   * 下拉走 NomiSelect（Mantine，withinPortal）；@ 候选走 body 上的 Tiptap 渲染器。
   */
  const popoverUsers = [
    `${STORYBOARD_DIR}/shotRow/StoryboardShotRow.tsx`,
    `${STORYBOARD_DIR}/shotRow/StoryboardFrameActions.tsx`,
    `${STORYBOARD_DIR}/shotRow/PromptSkeletonSegments.tsx`,
    `${STORYBOARD_DIR}/StoryboardHoverPreview.tsx`,
    `${STORYBOARD_DIR}/shotRow/ShotComposerBar.tsx`,
  ]
  for (const relative of popoverUsers) {
    it(`${path.basename(relative)} 从 design 引 AnchoredPopover`, () => {
      expect(stripComments(read(relative))).toMatch(/import \{[^}]*\bAnchoredPopover\b[^}]*\} from '(\.\.\/)+design'/)
    })
  }

  /**
   * 原地弹层的指纹：`absolute` + 弹层层级（z-20 / z-30）+ 框线 + 投影。行在表格的 `overflow-hidden` 里，
   * 这样写的弹层在最后一行必被裁。参考列摊开那一块（`z-[5]`，同一排格子挪到行内的浮层里画）是行内摊开、
   * 不超出本行，不在此列。
   */
  it('storyboard 目录下没有 absolute + z-20/30 + border + shadow 的原地弹层', () => {
    const offenders: string[] = []
    for (const relative of tsxFilesUnder(STORYBOARD_DIR)) {
      const source = stripComments(read(relative))
      for (const match of source.matchAll(/className="([^"]*)"/g)) {
        const classes = match[1] ?? ''
        if (/\babsolute\b/.test(classes) && /\bz-(20|30)\b/.test(classes) && /\bborder\b/.test(classes) && /\bshadow-/.test(classes)) {
          offenders.push(`${relative}: ${classes.slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('悬停预览是纯展示：指针穿过它（passThrough），不拦下面的控件', () => {
    expect(stripComments(read(`${STORYBOARD_DIR}/StoryboardHoverPreview.tsx`))).toContain('passThrough')
    expect(stripComments(read('src/design/AnchoredPopover.tsx'))).toContain("pointerEvents: 'none'")
  })
})
