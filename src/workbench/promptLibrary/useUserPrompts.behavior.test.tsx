/**
 * 「我的库」列表在屏上的行为（2026-10-28）：真挂 hook（react-reconciler 测试渲染器），桌面桥换成一块假盘，
 * 其余（API 层、共享缓存、hook）全是现役代码。
 *
 * 要钉住的症状：浏览器「提取提示词」成功后标签页写着「已存入提示词库」，左侧「提示词」抽屉里却看不到新条目，重载窗口才出现。
 * 病根是 hook 的模块级缓存只被 hook 自己的写方法刷新，而好几处写入（提取、保存选中文字、画布选区存库、素材面迁移）
 * 直调 API 写口、根本不经 hook。所以这里的写都是**直调 API**，不走 hook 的 add / update / remove / restore。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../ai/v4/testReactRenderer'

const bridgeBox = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => bridgeBox.current }))

import {
  addUserPrompt,
  deleteUserPromptWithSnapshot,
  restoreUserPrompt,
  updateUserPrompt,
} from '../api/promptLibraryApi'
import { loadUserPromptItems, useUserPrompts, type UseUserPrompts, type UseUserPromptsOptions } from './useUserPrompts'
import { getUserPromptsSnapshot, resetUserPromptListForTests } from './userPromptList'

type Row = { id: string; prompt: string; promptType: string; origin: string }

/** 一块假盘：主进程那边的「我的库」。记下每次桥调用，读失败可以注入。 */
function installDisk(initial: string[] = []) {
  const rows: Row[] = initial.map((id) => ({ id, prompt: id, promptType: 'image', origin: 'user' }))
  const calls: string[] = []
  const readFailure: { message: string | null } = { message: null }
  let seq = 0
  const answer = () => ({ ok: true, prompts: rows.map((row) => ({ ...row })) })
  bridgeBox.current = {
    promptLibrary: {
      userList: async () => {
        calls.push('userList')
        return readFailure.message ? { ok: false, prompts: [], error: readFailure.message } : answer()
      },
      userAdd: async (input: { prompt: string; promptType: string }) => {
        calls.push('userAdd')
        seq += 1
        rows.unshift({ id: `new-${seq}`, origin: 'user', ...input })
        return answer()
      },
      userUpdate: async (id: string, patch: Partial<Row>) => {
        calls.push('userUpdate')
        const found = rows.find((row) => row.id === id)
        if (!found) return { ok: false, prompts: answer().prompts, error: 'not found' }
        Object.assign(found, patch)
        return answer()
      },
      userDelete: async (id: string) => {
        calls.push('userDelete')
        const at = rows.findIndex((row) => row.id === id)
        const [deleted] = at >= 0 ? rows.splice(at, 1) : []
        return { ...answer(), deleted }
      },
      userRestore: async (snapshot: Row) => {
        calls.push('userRestore')
        rows.unshift({ ...snapshot })
        return answer()
      },
    },
  }
  return { rows, calls, readFailure, reads: () => calls.filter((call) => call === 'userList').length }
}

type Renderer = ReturnType<typeof createReactTestRenderer>
type Probe = { current: UseUserPrompts | null; renders: number }

function Host({ opened, options, probe }: { opened: boolean; options?: UseUserPromptsOptions; probe: Probe }): null {
  probe.current = useUserPrompts(opened, options)
  probe.renders += 1
  return null
}

const renderers: Renderer[] = []

/** 把 hook 挂出来。`render()` 用同样的参数再渲染一次（模拟父组件重渲）。 */
function mountHook(opened: boolean, options?: UseUserPromptsOptions) {
  const renderer = createReactTestRenderer()
  renderers.push(renderer)
  const probe: Probe = { current: null, renders: 0 }
  let currentOpened = opened
  const render = (nextOpened = currentOpened): void => {
    currentOpened = nextOpened
    renderer.render(<Host opened={currentOpened} options={options} probe={probe} />)
  }
  render()
  return {
    renderer,
    probe,
    render,
    items: (): string[] => (probe.current?.items ?? []).map((item) => item.prompt),
    unmount: (): void => renderer.close(),
  }
}

/** 等 IPC 应答与 effect 都落定。 */
async function settle(renderer: Renderer): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    renderer.flushPassiveEffects()
  }
}

