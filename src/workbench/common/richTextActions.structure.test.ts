import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-10-23 用户实测：画布文本节点「上面有格式功能但是无法使用」、创作区「代码」钮「点了没反应」、悬停看不懂按钮。
// 类根因：格式按钮不是单一来源——创作区顶栏、选区浮条、画布文本节点格式条各写各的按钮：
//   · 状态在渲染时读一次 isActive，而编辑器关掉了按事务重渲（useNomiRichTextEditor），按下态跟不上光标；
//   · 画布格式条自己写 absolute 定位，不走节点浮条共享外壳，跟着画布缩放、贴顶时被顶栏盖住；
//   · 选区浮条第三份清单，定位把工具栏那一排也算进了可用区，盖住工具栏的钮。
// 合同：格式状态只在 richTextActions.tsx 里读（经 useEditorState 订阅事务），格式命令只在那里发；
// 两个格式工具栏经 useRichTextActions + RichTextActionButton 出钮；画布那一壳挂在 FloatingToolbarShell 里。
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const OWNER = 'src/workbench/common/richTextActions.tsx'
const SHELLS = [
  'src/workbench/creation/WorkbenchEditor.tsx',
  'src/workbench/generationCanvas/nodes/render/TextDocumentNode.tsx',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full) && !/\.test\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

const sources = walk(resolve(process.cwd(), 'src')).map((file) => ({ file: relative(process.cwd(), file).split('\\').join('/'), code: stripComments(readFileSync(file, 'utf8')) }))
const codeOf = (file: string): string => sources.find((source) => source.file === file)?.code ?? ''
const FORMAT_STATE_READ = /\.isActive\(\s*['"]/
const FORMAT_COMMAND = /\.(toggleBold|toggleItalic|toggleStrike|toggleCode|toggleHighlight|toggleHeading|toggleBlockquote|toggleBulletList|toggleOrderedList|toggleTaskList|setHorizontalRule|insertTable)\(/

describe('格式按钮只有一份定义', () => {
  it('格式状态只在 owner 里读', () => {
    expect(sources.filter(({ file, code }) => file !== OWNER && FORMAT_STATE_READ.test(code)).map(({ file }) => file)).toEqual([])
  })

  it('格式命令只在 owner 里发', () => {
    expect(sources.filter(({ file, code }) => file !== OWNER && FORMAT_COMMAND.test(code)).map(({ file }) => file)).toEqual([])
  })

  it('owner 订阅编辑器事务取按下 / 禁用态，并且读的是当前实例（不读快照里的 editor）', () => {
    // 快照里的 editor 在实例被换掉后要等新实例第一次事务才更新，期间是已销毁的旧实例（独立验收 L-acc-sonnet-20261023 发现 2）。
    expect(codeOf(OWNER)).toMatch(/useEditorState\(\{\s*editor,\s*selector:\s*\(\)\s*=>\s*readActionStates\(editor,/)
  })

  for (const shell of SHELLS) {
    it(`${shell} 经 useRichTextActions + RichTextActionButton 出钮`, () => {
      const code = codeOf(shell)
      expect(code).toMatch(/\buseRichTextActions\(/)
      expect(code).toMatch(/<RichTextActionButton\b/)
    })
  }

  it('画布文本节点的格式条挂在节点浮条共享外壳里', () => {
    expect(codeOf('src/workbench/generationCanvas/nodes/render/TextDocumentNode.tsx')).toMatch(/<FloatingToolbarShell\b/)
  })
})
