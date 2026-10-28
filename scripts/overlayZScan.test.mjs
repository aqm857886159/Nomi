// 「手写数字层级」扫描器的自证：五种写法的红例都抓得到、合规写法与组件内局部层叠不误伤。
// 规则与来历见 scripts/lib/overlayZScan.mjs 头注；接进 check:tokens 第 9 类（scripts/check-design-tokens.mjs）。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { NOMI_OVERLAY_Z_INDEX } from '../src/design/overlayLayers'
import { isOverlayZScanned, readScaleFloor, scanOverlayZFile } from './lib/overlayZScan.mjs'

const FLOOR = 100
const scan = (text, rel = 'src/x/Fixture.tsx') => scanOverlayZFile(rel, text, FLOOR)
const shapes = (text, rel) => scan(text, rel).map((f) => `${f.shape}:${f.value}`)

describe('readScaleFloor：地板只读刻度源文件，数字只有一份', () => {
  it('读到的就是真刻度里的 shellChrome', () => {
    const source = fs.readFileSync(new URL('../src/design/overlayLayers.ts', import.meta.url), 'utf8')
    expect(readScaleFloor(source)).toBe(NOMI_OVERLAY_Z_INDEX.shellChrome)
  })

  it('刻度里没有 shellChrome 就直接抛，不退回硬编码', () => {
    expect(() => readScaleFloor('export const NOMI_OVERLAY_Z_INDEX = { dialog: 9100 }')).toThrow(/shellChrome/)
  })
})

describe('isOverlayZScanned：只管生产 src 的 ts / tsx / css', () => {
  it('归它管', () => {
    for (const rel of ['src/workbench/onboarding/SplashIntro.tsx', 'src/ui/x.ts', 'src/styles/index.css']) expect(isOverlayZScanned(rel), rel).toBe(true)
  })

  it('不归它管：测试、设计实验室、刻度本身、src 之外', () => {
    for (const rel of ['src/a/B.test.tsx', 'src/a/B.test.ts', 'src/a/b.d.ts', 'src/devlab/designLab/x.tsx', 'src/design/overlayLayers.ts', 'scripts/x.mjs', 'electron/x.ts', 'src/a/readme.md']) {
      expect(isOverlayZScanned(rel), rel).toBe(false)
    }
  })
})

describe('红例：className 里的数字层级', () => {
  it('开屏原样：fixed inset-0 z-[60]（这次事故）', () => {
    const found = scan(`<motion.div className={cn('nomi-splash fixed inset-0 z-[60] bg-nomi-bg', 'flex')} />`)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ shape: 'class', value: 60, viewport: true })
  })

  it('#1136 原样：portal 出去的右键菜单 fixed z-50（Tailwind 默认刻度）', () => {
    expect(shapes(`createPortal(<div role="menu" className="fixed z-50 min-w-[120px]" />, document.body)`)).toEqual(['class:50'])
  })

  it('fixed 与 z 写在 cn() 的不同参数里、条件分支里也算同一个元素', () => {
    expect(shapes(`<div className={cn('fixed inset-0', open && 'z-[60]')} />`)).toEqual(['class:60'])
    expect(shapes(`<div className={\`\${open ? 'fixed' : 'absolute'} inset-0 z-[3]\`} />`)).toEqual(['class:3'])
  })

  it('带前缀的 fixed / z 也认：md:fixed、hover:z-[130]', () => {
    expect(shapes(`<div className="md:fixed md:z-[9]" />`)).toEqual(['class:9'])
    expect(shapes(`<div className="absolute hover:z-[130]" />`)).toEqual(['class:130'])
  })

  it('≥ 地板的数字，不管是不是 fixed（09-07 原样：portal 里的 z-[9999]）', () => {
    const found = scan(`createPortal(<div className="absolute inset-0 z-[9999]" />, document.body)`)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ value: 9999, viewport: false })
  })

  it('不在 JSX className 里的常量字符串：同一个字符串里有 fixed 才算视口级', () => {
    expect(shapes(`const OVERLAY = 'fixed inset-0 z-[60]'`)).toEqual(['class:60'])
    expect(shapes(`const LOCAL = 'absolute inset-0 z-[60]'`)).toEqual([])
  })
})