/** 4 个写口：先 prepare（可选，不算被测的写），再直调写口。expected = 写完屏上应有的列表。 */
const PORTS = [
  { name: 'add', write: () => addUserPrompt({ prompt: 'extracted', promptType: 'image' }), expected: ['extracted', 'A', 'B'] },
  { name: 'update', write: () => updateUserPrompt('A', { prompt: 'A edited' }), expected: ['A edited', 'B'] },
  { name: 'delete', write: () => deleteUserPromptWithSnapshot('A'), expected: ['B'] },
  {
    name: 'restore',
    // 先在挂 hook 之前删掉 A，拿到删除快照；被测的写是把它恢复回来。
    prepare: async () => (await deleteUserPromptWithSnapshot('A')).deleted,
    write: (snapshot: unknown) => restoreUserPrompt(snapshot as never),
    expected: ['A', 'B'],
  },
] as const

describe('useUserPrompts · 列表是共享缓存的订阅', () => {
  beforeEach(() => {
    resetUserPromptListForTests()
  })

  afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.close()
    bridgeBox.current = null
  })

  it.each(PORTS)('$name：抽屉开着（hook 已挂载）时直调写口，屏上列表当场就是写完的整表，没有多读一次盘', async (port) => {
    const disk = installDisk(['A', 'B'])
    const snapshot = 'prepare' in port ? await port.prepare() : undefined
    const view = mountHook(true)
    await settle(view.renderer)
    const readsBeforeWrite = disk.reads()
    const rendersBeforeWrite = view.probe.renders

    await port.write(snapshot)
    await settle(view.renderer)

    expect(view.items()).toEqual(port.expected)
    expect(disk.reads()).toBe(readsBeforeWrite)
    expect(view.probe.renders).toBeGreaterThan(rendersBeforeWrite)
  })

  it('抽屉关着时发生的直调写入：再打开（新挂一个 hook）直接是新列表，且这次打开没有读盘', async () => {
    const disk = installDisk(['A'])
    const first = mountHook(true)
    await settle(first.renderer)
    expect(first.items()).toEqual(['A'])
    first.unmount()

    await addUserPrompt({ prompt: 'extracted', promptType: 'image' })
    const readsBeforeReopen = disk.reads()
    const reopened = mountHook(true)
    await settle(reopened.renderer)

    expect(reopened.items()).toEqual(['extracted', 'A'])
    expect(disk.reads()).toBe(readsBeforeReopen)
  })

  it('谁都没读过库就直接写（缓存是空的）：第一次写就把缓存初始化成主进程回的整表，之后打开也不用再读', async () => {
    const disk = installDisk(['A'])
    await addUserPrompt({ prompt: 'extracted', promptType: 'image' })
    expect(getUserPromptsSnapshot().map((item) => item.prompt)).toEqual(['extracted', 'A'])

    const view = mountHook(true)
    await settle(view.renderer)

    expect(view.items()).toEqual(['extracted', 'A'])
    expect(disk.reads()).toBe(0)
  })

  it('经 hook 自己的 add / update / remove / restore 写，列表同样当场更新；remove 交回删除快照', async () => {
    installDisk(['A', 'B'])
    const view = mountHook(true)
    await settle(view.renderer)

    await view.probe.current!.add({ prompt: 'via hook', promptType: 'image' })
    await settle(view.renderer)
    expect(view.items()).toEqual(['via hook', 'A', 'B'])

    await view.probe.current!.update('A', { prompt: 'A edited' })
    await settle(view.renderer)
    expect(view.items()).toEqual(['via hook', 'A edited', 'B'])

    const deleted = await view.probe.current!.remove('B')
    await settle(view.renderer)
    expect(deleted).toMatchObject({ id: 'B', prompt: 'B' })
    expect(view.items()).toEqual(['via hook', 'A edited'])

    await view.probe.current!.restore(deleted!)
    await settle(view.renderer)
    expect(view.items()).toEqual(['B', 'via hook', 'A edited'])
  })

  it('同时挂着两个实例（抽屉 + 生成框）：一次直调写入两边都更新；没打开的那个自始至终不读盘', async () => {
    const disk = installDisk(['A'])
    const drawer = mountHook(true)
    const composer = mountHook(false)
    await settle(drawer.renderer)
    await settle(composer.renderer)
    expect(disk.reads()).toBe(1)
    expect(composer.items()).toEqual(['A'])

    await addUserPrompt({ prompt: 'extracted', promptType: 'image' })
    await settle(drawer.renderer)
    await settle(composer.renderer)

    expect(drawer.items()).toEqual(['extracted', 'A'])
    expect(composer.items()).toEqual(['extracted', 'A'])
    expect(disk.reads()).toBe(1)
  })
})

