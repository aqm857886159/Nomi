// 门岗自检（R17「加规则必须先验它会红」）：用修复前的形状喂它，必须红；修复后的形状必须绿。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanCapabilityLifecycle } from './check-capability-lifecycle.mjs'

const STORE = `
export interface WorkbenchState {
  activeDocumentId: string
  creationDocumentTools: CreationDocumentTools | null
  setCreationDocumentTools: (tools: CreationDocumentTools | null) => void
  setActiveDocumentId: (id: string) => void
}
export const useWorkbenchStore = create<WorkbenchState>()((set) => ({
  activeDocumentId: '',
  creationDocumentTools: null,
  setCreationDocumentTools: (creationDocumentTools) => { set({ creationDocumentTools }) },
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),
  hydrate: (documents, activeId) => set({ activeDocumentId: activeId }),
}))
`
const EDITOR = `
export default function WorkbenchEditor() {
  const setCreationDocumentTools = useWorkbenchStore((state) => state.setCreationDocumentTools)
  const setActiveDocumentId = useWorkbenchStore((state) => state.setActiveDocumentId)
  React.useEffect(() => {
    setCreationDocumentTools(toolsApi)
    setActiveDocumentId('x')
    return () => setCreationDocumentTools(null)
  }, [])
  return null
}
`
const APP_PRE_FIX = `
export default function NomiStudioApp() {
  React.useEffect(() => registerProjectCanvasReadSurface(projectSurface, read, ({ documentId, scope }) => {
    const store = useWorkbenchStore.getState()
    const tools = store.creationDocumentTools
    if (!tools || store.activeDocumentId !== documentId) throw new SurfacePortWireError('surface_port_stale')
    return { text: tools.readFullText() }
  }), [])
  return null
}
`
const APP_POST_FIX = `
export default function NomiStudioApp() {
  React.useEffect(() => registerProjectCanvasReadSurface(projectSurface, read, readDocumentThroughSessionPort), [])
  return null
}
`
const RELEASE = `
export function releaseWorkbenchProjectRuntimeState() {
  useWorkbenchStore.setState({ creationDocumentTools: null, activeDocumentId: '' })
}
`
const SURFACE_DEF = `export function registerProjectCanvasReadSurface(coordinator, readSnapshot, readDocument) {}`

function files(app, extra = {}) {
  return new Map(Object.entries({
    'src/workbench/workbenchStore.ts': STORE,
    'src/workbench/creation/WorkbenchEditor.tsx': EDITOR,
    'src/workbench/NomiStudioApp.tsx': app,
    'src/workbench/project/releaseWorkbenchProjectSession.ts': RELEASE,
    'src/workbench/project/projectCanvasReadSurface.ts': SURFACE_DEF,
    ...extra,
  }))
}

test('修复前的形状会红：执行路径读了只由编辑器 useEffect 发布的 creationDocumentTools（置 null 的释放不算 owner）', () => {
  const { executionPaths, violations } = scanCapabilityLifecycle(files(APP_PRE_FIX))
  assert.deepEqual(executionPaths, ['src/workbench/NomiStudioApp.tsx'])
  assert.deepEqual(violations.map((v) => [v.at, v.field]), [['src/workbench/NomiStudioApp.tsx:5', 'creationDocumentTools']])
  assert.match(violations[0].publishedBy.join(' '), /WorkbenchEditor\.tsx:6/)
})

test('activeDocumentId 虽也被组件 useEffect 设过，但 store 自己的 hydrate 动作是会话级 owner——不算', () => {
  const { violations } = scanCapabilityLifecycle(files(APP_PRE_FIX))
  assert.ok(violations.every((v) => v.field !== 'activeDocumentId'))
})

test('修复后的形状绿：执行路径不再读任何组件发布的字段', () => {
  const { violations } = scanCapabilityLifecycle(files(APP_POST_FIX))
  assert.deepEqual(violations, [])
})

test('一个非组件模块给字段赋非 null 值 = 有会话级 owner，即使执行路径读它也绿', () => {
  const owner = { 'src/workbench/project/documentSessionPort.ts': `export function activate() { useWorkbenchStore.setState({ creationDocumentTools: createBaseline() }) }` }
  const { violations } = scanCapabilityLifecycle(files(APP_PRE_FIX, owner))
  assert.deepEqual(violations, [])
})

test('找不到执行路径文件时抛错，不假绿', () => {
  const only = new Map([['src/workbench/workbenchStore.ts', STORE], ['src/workbench/creation/WorkbenchEditor.tsx', EDITOR]])
  assert.throws(() => scanCapabilityLifecycle(only), /门岗前提不成立/)
})