describe('红例：行内 style / 属性 / 命名常量 / 命令式 / CSS', () => {
  it('style 对象：position fixed + zIndex 数字（含数字字符串、条件两支）', () => {
    expect(shapes(`<div style={{ position: 'fixed', zIndex: 10000 }} />`)).toEqual(['style:10000'])
    expect(shapes(`<div style={{ position: 'fixed', zIndex: '60' }} />`)).toEqual(['style:60'])
    expect(shapes(`<div style={{ position: 'fixed', zIndex: open ? 5 : 4 }} />`)).toEqual(['style:5', 'style:4'])
  })

  it('style 在 className 带 fixed 的元素上', () => {
    expect(shapes(`<div className="fixed inset-0" style={{ zIndex: 4000, background: 'x' }} />`)).toEqual(['style:4000'])
  })

  it('返回对象字面量：同一个对象里有 position: fixed', () => {
    expect(shapes(`const s = () => ({ position: 'fixed', left: 1, zIndex: 1000 })`, 'src/x/layer.ts')).toEqual(['style:1000'])
  })

  it('属性 zIndex={N}：≥ 地板，或挂在 fixed 元素上', () => {
    expect(shapes(`<Popover zIndex={120} />`)).toEqual(['prop:120'])
    expect(shapes(`<Layer className="fixed" zIndex={1} />`)).toEqual(['prop:1'])
  })

  it('命名常量 FOO_Z_INDEX = N：第二份刻度，任何数字都算', () => {
    expect(shapes(`export const FULLSCREEN_Z_INDEX = 3000`, 'src/x/fullscreenZIndex.ts')).toEqual(['const:3000'])
    expect(shapes(`const ASSET_PICKER_Z_INDEX = 60`, 'src/x/p.tsx')).toEqual(['const:60'])
  })

  it('命令式 el.style.zIndex = N：同块里设了 position fixed，或数字 ≥ 地板', () => {
    expect(shapes(`function f(el) { el.style.position = 'fixed'; el.style.zIndex = '60' }`, 'src/x/p.ts')).toEqual(['style:60'])
    expect(shapes(`function f(el) { el.style.zIndex = '500' }`, 'src/x/p.ts')).toEqual(['style:500'])
  })

  it('CSS 规则：position: fixed 的任何数字，或任何 ≥ 地板的数字（含 @media 里的）', () => {
    expect(shapes(`.a { position: fixed; z-index: 5; }`, 'src/styles/a.css')).toEqual(['css:5'])
    expect(shapes(`.b { z-index: 150 }`, 'src/styles/a.css')).toEqual(['css:150'])
    expect(shapes(`@media (min-width: 1px) { .c { position: fixed; z-index: 9; } }`, 'src/styles/a.css')).toEqual(['css:9'])
  })

  it('命中带行号', () => {
    const found = scan(`const a = 1\n\n<div className="fixed z-[7]" />`)
    expect(found[0].line).toBe(3)
  })
})

describe('绿例：合规写法与组件内局部层叠不误伤', () => {
  it('刻度类名：z-application-modal / z-dialog / z-popover / z-floating-panel / z-confirmation / z-feedback / z-shell-chrome', () => {
    for (const tier of ['application-modal', 'dialog', 'popover', 'floating-panel', 'confirmation', 'feedback', 'shell-chrome']) {
      expect(shapes(`<div className="fixed inset-0 z-${tier}" />`), tier).toEqual([])
    }
  })

  it('刻度常量：style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}（含 position fixed）', () => {
    expect(shapes(`<div style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }} />`)).toEqual([])
    expect(shapes(`<div style={{ position: 'fixed', zIndex: NOMI_OVERLAY_Z_INDEX.popover }} />`)).toEqual([])
    expect(shapes(`<Popover zIndex={NOMI_OVERLAY_Z_INDEX.popover} />`)).toEqual([])
  })

  it('标识符不是数字字面量：zIndex={CANVAS_LAYER.x}（画布内部另有自己的局部层级表）', () => {
    expect(shapes(`<div className="fixed" style={{ zIndex: CANVAS_LAYER.chromeDock }} />`)).toEqual([])
    expect(shapes(`<Frame zIndex={CANVAS_LAYER.selectionToolbar} />`)).toEqual([])
  })

  it('地板以下、不是 fixed 的数字：局部层叠', () => {
    for (const markup of [
      `<div className="absolute inset-0 z-[2]" />`,
      `<div className="relative z-10" />`,
      `<header className="sticky top-0 z-10" />`,
      `<div className="absolute z-[60]" />`,
      `<div style={{ zIndex: 3 }} />`,
      `<Layer zIndex={2} />`,
    ]) expect(shapes(markup), markup).toEqual([])
  })

  it('变量值、z-auto、非层级常量', () => {
    expect(shapes(`<div className="fixed inset-0 z-[var(--nomi-z-dialog)]" />`)).toEqual([])
    expect(shapes(`<div className="fixed inset-0 z-auto" />`)).toEqual([])
    expect(shapes(`const FOO = 60; const zIndexLookup = { a: 1 }`, 'src/x/p.ts')).toEqual([])
  })

  it('CSS：地板以下、不是 fixed 的数字', () => {
    expect(shapes(`.a { position: absolute; z-index: 2; }`, 'src/styles/a.css')).toEqual([])
    expect(shapes(`.a { position: relative; z-index: 99 }`, 'src/styles/a.css')).toEqual([])
    expect(shapes(`.a { position: fixed; z-index: var(--nomi-z-dialog); }`, 'src/styles/a.css')).toEqual([])
  })

  it('不含任何层级字样的文件直接放行（快速过滤）', () => {
    expect(scan(`export const a = 1`)).toEqual([])
  })
})