describe('useUserPrompts · 什么时候读盘', () => {
  beforeEach(() => {
    resetUserPromptListForTests()
  })

  afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.close()
    bridgeBox.current = null
  })

  it('缓存里已经有：打开（挂载）0 次读盘，列表就是缓存里那份（生成框随点随挂的路径靠这条守住预算）', async () => {
    const disk = installDisk(['A'])
    await loadUserPromptItems()
    disk.calls.length = 0

    const view = mountHook(true)
    await settle(view.renderer)

    expect(disk.calls).toEqual([])
    expect(view.probe.current!.items).toBe(getUserPromptsSnapshot())
    expect(view.probe.current).toMatchObject({ loading: false, error: null })
  })

  it('缓存是空的：打开读一次盘，读完列表出来；预热 loadUserPromptItems 有缓存就不再读', async () => {
    const disk = installDisk(['A'])
    const view = mountHook(true)
    expect(view.probe.current!.items).toEqual([])
    await settle(view.renderer)
    expect(view.items()).toEqual(['A'])
    expect(disk.reads()).toBe(1)

    await expect(loadUserPromptItems()).resolves.toBe(getUserPromptsSnapshot())
    expect(disk.reads()).toBe(1)
  })

  it('没打开（opened=false）：不读盘，但已经显示缓存里有的；别处（应用启动后的预热）把库载进缓存，它随之更新', async () => {
    const disk = installDisk(['A'])
    const view = mountHook(false)
    await settle(view.renderer)
    expect(view.items()).toEqual([])
    expect(disk.reads()).toBe(0)

    await loadUserPromptItems()
    await settle(view.renderer)

    expect(view.items()).toEqual(['A'])
    expect(disk.reads()).toBe(1)
  })

  it('refreshOnOpen（抽屉）：缓存里有也读一次，并且读到「绕过渲染层写口」的写入；同样的重渲不再读，关掉再打开才再读一次', async () => {
    const disk = installDisk(['A'])
    await loadUserPromptItems()
    disk.calls.length = 0
    // 主进程那边另有写入者写了一条，渲染层写口没经手（缓存不知道）。
    disk.rows.unshift({ id: 'from-main', prompt: 'from main', promptType: 'image', origin: 'user' })

    const view = mountHook(true, { refreshOnOpen: true })
    await settle(view.renderer)
    expect(view.items()).toEqual(['from main', 'A'])
    expect(disk.reads()).toBe(1)

    const reload = view.probe.current!.reload
    view.render()
    view.render()
    await settle(view.renderer)
    expect(disk.reads()).toBe(1)
    // reload 引用稳定：不然依赖它的 effect 每次渲染都重跑，「打开时读一次」就成了「每次渲染都读」。
    expect(view.probe.current!.reload).toBe(reload)

    view.unmount()
    const reopened = mountHook(true, { refreshOnOpen: true })
    await settle(reopened.renderer)
    expect(disk.reads()).toBe(2)
  })

  it('refreshOnOpen 遇到空缓存：仍然只读一次（不是「先按缺省读、再按强制读」两次）', async () => {
    const disk = installDisk(['A'])
    const view = mountHook(true, { refreshOnOpen: true })
    await settle(view.renderer)
    expect(view.items()).toEqual(['A'])
    expect(disk.reads()).toBe(1)
  })

  it('读失败：列表保持原样、error 出来、loading 落回 false；再读成功 error 清掉', async () => {
    const disk = installDisk(['A'])
    const view = mountHook(true)
    await settle(view.renderer)
    expect(view.items()).toEqual(['A'])

    disk.readFailure.message = 'offline'
    view.probe.current!.reload()
    await settle(view.renderer)
    expect(view.probe.current).toMatchObject({ loading: false, error: 'offline' })
    expect(view.items()).toEqual(['A'])

    disk.readFailure.message = null
    view.probe.current!.reload()
    await settle(view.renderer)
    expect(view.probe.current).toMatchObject({ loading: false, error: null })
    expect(view.items()).toEqual(['A'])
  })
})
