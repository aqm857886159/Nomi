import { notifications, notificationsStore } from '@mantine/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { runBrowserPromptExtractionToLibrary } from './browserPromptExtractionRunner'
import type { ProjectExecutionContext } from '../../../workbench/project/projectCanvasReadSurface'

// 渲染层 runner 只备参考图、交给主进程那扇门（browser:prompt-extraction:run），按回话三种结果原地报；
// 弹卡、令牌、温度与 maxTokens 都在主进程（真链路见 electron/browser/prompt/browserPromptExtraction.ipc.integration.test.ts）。
// 文案一律按词典键取值，不抄字面（check:test-copy-literals）。

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  run: vi.fn(),
  readSettings: vi.fn(),
  logError: vi.fn(),
  current: { value: true },
}))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ browser: { runPromptExtraction: mocks.run, readPromptExtractionSettings: mocks.readSettings } }),
}))
vi.mock('../../../workbench/api/promptLibraryApi', () => ({ addUserPrompt: mocks.save, getTextBrain: async () => ({ vendor: 'fixture', modelKey: 'fixture-vl' }) }))
vi.mock('../../../workbench/project/projectCanvasReadSurface', () => ({ isProjectExecutionContextCurrent: () => mocks.current.value }))
vi.mock('../../../desktop/rendererLog', () => ({ logRendererError: mocks.logError }))

const request = { requestId: 'capture-1', sourceType: 'image' as const, modelImageUrl: 'data:image/png;base64,fixture', title: 'Test reference', pageUrl: 'https://example.com/gallery' }
const project = { binding: { projectId: 'project-a' } } as unknown as ProjectExecutionContext
const done = (title: string, prompt: string) => ({ outcome: 'done', result: { status: 'succeeded', raw: { text: JSON.stringify({ title, prompt }) } } })
const b = (key: string, values?: Record<string, string>) => i18n.t(`browserAssets.${key}`, values)

describe('browser extraction runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifications.clean()
    mocks.current.value = true
    mocks.readSettings.mockResolvedValue({ ok: true, settings: null })
    mocks.save.mockResolvedValue(undefined)
  })

  it('hands one narrow request to the main process and saves the result, reporting only through the request host', async () => {
    mocks.run.mockResolvedValue(done('Saved reference', 'A reference image'))
    const present = vi.fn()
    await runBrowserPromptExtractionToLibrary(request, present, null)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    const sent = mocks.run.mock.calls[0][0]
    expect(sent).toMatchObject({
      vendor: 'fixture', modelKey: 'fixture-vl', imageUrl: request.modelImageUrl, mode: 'replicate', projectId: null,
      pageUrl: 'https://example.com/gallery', imageSourceUrl: request.modelImageUrl,
    })
    // 温度与 maxTokens 只在主进程定：渲染层不再带。
    expect(Object.keys(sent).sort()).toEqual(['imageSourceUrl', 'imageUrl', 'mode', 'modelKey', 'pageUrl', 'projectId', 'prompt', 'vendor'])
    expect(present.mock.calls.map(([message]) => message)).toEqual([
      b('extractingPrompt', { mode: i18n.t('browserAssets.extraction.replicate') }),
      b('savedToPromptLibraryNamed', { name: 'Saved reference' }),
    ])
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(notificationsStore.getState().notifications).toHaveLength(0)
  })

  it('card cancelled: says so in place, saves nothing, logs no error', async () => {
    mocks.run.mockResolvedValue({ outcome: 'not-confirmed' })
    const present = vi.fn()
    await runBrowserPromptExtractionToLibrary(request, present, null)
    expect(present.mock.calls.at(-1)?.[0]).toBe(b('promptExtractionCancelled'))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('another extraction card is open: says so in place, saves nothing', async () => {
    mocks.run.mockResolvedValue({ outcome: 'busy' })
    const present = vi.fn()
    await runBrowserPromptExtractionToLibrary(request, present, null)
    expect(present.mock.calls.at(-1)?.[0]).toBe(b('promptExtractionBusy'))
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('a screenshot sends an empty image source (the card writes "page screenshot")', async () => {
    mocks.run.mockResolvedValue({ outcome: 'not-confirmed' })
    await runBrowserPromptExtractionToLibrary({ ...request, sourceType: 'screenshot' }, vi.fn(), null)
    expect(mocks.run.mock.calls[0][0].imageSourceUrl).toBe('')
  })

  it('project switched before the card: cancels the whole extraction, nothing is sent', async () => {
    mocks.readSettings.mockImplementation(async () => { mocks.current.value = false; return { ok: true, settings: null } })
    await runBrowserPromptExtractionToLibrary(request, vi.fn(), project)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('project switched after the card: the paid result is still saved to the (global) prompt library', async () => {
    mocks.run.mockImplementation(async () => { mocks.current.value = false; return done('Harbor', 'A quiet harbor at dawn') })
    const present = vi.fn()
    await runBrowserPromptExtractionToLibrary(request, present, project)
    expect(mocks.run.mock.calls[0][0].projectId).toBe('project-a')
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(present.mock.calls.at(-1)?.[0]).toBe(b('savedToPromptLibraryNamed', { name: 'Harbor' }))
  })

  it('keeps failures with their originating host, strips the IPC wrapper, never emits a global notification', async () => {
    mocks.run.mockRejectedValue(new Error("Error invoking remote method 'browser:prompt-extraction:run': Error: Vision model unavailable; retry"))
    const firstHost = vi.fn()
    const secondHost = vi.fn()
    await Promise.all([
      runBrowserPromptExtractionToLibrary(request, firstHost, null),
      runBrowserPromptExtractionToLibrary({ ...request, requestId: 'capture-2' }, secondHost, null),
    ])
    for (const host of [firstHost, secondHost]) {
      expect(host.mock.calls.at(-1)?.[0]).toContain('Vision model unavailable; retry')
      expect(host.mock.calls.at(-1)?.[0]).not.toContain('Error invoking remote method')
    }
    expect(mocks.save).not.toHaveBeenCalled()
    expect(notificationsStore.getState().notifications).toHaveLength(0)
  })
})
