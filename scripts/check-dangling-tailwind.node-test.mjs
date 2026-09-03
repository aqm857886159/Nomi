// 钉住悬空 Tailwind 类门岗的两个方向（2026-09-03）。
//
// 为什么值得单测：这道闸的失败模式是**静默的**——漏判时没有任何报错，只是某行字掉回继承色。
// 真实回归里已经栽过两次同族漏项（--nomi-warning 有变量无映射、--workbench-success-ink 同样），
// 所以这里用最小 config 片段把「该红的红、该绿的绿」钉死，别让解析器悄悄退化成永远绿。
//
// 随 check:dangling-tailwind 一起跑（package.json 同一条 script）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { findDanglingClasses, findUnmappedColorVars, keysOfBlock } from './check-dangling-tailwind.mjs'

// 最小但**结构同形**的 config：缩进层级必须和真 tailwind.config.ts 一致（组名 8 空格、叶子 10 空格），
// 解析器就是靠缩进分组的，缩进写错会让本测试测的是另一种东西。
const CFG = `
const workbenchBasePlugin = plugin(({ addBase }) => {
  addBase({
    ':root': {
      '--nomi-ink': 'oklch(0.22 0.01 80)',
      '--nomi-ink-60': 'oklch(0.50 0.01 80)',
      '--nomi-danger': 'oklch(0.55 0.20 27)',
      '--workbench-success': '#34c759',
      '--workbench-success-ink': '#248a3d',
      '--workbench-ink': 'var(--nomi-ink)',
      '--workbench-topbar-height': '56px',
      '--nomi-transition-fast': '140ms cubic-bezier(.2, .7, .3, 1)',
      '--nomi-font-sans': 'Inter, system-ui, sans-serif',
    },
  })
})

export default {
  theme: {
    extend: {
      colors: {
        nomi: {
          ink: tokenColor('--nomi-ink'),
          'ink-60': tokenColor('--nomi-ink-60'),
          danger: tokenColor('--nomi-danger'),
        },
        workbench: {
          ink: tokenColor('--workbench-ink'),
          success: tokenColor('--workbench-success'),
        },
      },
      borderRadius: {
        nomi: 'var(--nomi-radius)',
        'nomi-sm': 'var(--nomi-radius-sm)',
      },
      boxShadow: {
        'nomi-sm': 'var(--nomi-shadow-sm)',
      },
      fontSize: {
        micro: '11px',
      },
      fontFamily: {
        'nomi-sans': 'var(--nomi-font-sans)',
      },
    },
  },
}
`

test('keysOfBlock: 组内键拼成 组-键，组外叶子键直接收', () => {
  const colors = keysOfBlock(CFG, 'colors')
  assert.ok(colors.has('nomi-ink-60'), 'nomi-ink-60 应被识别')
  assert.ok(colors.has('workbench-success'), 'workbench-success 应被识别')
  assert.ok(!colors.has('workbench-success-ink'), 'workbench-success-ink 没映射，不该出现在键集合里')
  const radius = keysOfBlock(CFG, 'borderRadius')
  assert.ok(radius.has('nomi-sm') && radius.has('nomi'))
  assert.ok(!radius.has('nomi-md'), 'nomi-md 不存在')
})

test('正向：用了不存在的键要报，用了存在的键不能报', () => {
  const sources = [
    { file: 'a.tsx', text: `<p className="text-nomi-ink-60 text-workbench-success" />` },
    { file: 'b.tsx', text: `<p className="text-nomi-ink-70 rounded-nomi-md shadow-nomi-xs" />` },
    { file: 'c.tsx', text: `<i className="text-workbench-success-ink" />` },
  ]
  const hits = findDanglingClasses(CFG, sources).map((o) => `${o.file}:${o.cls}`)
  assert.deepEqual(hits.sort(), [
    'b.tsx:rounded-nomi-md',
    'b.tsx:shadow-nomi-xs',
    'b.tsx:text-nomi-ink-70',
    'c.tsx:text-workbench-success-ink',
  ])
})

test('正向：注释里的通配符示例不算用法', () => {
  const sources = [{ file: 'd.tsx', text: `// 例如 text-nomi-ink-* 这一族\n * bg-nomi-ink-99 也只是举例` }]
  assert.deepEqual(findDanglingClasses(CFG, sources), [])
})

test('正向：不碰 Tailwind 原生调色板', () => {
  const sources = [{ file: 'e.tsx', text: `<p className="text-red-500 bg-slate-900" />` }]
  assert.deepEqual(findDanglingClasses(CFG, sources), [])
})

test('反向：定义了颜色变量却没映射 → 列为 unmapped（success-ink 的真实断层）', () => {
  const { unmapped } = findUnmappedColorVars(CFG)
  assert.ok(unmapped.includes('--workbench-success-ink'), '这正是本轮 10 处绿字失色的根因，必须被抓到')
})

test('反向：已映射的颜色变量不算 unmapped，别名链要追进去', () => {
  const { unmapped } = findUnmappedColorVars(CFG)
  assert.ok(!unmapped.includes('--nomi-danger'), 'danger 已映射')
  assert.ok(!unmapped.includes('--workbench-ink'), 'workbench-ink 是 var(--nomi-ink) 别名且已映射')
})

test('反向：长度/时长/字体栈不是颜色，不该逼人去映射', () => {
  const { unmapped } = findUnmappedColorVars(CFG)
  for (const v of ['--workbench-topbar-height', '--nomi-transition-fast', '--nomi-font-sans']) {
    assert.ok(!unmapped.includes(v), `${v} 不是颜色，不该进 unmapped`)
  }
})

test('反向：补上映射后该变量即从 unmapped 消失（证明门岗认这个修法）', () => {
  const patched = CFG.replace(
    "          success: tokenColor('--workbench-success'),",
    "          success: tokenColor('--workbench-success'),\n          'success-ink': tokenColor('--workbench-success-ink'),",
  )
  assert.notEqual(patched, CFG, '补丁没打上，用例失去意义')
  const { unmapped } = findUnmappedColorVars(patched)
  assert.ok(!unmapped.includes('--workbench-success-ink'))
  // 同一份补丁也让正向那条悬空类转绿——两个方向咬合在同一行映射上。
  const sources = [{ file: 'c.tsx', text: `<i className="text-workbench-success-ink" />` }]
  assert.deepEqual(findDanglingClasses(patched, sources), [])
})
