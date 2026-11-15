// 此刻显示那一份（agentFormViewStore）：按页、只在内存。跨阈值全部复位；离开项目清机器让位；什么都不落盘。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentFormViewStoreLifetime,
  useAgentFormViewStore,
  writeMachineHold,
  writeNarrowShown,
  writeWindowNarrow,
} from './agentFormViewStore'

const disk = vi.hoisted(() => {
  const map = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => void map.clear(),
    },
  })
  return map
})

beforeEach(() => {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  disk.clear()
})

describe('agentFormViewStore', () => {
  it('每页各一份：改一页不动别的页', () => {
    writeWindowNarrow(true, false)
    writeNarrowShown('creation', 'float')
    writeMachineHold('generation', 'ball')
    const state = useAgentFormViewStore.getState()
    expect(state.narrowBySurface).toEqual({ creation: 'float', storyboard: null, generation: null, preview: null })
    expect(state.machineBySurface).toEqual({ creation: null, storyboard: null, generation: 'ball', preview: null })
  })

  it('跨阈值：各页此刻的覆盖全部作废（宽回来各页是自己存的样子）；同一侧重复报不动', () => {
    writeWindowNarrow(true, false)
    writeNarrowShown('creation', 'float')
    writeMachineHold('generation', 'open')
    const before = useAgentFormViewStore.getState()
    writeWindowNarrow(true, true)
    expect(useAgentFormViewStore.getState()).toBe(before)
    writeWindowNarrow(false, true)
    const after = useAgentFormViewStore.getState()
    expect(Object.values(after.narrowBySurface).every((value) => value === null)).toBe(true)
    expect(Object.values(after.machineBySurface).every((value) => value === null)).toBe(true)
    expect(after.narrowMotion).toBe('restore')
  })

  it('离开项目：机器让位清掉（它指着这个项目的节点），窗宽和窄窗点开跟着窗口不动', () => {
    writeWindowNarrow(true, false)
    writeNarrowShown('creation', 'float')
    writeMachineHold('generation', 'ball')
    agentFormViewStoreLifetime.releaseProject?.()
    const state = useAgentFormViewStore.getState()
    expect(state.machineBySurface.generation).toBeNull()
    expect(state.windowNarrow).toBe(true)
    expect(state.narrowBySurface.creation).toBe('float')
  })

  it('什么都不落盘', () => {
    writeWindowNarrow(true, true)
    writeNarrowShown('preview', 'ball')
    writeMachineHold('preview', 'open')
    expect(disk.size).toBe(0)
  })
})
