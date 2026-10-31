import React from 'react'
import { createRoot } from 'react-dom/client'
import { useCanvasSelectionDrag } from '../../../src/workbench/generationCanvas/components/useCanvasSelectionDrag'
import { cancelCanvasDraggingWithin } from '../../../src/workbench/generationCanvas/components/canvasDraggingFlag'
import { useGenerationCanvasStore as store } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'
import {
  setCanvasEventSinkForTests,
  type CanvasShadowEvent,
} from '../../../src/workbench/generationCanvas/events/canvasEventEmitter'
import { createProjectSessionTestHarness } from '../../../src/workbench/project/projectSessionTestHarness'
import { workspaceInputAttributes } from '../../../src/workbench/shortcutSurface'

const session = createProjectSessionTestHarness()
await session.open('original-project')
const events: CanvasShadowEvent[] = []
setCanvasEventSinkForTests((batch) => events.push(...batch))
function restoreGraph() {
  store.getState().restoreSnapshot({
    nodes: ['one', 'two'].map((id, index) => ({
      id,
      kind: 'image',
      title: id,
      prompt: id,
      categoryId: 'shots',
      groupId: 'group',
      position: { x: 10 + index * 50, y: 20 },
    })),
    edges: [],
    groups: [
      {
        id: 'group',
        name: 'group',
        categoryId: 'shots',
        nodeIds: ['one', 'two'],
        createdAt: 1,
        updatedAt: 1,
        frameBounds: { x: 0, y: 0, w: 100, h: 100 },
      },
    ],
  })
  store.getState().selectNodes(['one', 'two'])
}
restoreGraph()
let changeReadOnly: (value: boolean) => void
let changeHidden: (value: boolean) => void
let changeTwoGone: (value: boolean) => void
function Harness() {
  const [readOnly, setReadOnly] = React.useState(false)
  const [hidden, setHidden] = React.useState(false)
  const [twoGone, setTwoGone] = React.useState(false)
  changeTwoGone = setTwoGone
  changeReadOnly = setReadOnly
  changeHidden = setHidden
  const stageRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (hidden) cancelCanvasDraggingWithin(stageRef.current)
  }, [hidden])
  const state = store.getState()
  const actions = useCanvasSelectionDrag({
    readOnly,
    zoomRef: React.useRef(1),
    captureHistory: state.captureHistory,
    commitPersistedChange: state.commitPersistedChange,
    moveGroupNodes: state.moveGroupNodes,
    selectNodes: state.selectNodes,
  })
  return (
    <div ref={stageRef} className="generation-canvas-v2__stage" id="stage" hidden={hidden}>
      {/* 假 React Flow 包裹层：属性名必须与真库一致（RF 12 打 `data-id`），
          这里曾写成 `data-node-id`，把生产里同名的选择器 bug 一起锁成了「绿」。 */}
      {['one', 'two'].filter((id) => !(twoGone && id === 'two')).map((id) => (
        <div key={id} className="react-flow__node" data-id={id}>
          <div className="generation-canvas-react-flow__node-shell" />
        </div>
      ))}
      <div
        id="group"
        data-group-id="group"
        onPointerDown={(event) => actions.handleGroupFramePointerDown(event, 'group')}
      >
        Group
      </div>
    </div>
  )
}
const host = document.querySelector('#root')!
for (const [name, value] of Object.entries(workspaceInputAttributes(true))) host.setAttribute(name, value)
host.setAttribute('data-shortcut-surface', 'canvas')
const root = createRoot(host)
root.render(<Harness />)
Object.assign(window, {
  selectionDragFixture: {
    snapshot: () => ({
      nodes: store.getState().nodes,
      groups: store.getState().groups,
      revision: store.getState().persistRevision,
      events: [...events],
      dragging: document.querySelector('#stage')?.getAttribute('data-dragging') ?? null,
      groupPreview: (document.querySelector('#group') as HTMLElement | null)?.style.translate ?? '',
      memberPreview:
        (document.querySelector('[data-id="one"] .generation-canvas-react-flow__node-shell') as HTMLElement | null)
          ?.style.translate ?? '',
    }),
    unmount: () => root.unmount(),
    readOnly: () => changeReadOnly(true),
    hide: () => changeHidden(true),
    // 拖动途中成员被删：store 里删掉、DOM 里卸载（真实路径：deleteNode + React Flow 卸载壳）。
    dropMember: () => {
      store.getState().deleteNode('two')
      changeTwoGone(true)
    },
    // 数拖动期间 document.querySelectorAll 的调用次数（门岗：帧内不许做全局查询）。
    countQueries: () => {
      const original = document.querySelectorAll.bind(document)
      const counter = { calls: 0 }
      document.querySelectorAll = ((selector: string) => {
        counter.calls += 1
        return original(selector)
      }) as typeof document.querySelectorAll
      Object.assign(window, { __queryCounter: counter })
    },
    queryCalls: () => (window as unknown as { __queryCounter?: { calls: number } }).__queryCounter?.calls ?? 0,
    replaceGraph: restoreGraph,
    invalidateProject: () => session.close(),
    switchProject: async () => {
      await session.open('replacement-project')
      restoreGraph()
    },
    undo: () => store.getState().undo(),
    redo: () => store.getState().redo(),
  },
})
