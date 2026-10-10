// taskApi 只转交调用方给出的任务项目身份：不读「当前项目」补它，也不许请求里另夹一个不同的项目。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWorkbenchTaskResultByVendor, runWorkbenchTaskByVendor, runWorkbenchTextTaskStream } from './taskApi'

const run = vi.fn(async () => ({ id: 't', kind: 'text_to_image', status: 'queued', assets: [], raw: {} }))
const result = vi.fn(async () => ({ vendor: 'v', result: { id: 't', kind: 'text_to_image', status: 'queued', assets: [], raw: {} } }))
const runTextStream = vi.fn(async () => ({ streamId: 's' }))

function installDesktop(): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { nomiDesktop: {
    tasks: { run, result, runTextStream, onTextEvent: () => () => undefined, cancelTextStream: vi.fn() },
  } } })
}
afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); vi.clearAllMocks() })

describe('task project identity is explicit at the taskApi boundary', () => {
  it('submits exactly the given project and refuses a request that smuggles another one', async () => {
    installDesktop()
    await runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'p', extras: { modelKey: 'm' } }, 'project-a')
    expect(run).toHaveBeenCalledWith({ vendor: 'v', request: { kind: 'text_to_image', prompt: 'p', extras: { modelKey: 'm', projectId: 'project-a' } } })

    await expect(runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'p', extras: { projectId: 'project-b' } }, 'project-a'))
      .rejects.toThrow('TASK_PROJECT_MISMATCH')
    expect(run).toHaveBeenCalledOnce()
  })

  it('an explicit null means the task belongs to no project; nothing is filled in', async () => {
    installDesktop()
    await runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'p', extras: { modelKey: 'm' } }, null)
    expect(run).toHaveBeenCalledWith({ vendor: 'v', request: { kind: 'text_to_image', prompt: 'p', extras: { modelKey: 'm' } } })
    void runWorkbenchTextTaskStream('v', { kind: 'prompt_refine', prompt: 'p', extras: {} }, null)
    await vi.waitFor(() => expect(runTextStream).toHaveBeenCalledWith({ vendor: 'v', request: { kind: 'prompt_refine', prompt: 'p', extras: {} }, streamId: expect.stringMatching(/^text-/) }))
  })

  it('polling repeats the task identity it is given and nothing else', async () => {
    installDesktop()
    await fetchWorkbenchTaskResultByVendor({ taskId: 't', vendor: 'v', projectId: 'project-a' })
    await fetchWorkbenchTaskResultByVendor({ taskId: 't', vendor: 'v', projectId: null })
    expect(result.mock.calls).toEqual([[{ taskId: 't', vendor: 'v', projectId: 'project-a' }], [{ taskId: 't', vendor: 'v' }]])
  })
})
