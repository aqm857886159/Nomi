import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { enStoryboardEditor, zhStoryboardEditor } from '../../../i18n/locales/storyboardEditor'

/**
 * 分镜面「装不下」的两条不变量（2026-09-17，EN 越界清零）。
 *
 * 现场：1280 视口 + Agent 面板展开 + 创作内容列收起时，分镜编辑器只有 840px。
 * 同一档下中文越界叶子 0，**英文 34** —— 被切的是 `Discard plan`、`Changes here apply to
 * all 8 shots…`、`3/8 shots generated…` 这类说明文字。两条根因、两条不变量：
 *
 *   ① 编辑器那张 grid **没写列模板** → 浏览器给一条隐式 `auto` 列 = max-content，
 *      最长的一行（页脚/批量条提示）把整列撑到 700+，再被 `overflow-hidden` 从右边剪掉。
 *      英文串长 1.5–2 倍，所以中文看不出、英文全线被切。
 *   ② 页脚的**让位顺序反了**：右组 `shrink-0` 里挂着一句零行动价值的重复说明，
 *      左组那句要用户去做事的进度/问题摘要反而靠 `truncate` 让位。
 *
 * 这两条都不是「英文的问题」——是英文把它们量出来了。
 */

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const editor = stripComments(read('src/workbench/creation/storyboard/StoryboardPlanEditor.tsx'))

describe('分镜编辑器：列宽钉在容器上，不由最长那一行说了算', () => {
  /**
   * `grid-cols-1` = `repeat(1, minmax(0,1fr))`。缺了它，隐式 `auto` 列取 max-content——
   * 越界的不是某一个元素写错了，是**整列**被最长的一行拉宽后统一剪掉。
   */
  it('编辑器 grid 写死单列模板（不靠隐式 auto 列）', () => {
    const section = editor.slice(editor.indexOf('data-storyboard-editor="true"') - 900, editor.indexOf('data-storyboard-editor="true"'))
    expect(section).toContain('grid-cols-1')
    expect(section).toContain('grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]')
  })

  /** 第二道保险：内容反过来撑宽滚动区这条路也堵死，顺带给行提供容器查询的锚。 */
  it('滚动区是 inline-size 容器，内容撑不宽它', () => {
    expect(editor).toContain('[container-type:inline-size]')
    expect(editor).toContain('[container-name:storyboard]')
  })
})

describe('分镜页脚：让位的是说明文字，不是要用户去做事的那句', () => {
  /**
   * 删掉的那句 `footer.spendNote` 逐字等于提示行 `spendHint` 的后半句——同一屏写了两遍，
   * 且住在 `shrink-0` 里永不让位（EN ≈220px / zh ≈110px）。留着它，左边那句
   * 「3/8 shots generated · 1 waiting for reference cards…」在 1280 下被切掉 426px。
   */
  it('页脚不再挂重复的花费说明（词条也一并删掉，不留死词条）', () => {
    expect(editor).not.toContain("t('storyboardEditor.footer.spendNote')")
    expect(zhStoryboardEditor.footer).not.toHaveProperty('spendNote')
    expect(enStoryboardEditor.footer).not.toHaveProperty('spendNote')
  })

  /**
   * 「每次生成前确认花费」这句承诺整个删掉（2026-09-26）：用户自己点的单行生成不再弹花钱确认卡
   * （spendConfirmationRequirement，2026-09-25 拍板），这句话在新规则下不成立；而用户自己点的生成，
   * 这句话本来也没有行动价值（R2）。提示行只留流程指引，页脚也不许再长出它。
   */
  it('zh：提示行与页脚都不再承诺「每次生成前确认花费」', () => {
    expect(zhStoryboardEditor.spendHint).toBe('先生成参考卡锁住长相，再生成镜头')
    const zhFooterValues: string[] = Object.values(zhStoryboardEditor.footer)
    expect([zhStoryboardEditor.spendHint, ...zhFooterValues].some((value) => value.includes('确认花费'))).toBe(false)
  })

  it('en：hint and footer no longer promise "Cost is confirmed before every generation"', () => {
    expect(enStoryboardEditor.spendHint).toBe('Generate reference cards to lock looks first, then shots')
    const enFooterValues: string[] = Object.values(enStoryboardEditor.footer)
    expect([enStoryboardEditor.spendHint, ...enFooterValues].some((value) => value.includes('Cost is confirmed'))).toBe(false)
  })

  /** 页脚右组只剩主动作；左组仍是 `min-w-0` + `truncate`（摘要让位、按钮不让位）。 */
  it('右组只剩主动作，左组仍然是会让位的那一侧', () => {
    const footer = editor.slice(editor.indexOf('<footer'), editor.indexOf('</footer>'))
    expect(footer).toContain('data-storyboard-batch="true"')
    expect(footer).toContain('data-storyboard-progress="true"')
    expect(footer.slice(footer.indexOf('shrink-0'))).not.toContain('text-micro text-nomi-ink-40')
    expect(footer).toContain('min-w-0')
  })
})
