// 参数面板数字控件的隔离夹具：把 InlineParameterBar 挂在真实 React + Mantine + i18n 里，
// 用合成的参数声明喂它——因为内置模型目录里没有任何 number 型参数（那条路只有自定义能力契约
// 与导入的 ComfyUI 工作流走得到），拿真 catalog 反而验不到这一段。
//
// 验的是两件事：
//   ① 小数打得进去（受控框逐键回写会把 `0.` 冲成 `0`，第四位永远输不完）
//   ② 0–1 且未声明步长的参数不进滑杆（默认步长 1 只切得出两个端点，滑杆等于废掉）
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { ReactFlow, ReactFlowProvider, useStoreApi } from '@xyflow/react'
import '@mantine/core/styles.css'
import '@xyflow/react/dist/style.css'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../../src/i18n'
import type { ModelOption } from '../../../../src/config/models'
import type { ModelParameterControl } from '../../../../src/config/modelCatalogMeta'
import InlineParameterBar from '../../../../src/workbench/generationCanvas/nodes/InlineParameterBar'
import { parseControlInput } from '../../../../electron/shared/videoCapabilities/paramValue'

const workflowOption: ModelOption = {
  value: 'comfyui-imported-workflow',
  modelKey: 'comfyui-imported-workflow',
  vendor: 'comfyui-local',
  label: '导入的工作流',
}
const remoteWorkflowOption: ModelOption = {
  ...workflowOption, value: 'remote-imported-workflow', vendor: 'fixture-remote', vendorName: 'Remote fixture',
}

/** 自由数值：无候选项、无区间 → 走面板里的输入行。百万像素就是这一类。 */
const megapixelsControl: ModelParameterControl = {
  key: 'megapixels',
  label: '百万像素',
  type: 'number',
  binding: 'parameter',
  options: [],
  defaultValue: 1,
}

/** 0–1 且未声明步长：修 min/max 解析后它开始带上区间，必须**不**退化成两档滑杆。 */
const denoiseControl: ModelParameterControl = {
  key: 'denoise',
  label: '去噪强度',
  type: 'number',
  binding: 'parameter',
  options: [],
  min: 0,
  max: 1,
  defaultValue: 1,
}

/** 有可用步长的区间：仍然该是滑杆——证明我们没有把「滑杆全砍」当修法。 */
const durationControl: ModelParameterControl = {
  key: 'duration',
  label: '时长',
  type: 'number',
  binding: 'parameter',
  options: [],
  min: 1,
  max: 10,
  step: 1,
  defaultValue: 5,
}

const fixtureQuery = new URLSearchParams(window.location.search)

function NumericControls(): JSX.Element {
  const [selectedModel, setSelectedModel] = React.useState(workflowOption)
  const modelOptions = fixtureQuery.has('providers') ? [workflowOption, remoteWorkflowOption] : [workflowOption]
  const [meta, setMeta] = React.useState<Record<string, unknown>>({
    megapixels: 1,
    denoise: 1,
    duration: 5,
  })
  // 记录每一次回写，用来证明「打字途中没有把 0. 当成 0 提交过」。
  const [commits, setCommits] = React.useState<string[]>([])

  const handleParameterControlChange = (control: ModelParameterControl, value: string): void => {
    const parsed = parseControlInput(control, value)
    setCommits((current) => [...current, `${control.key}=${String(parsed)}`])
    setMeta((current) => ({ ...current, [control.key]: parsed }))
  }

  return (
    <>
      <InlineParameterBar
        modelOptions={modelOptions}
        modelCatalogStatus={{ message: 'ready' }}
        renderedControls={fixtureQuery.has('single')
          ? [durationControl] : [megapixelsControl, denoiseControl, durationControl]}
        selectedModelOption={selectedModel}
        archetype={null}
        meta={meta}
        onModelChange={(value, vendor) => {
          const option = modelOptions.find(option => option.value === value && (!vendor || option.vendor === vendor))
          if (option) setSelectedModel(option)
        }}
        onCatalogControlChange={() => undefined}
        onParameterControlChange={handleParameterControlChange}
      />
      <output data-testid="megapixels-value">{String(meta.megapixels)}</output>
      <output data-testid="denoise-value">{String(meta.denoise)}</output>
      <output data-testid="duration-value">{String(meta.duration)}</output>
      <output data-testid="commit-log">{commits.join('|')}</output>
      <output data-testid="selected-provider">{selectedModel.vendor}</output>
    </>
  )
}

// Mount the original parameter component inside the actual framework NodeWrapper.
// The fixture adds no keyboard suppression: portal ownership belongs to the component.
const numericNodeTypes = { numeric: NumericControls }
const numericNodes = [{ id: 'numeric-node', type: 'numeric', position: { x: 80, y: 80 },
  selected: true, data: {}, style: { width: 320 } }]
function NumericFlowFixture(): JSX.Element {
  const store = useStoreApi()
  React.useEffect(() => {
    Object.assign(window, { numericFlowSnapshot: () => {
      const state = store.getState()
      return { ownsNodes: state.hasDefaultNodes, position: state.nodeLookup.get('numeric-node')?.position }
    } })
  }, [store])
  return <div style={{ width: 800, height: 600 }}>
    <ReactFlow defaultNodes={numericNodes} nodeTypes={numericNodeTypes} deleteKeyCode={null} />
  </div>
}

function Fixture(): JSX.Element {
  return <I18nextProvider i18n={i18n}><MantineProvider>
    <main style={{ padding: fixtureQuery.has('flow') ? 40 : 200 }}>
      {fixtureQuery.has('flow') ? <ReactFlowProvider><NumericFlowFixture /></ReactFlowProvider> : <NumericControls />}
    </main>
  </MantineProvider></I18nextProvider>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
