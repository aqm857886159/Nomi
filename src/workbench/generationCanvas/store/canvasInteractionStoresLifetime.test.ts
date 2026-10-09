import { describe, expect, it } from 'vitest'
import { releaseWorkbenchProjectRuntimeState } from '../../project/releaseWorkbenchProjectSession'
import { requestNodePromptFocus, useNodePromptFocusStore } from '../nodes/nodePromptFocus'
import { enterCanvasPickMode, useCanvasPickModeStore } from './canvasPickMode'

// 寿命声明（check:store-lifetime）：这两个 store 里装的都是「当前项目里某张卡的 id / 闭包」，切项目必须清。
describe('canvas interaction stores are project-scoped', () => {
  it('a pending prompt-focus request does not survive a project switch', () => {
    requestNodePromptFocus('node-of-old-project')
    expect(useNodePromptFocusStore.getState().request?.nodeId).toBe('node-of-old-project')
    releaseWorkbenchProjectRuntimeState()
    expect(useNodePromptFocusStore.getState().request).toBeNull()
  })

  it('pick mode does not survive a project switch (and does not call back into the old project)', () => {
    let cancelled = 0
    enterCanvasPickMode({ eligible: () => true, onPick: () => undefined, onCancel: () => { cancelled += 1 } })
    expect(useCanvasPickModeStore.getState().request).not.toBeNull()
    releaseWorkbenchProjectRuntimeState()
    expect(useCanvasPickModeStore.getState().request).toBeNull()
    expect(cancelled).toBe(0)
  })
})
