import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 生成面外壳的容器关系（根因合同 2026-09-15-generation-shell-bottom-band）。
 *
 * 守的不变量：**底部带横贯整个工作区，右侧 AI 面板被它顶上去，第 2 行没有空格子。**
 *
 * 为什么需要这份结构测试：09-13 的「右下角缺了一大块」是一串 Tailwind 类名改错的结果
 * （`d2bb622c1` 把底部带从横贯两列收进第 1 列），而这条关系当时没有任何断言看着它——
 * 连同一晚落地的走查注释都还写着「时间轴是 col-span-full」，代码和注释当场对不上也没人红。
 * 走查量的是真实矩形（那是最终判据），这份测试守的是**结构条件本身**：
 * 两头一起才盖住「布局类名被改回去」这一类。
 *
 * 只扫源码文本、不渲染：要断的就是「源码里写的是哪几个类名」。
 */

const workspaceFile = path.join(process.cwd(), 'src/workbench/generation/GenerationWorkspace.tsx')

/**
 * 剥注释再判。不剥的话本文件上方那段「曾经写成 col-start-1」的说明本身会把断言打红
 * （走查门岗 `source-scan-without-strip` 抓的正是这一类反噬）。
 */
function stripComments(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const source = stripComments(fs.readFileSync(workspaceFile, 'utf8'))

describe('生成面外壳：底部带横贯、面板被顶上去', () => {
  it('工作区是「内容行 + 时间轴行」两行、「画布列 + 助手列」两列的网格', () => {
    expect(source).toContain('grid-rows-[minmax(0,1fr)_var(--workbench-timeline-height)]')
    expect(source).toContain("gridTemplateColumns: isDockedAssistant ? 'minmax(0,1fr) var(--generation-assistant-width)' : 'minmax(0,1fr)'")
    expect(source).toContain('gridTemplateRows: `minmax(0,1fr) ${timelineCollapsed ? \'0px\' : `${timelineHeight}px`}`')
  })

  it('时间轴容器横贯所有列（不是只占画布那一列）', () => {
    const timelineBlock = source.slice(
      source.indexOf("'workbench-generation__timeline'"),
      source.indexOf('TimelineResizeHandle />'),
    )
    expect(timelineBlock.length).toBeGreaterThan(0)
    expect(timelineBlock).toContain('col-span-full')
    // 收进单列的写法不许回来：它就是「右下角缺一块」的直接成因。
    expect(timelineBlock).not.toMatch(/col-start-\d/)
    expect(timelineBlock).not.toMatch(/col-span-(?!full)\d/)
  })

  it('助手面板只占内容行，不跨到时间轴那一行', () => {
    // AssistantPane 走自动落位（第 1 行第 2 列）。任何显式行跨越都会让它压到底部带上，
    // 或者把底部带挤出第 2 行——两种都是 09-13 那张截图。
    const assistantLine = source.split('\n').find((line) => line.includes('<AssistantPane'))
    expect(assistantLine).toBeTruthy()
    expect(assistantLine).not.toMatch(/row-span|row-start|h-screen/)
    // 落位顺序也是结构条件：画布 → 助手 → 时间轴。助手排到时间轴之后会落进第 2 行。
    expect(source.indexOf('<AssistantPane')).toBeGreaterThan(source.indexOf("'workbench-generation__canvas'"))
    expect(source.indexOf('<AssistantPane')).toBeLessThan(source.indexOf("'workbench-generation__timeline'"))
  })
})
