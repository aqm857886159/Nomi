import React from 'react'
import { useTranslation } from 'react-i18next'
import type { CustomCallTestResult } from '../../desktop/modelCatalogBridgeTypes'
import { getDesktopBridge } from '../../desktop/bridge'
import type { CustomCallTarget } from './CustomCallEditor'
import type { CustomCallCatalogModel, CustomCallScriptMode } from './customCallScriptModes'

export function useCustomCallCatalogModel(
  target: CustomCallTarget | null,
  targetKey: string,
): CustomCallCatalogModel | null {
  const bridge = getDesktopBridge()
  const [catalogModel, setCatalogModel] = React.useState<CustomCallCatalogModel | null>(null)
  // 目录读是异步 IPC：按 targetKey 读一次落进 state（原始键作依赖：父组件刷新不许冲掉正在编辑的草稿）。
  React.useEffect(() => {
    setCatalogModel(null)
    if (!target || !bridge) return
    let alive = true
    void Promise.resolve(bridge.modelCatalog.listModels({ vendorKey: target.vendorKey }))
      .then((models) => {
        if (!alive) return
        const found = (models as CustomCallCatalogModel[]).find(
          (model) => model.vendorKey === target.vendorKey && model.modelKey === target.modelKey,
        )
        setCatalogModel(found ?? null)
      })
      .catch(() => {
        if (alive) setCatalogModel(null)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, targetKey])
  return catalogModel
}

export type CustomCallTestRunState =
  | { phase: 'idle' }
  | { phase: 'running' | 'cancelling'; runId: string }
  | ({ phase: 'done' } & CustomCallTestResult)

const failedResult = (message: string): CustomCallTestRunState => ({
  phase: 'done',
  ok: false,
  assets: [],
  errorMessage: message,
  transcript: [],
  durationMs: 0,
})

export function useCustomCallTestRun({
  target,
  script,
  selectedMode,
}: {
  target: CustomCallTarget | null
  script: string
  selectedMode: CustomCallScriptMode | null
}): {
  test: CustomCallTestRunState
  runTest: () => Promise<void>
  cancelTest: () => Promise<void>
} {
  const { t } = useTranslation()
  const bridge = getDesktopBridge()
  const [test, setTest] = React.useState<CustomCallTestRunState>({ phase: 'idle' })
  const generationRef = React.useRef(0)
  const activeRunIdRef = React.useRef<string | null>(null)
  const identityKey = `${target?.vendorKey ?? ''}\0${target?.modelKey ?? ''}\0${selectedMode?.id ?? ''}\0${script}`

  React.useEffect(() => {
    generationRef.current += 1
    const activeRunId = activeRunIdRef.current
    activeRunIdRef.current = null
    if (activeRunId) void bridge?.modelCatalog.customCallTestCancel?.({ runId: activeRunId })
    setTest({ phase: 'idle' })
    return () => {
      const staleRunId = activeRunIdRef.current
      activeRunIdRef.current = null
      generationRef.current += 1
      if (staleRunId) void bridge?.modelCatalog.customCallTestCancel?.({ runId: staleRunId })
    }
  }, [bridge, identityKey])

  const runTest = React.useCallback(async () => {
    if (!target || !bridge?.modelCatalog.customCallTestRun || !script.trim()) return
    if (test.phase === 'running' || test.phase === 'cancelling') return
    const generation = generationRef.current + 1
    const testRunId = `custom-call-test-${globalThis.crypto.randomUUID()}`
    generationRef.current = generation
    activeRunIdRef.current = testRunId
    setTest({ phase: 'running', runId: testRunId })
    try {
      const snapshot = await bridge.modelCatalog.customCallTestRun({
        runId: testRunId,
        vendorKey: target.vendorKey,
        modelKey: target.modelKey,
        script,
        ...(selectedMode ? { taskKind: selectedMode.taskKind, modeId: selectedMode.id } : {}),
      })
      if (generation !== generationRef.current) return
      const result = snapshot?.result
      setTest(result ? { phase: 'done', ...result } : failedResult(t('onboardingProviders.customCall.testMissingResult')))
    } catch (error) {
      if (generation !== generationRef.current) return
      setTest(failedResult(error instanceof Error ? error.message : String(error)))
    } finally {
      if (activeRunIdRef.current === testRunId) activeRunIdRef.current = null
    }
  }, [target, bridge, script, selectedMode, test.phase, t])

  const cancelTest = React.useCallback(async () => {
    const testRunId = activeRunIdRef.current
    if (!testRunId || !bridge?.modelCatalog.customCallTestCancel) return
    generationRef.current += 1
    setTest({ phase: 'cancelling', runId: testRunId })
    try {
      await bridge.modelCatalog.customCallTestCancel({ runId: testRunId })
      if (activeRunIdRef.current === testRunId) {
        setTest(failedResult(t('onboardingProviders.customCall.testCancelled')))
      }
    } catch (error) {
      if (activeRunIdRef.current === testRunId) {
        setTest(failedResult(error instanceof Error ? error.message : String(error)))
      }
    } finally {
      if (activeRunIdRef.current === testRunId) activeRunIdRef.current = null
    }
  }, [bridge, t])

  return { test, runTest, cancelTest }
}
