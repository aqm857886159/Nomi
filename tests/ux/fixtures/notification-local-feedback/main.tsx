// Real components, stores, providers and styles. Only the desktop boundary is a
// deterministic fault fixture; this is component interaction evidence, not a full journey.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@mantine/notifications/styles.css'
import '../../../../src/styles/index.css'
import { notifications, notificationsStore } from '@mantine/notifications'
import { NomiAppProviders } from '../../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../../src/theme/NomiColorSchemeProvider'
import { ConfirmDialogHost } from '../../../../src/design/confirmDialog'
import { CodexLocalImageCard } from '../../../../src/ui/onboarding/CodexLocalImageCard'
import { ProductionRunTaskCard } from '../../../../src/workbench/production/ProductionRunTaskCard'
import { useProductionStatus } from '../../../../src/workbench/production/useProductionStatus'
import TimelineTrack from '../../../../src/workbench/timeline/TimelineTrack'
import { setActiveWorkbenchProjectSaveTarget } from '../../../../src/workbench/project/workbenchProjectSession'
import { useWorkbenchStore } from '../../../../src/workbench/workbenchStore'
import { createDefaultTimeline } from '../../../../src/workbench/timeline/timelineMath'
import { NomiBrowserDialog } from '../../../../src/ui/browser/dialog/NomiBrowserDialog'
import { writeBookmarks } from '../../../../src/ui/browser/dialog/NomiBrowserDialogModel'
import { useToastStore } from '../../../../src/ui/toast'
import type { ProductionRun } from '../../../../electron/productionRun/productionRunTypes'

const controls = { failCodex: true, failProduction: true, enabled: false, commandCalls: 0 }
let run: ProductionRun = {
  schemaVersion: 1, runId: 'run-policy', projectId: 'project-policy', revision: 1,
  status: 'paused', stageId: 'production', playbook: { name: '产品短片', version: '1.0.0' }, origin: { host: 'nomi' },
  policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: 0, maxAttemptsPerJob: 1, minimizeUploads: true },
  budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
  planVersion: 1, snapshotCursor: 0, stages: [{ stageId: 'production', title: '制作', status: 'pending', order: 0 }],
  jobs: [], gates: [], artifacts: [], createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
}
window.nomiDesktop = {
  modelCatalog: { upsertVendor: ({ enabled }: { enabled: boolean }) => {
    if (controls.failCodex) throw new Error('配置文件暂时无法写入，请检查目录权限后重试')
    controls.enabled = enabled
  } },
  productionRuns: {
    list: async () => [run], read: async () => run, events: async () => [],
    command: async () => {
      controls.commandCalls += 1
      if (controls.failProduction) throw new Error('制作记录暂时无法写入，请检查目录权限后重试')
      run = { ...run, revision: run.revision + 1, status: 'running' }
      return { run, events: [] }
    },
  },
} as unknown as NonNullable<typeof window.nomiDesktop>
setActiveWorkbenchProjectSaveTarget({ projectId: run.projectId, projectName: '通知策略验证', canPersist: () => false, saveProject: async () => { throw new Error('Fixture has no project filesystem') }, onSaved: () => {} })
useWorkbenchStore.setState({ timeline: createDefaultTimeline() })

Object.assign(window, { __notificationFixture: {
  recoverCodex: () => { controls.failCodex = false },
  recoverProduction: () => { controls.failProduction = false },
  state: () => ({ ...controls, visible: notificationsStore.getState().notifications.length, queued: notificationsStore.getState().queue.length }),
  clear: () => notifications.clean(),
  timedError: (message: string) => useToastStore.getState().push({ id: 'timed-error', reason: 'disk-full', message, type: 'error', ttl: 1000 }),
} })

function Production() {
  const status = useProductionStatus()
  if (!status.view || !status.production.run) return null
  return <ProductionRunTaskCard projectId={run.projectId} view={status.view} playbookName={run.playbook.name}
    actionError={status.actionError} onPrimaryAction={status.onPrimaryAction} onControl={status.onControl} />
}
if (new URLSearchParams(location.search).get('scenario') === 'browser') writeBookmarks([{ id: 'policy-bookmark', title: 'Policy bookmark', url: 'https://example.com', createdAt: 1 }])

function Stage() {
  const [enabled, setEnabled] = React.useState(false)
  const [action, setAction] = React.useState(0)
  const scenario = new URLSearchParams(location.search).get('scenario') || 'codex'
  const before = new URLSearchParams(location.search).get('phase') === 'before'
  const repeat = () => {
    for (let index = 1; index <= 5; index++) useToastStore.getState().push({
      ...(!before ? { id: 'fixture-background-task' } : {}), reason: 'storage-unavailable',
      message: `后台任务失败 ${index}：请检查文件夹权限`, type: 'error', ttl: false,
      actionLabel: '重试', onAction: () => setAction(index),
    })
  }
  return <main className="min-h-screen bg-nomi-bg p-8 text-nomi-ink">
    <div className="max-w-3xl rounded-nomi-lg border border-nomi-line bg-nomi-paper p-6" data-local-feedback-stage style={{ width: scenario === 'codex' ? 480 : scenario === 'production' ? 380 : undefined }}>
      {scenario === 'browser' ? <NomiBrowserDialog opened onClose={() => {}} /> : null}
      {scenario === 'codex' ? <CodexLocalImageCard enabled={enabled} onChanged={() => setEnabled(controls.enabled)} detailMode /> : null}
      {scenario === 'production' ? <Production /> : null}
      {scenario === 'timeline' ? <TimelineTrack track={useWorkbenchStore.getState().timeline.tracks.find(track => track.type === 'audio')!} /> : null}
      {scenario === 'repeat' ? <><button className="rounded-nomi-sm border border-nomi-line px-3 py-2" onClick={repeat}>Repeat five</button><button className="ml-2 rounded-nomi-sm border border-nomi-line px-3 py-2" onClick={() => useToastStore.getState().push({ id: 'fixture-background-task', reason: 'storage-unavailable', message: '后台任务失败：请检查文件夹权限', type: 'error', ttl: false })}>Repeat once</button><output className="ml-2" data-action-result>{action}</output></> : null}
    </div><ConfirmDialogHost />
  </main>
}
createRoot(document.getElementById('root')!).render(<NomiColorSchemeProvider><NomiAppProviders><Stage /></NomiAppProviders></NomiColorSchemeProvider>)
