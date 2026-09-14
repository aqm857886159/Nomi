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

  /**
   * 助手面板的落位**两态都由外壳写明**，不靠自动落位（2026-09-15 第二轮）。
   *
   * 收起态尤其关键：那时 aside 是 `absolute inset-0` 的浮层，而作为网格容器的直接子节点 +
   * 确定的网格落位，它的包含块就是那一格网格区域（CSS Grid 绝对定位规则）。
   * 写 `row-start-1 col-span-full` = 「收起后的坞属于**内容行**」，于是那条浮起的输入条
   * 锚的是内容行下沿而不是整个工作区下沿——这正是 09-13「收起 Nomi 后输入条压住时间轴」的修法。
   * 任何 `row-start-2` / `row-span` 都会把它放回底部带那一行上。
   */
  it('助手面板两态都落在内容行，绝不跨到时间轴那一行', () => {
    const assistantBlock = source.slice(
      source.indexOf('<AssistantPane'),
      source.indexOf("'workbench-generation__timeline'"),
    )
    expect(assistantBlock.length).toBeGreaterThan(0)
    expect(assistantBlock).toContain("aiCollapsed ? 'row-start-1 row-end-2 col-span-full' : 'row-start-1 row-end-2 col-start-2'")
    expect(assistantBlock).not.toMatch(/row-start-[2-9]|row-span|h-screen/)
    // 只写 start 不算「确定的落位」：那一轴是 auto 时包含块的两条边退回网格容器的 padding 边，
    // 实测仍量到整个工作区（top 对、bottom 错）。所以两端都得写，两态各一份。
    expect(assistantBlock.match(/row-start-1 row-end-2/g)?.length).toBe(2)
    // 落位顺序也是结构条件：画布 → 助手 → 时间轴。助手排到时间轴之后会落进第 2 行。
    expect(source.indexOf('<AssistantPane')).toBeGreaterThan(source.indexOf("'workbench-generation__canvas'"))
    expect(source.indexOf('<AssistantPane')).toBeLessThan(source.indexOf("'workbench-generation__timeline'"))
  })
})

/**
 * 「工作区底部停靠区」的 owner 在外壳层（2026-09-15 第二轮）。
 *
 * 守的不变量：**避让名单的范围是工作区，不是画布这棵子树；只有一份实现。**
 * 09-13 的「时间轴收起后叫不回来」就是范围画小了：收起态的 Nomi 坞是工作区的孩子，
 * 画布范围的查询看不见它，胶囊按「底部居中」正好落在它下面。
 */
describe('底部停靠区避让：范围归外壳，实现只一份', () => {
  const ownerFile = path.join(process.cwd(), 'src/workbench/generation/workspaceBottomDocks.ts')
  const owner = stripComments(fs.readFileSync(ownerFile, 'utf8'))
  const canvasHook = stripComments(
    fs.readFileSync(path.join(process.cwd(), 'src/workbench/generationCanvas/reactFlow/useCanvasBottomDockRects.ts'), 'utf8'),
  )
  const collapsedDock = stripComments(
    fs.readFileSync(path.join(process.cwd(), 'src/workbench/ai/v4/AgentPanelV4Dock.tsx'), 'utf8'),
  )

  it('owner 把范围定在工作区那一层', () => {
    expect(owner).toContain("BOTTOM_DOCK_SCOPE_SELECTOR = '.workbench-generation'")
    expect(owner).not.toContain('.workbench-generation__canvas')
  })

  it('两个消费者都走 owner，没有第二份就地查询', () => {
    for (const consumer of [source, canvasHook]) {
      expect(consumer).toContain('collectBottomDockRects')
      // 就地 querySelectorAll 那份名单是被删掉的旧实现（P1 无并行版）。
      expect(consumer).not.toMatch(/querySelectorAll\(\s*['"`]\[data-canvas-bottom-dock/)
    }
    expect(canvasHook).not.toContain("closest(DOCK_SCOPE_SELECTOR)")
  })

  it('收起态的 Nomi 坞自己声明成底部停靠区', () => {
    expect(collapsedDock).toContain('data-canvas-bottom-dock="true"')
  })

  it('胶囊落位在 Nomi 面板收起/展开时重算（挂摘发生在外壳的孙子层，观察不到）', () => {
    expect(source).toContain('useTimelineHandleLeft(canvasRef, timelineHandleRef, timelineCollapsed, aiCollapsed)')
    expect(source).toContain('}, [enabled, canvasRef, handleRef, dockRevision])')
  })
})
