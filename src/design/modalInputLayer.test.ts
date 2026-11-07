import { afterEach, describe, expect, it, vi } from 'vitest'
import { modalInputLayerCovers, onModalInputLayerOpened, openModalInputLayer, type ModalInputLayerHandle } from './modalInputLayer'

const opened: ModalInputLayerHandle[] = []
const open = (covers: Element | null = null): ModalInputLayerHandle => {
  const handle = openModalInputLayer(covers)
  opened.push(handle)
  return handle
}
afterEach(() => { opened.splice(0).forEach((handle) => handle.close()) })

const inside = {} as Element
const outside = {} as Element
const cell = { contains: (element: Element) => element === inside } as unknown as Element

describe('模态输入层：栈', () => {
  it('没有开着的层时谁都没被盖住', () => {
    expect(modalInputLayerCovers(inside)).toBe(false)
    expect(modalInputLayerCovers(outside)).toBe(false)
  })

  it('整窗的层盖住一切；关了就全恢复', () => {
    const layer = open()
    expect(modalInputLayerCovers(inside)).toBe(true)
    expect(modalInputLayerCovers(outside)).toBe(true)
    layer.close()
    expect(modalInputLayerCovers(inside)).toBe(false)
    expect(modalInputLayerCovers(outside)).toBe(false)
  })

  it('只盖一块的层只盖那一块', () => {
    const layer = open(cell)
    expect(modalInputLayerCovers(inside)).toBe(true)
    expect(modalInputLayerCovers(outside)).toBe(false)
    layer.close()
    expect(modalInputLayerCovers(inside)).toBe(false)
  })

  it('嵌套：关上面那层，下面那层还在；乱序关也一样', () => {
    const settings = open()
    const confirm = open()
    confirm.close()
    expect(modalInputLayerCovers(outside)).toBe(true)
    const second = open()
    settings.close()
    expect(modalInputLayerCovers(outside)).toBe(true)
    second.close()
    expect(modalInputLayerCovers(outside)).toBe(false)
  })

  it('重复关只摘自己，不多摘别的层', () => {
    const settings = open()
    const confirm = open()
    confirm.close()
    confirm.close()
    expect(modalInputLayerCovers(outside)).toBe(true)
    expect(settings.isTop()).toBe(true)
  })

  it('isTop 只有最上面那层为真；上层关了它又回到最上面；自己关了就不再是', () => {
    const lightbox = open(cell)
    expect(lightbox.isTop()).toBe(true)
    const confirm = open()
    expect(lightbox.isTop()).toBe(false)
    expect(confirm.isTop()).toBe(true)
    confirm.close()
    expect(lightbox.isTop()).toBe(true)
    lightbox.close()
    expect(lightbox.isTop()).toBe(false)
  })
})

describe('模态输入层：关掉它的那个事件派发完之前还算数', () => {
  // 一个 Esc：Mantine 在 window 捕获期关掉弹层，React 在微任务里提交，事件接着往下走到灯箱和画布的监听。
  const dispatching = (event: Event | undefined) => vi.stubGlobal('window', { event })
  afterEach(() => { vi.unstubAllGlobals() })

  it('同一个事件里还盖着，也还压在下面那层上面；事件一换就全恢复', () => {
    const esc = new Event('keydown')
    const lightbox = open(cell)
    const confirm = open()
    dispatching(esc)
    confirm.close()
    expect(modalInputLayerCovers(outside), '关它的这一下还没派发完').toBe(true)
    expect(lightbox.isTop(), '这一下不许再关灯箱').toBe(false)
    dispatching(new Event('keydown'))
    expect(modalInputLayerCovers(outside), '下一个键是新事件').toBe(false)
    expect(lightbox.isTop()).toBe(true)
  })

  it('派发结束后（window.event 归空）立刻恢复，不用等下一个事件', () => {
    const esc = new Event('keydown')
    const confirm = open()
    dispatching(esc)
    confirm.close()
    dispatching(undefined)
    expect(modalInputLayerCovers(outside)).toBe(false)
  })

  it('不在事件里关（比如异步回调）：当场摘掉；重复关不会把后来的事件记上去', () => {
    dispatching(undefined)
    const confirm = open()
    confirm.close()
    expect(modalInputLayerCovers(outside)).toBe(false)
    dispatching(new Event('keydown'))
    confirm.close()
    expect(modalInputLayerCovers(outside)).toBe(false)
  })

  it('同一个事件里关了又开新的：新层在最上面，旧层到点才摘', () => {
    const esc = new Event('keydown')
    dispatching(esc)
    const first = open()
    first.close()
    const second = open()
    expect(second.isTop()).toBe(true)
    second.close()
    dispatching(undefined)
    expect(modalInputLayerCovers(outside)).toBe(false)
  })
})

describe('模态输入层：打开通知', () => {
  it('打开时通知一次，带盖住的范围；通知时这一层已经生效；退订后不再通知', () => {
    const seen: Array<{ covers: Element | null; covered: boolean }> = []
    const off = onModalInputLayerOpened((covers) => { seen.push({ covers, covered: modalInputLayerCovers(inside) }) })
    open(cell)
    open()
    expect(seen).toEqual([{ covers: cell, covered: true }, { covers: null, covered: true }])
    off()
    open()
    expect(seen).toHaveLength(2)
  })

  it('关闭不发打开通知', () => {
    const listener = vi.fn()
    const layer = open()
    const off = onModalInputLayerOpened(listener)
    layer.close()
    off()
    expect(listener).not.toHaveBeenCalled()
  })
})
