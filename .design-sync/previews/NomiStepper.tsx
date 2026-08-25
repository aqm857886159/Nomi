// NomiStepper —— 工作区三段切换：创作 → 生成 → 预览。
// 这是 Nomi 主界面顶部的**唯一**导航（不是通用 tabs）：档位写死三个，标签来自 i18n
// （workspace.creationTab / generationTab / previewTab），所以不用也不能传 label。
// 形态：胶囊槽 + 选中项 paper 浮起带轻影，与 NomiSegmented 同一套视觉语言。
import React from 'react'
import { NomiStepper } from 'nomi'

type Mode = 'creation' | 'generation' | 'preview'

function Demo({ initial }: { initial: Mode }): JSX.Element {
  const [mode, setMode] = React.useState<Mode>(initial)
  return <NomiStepper value={mode} onChange={setMode} />
}

/** 三个档位各自选中时的样子（这就是它的全部状态空间）。 */
export const EachStage = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
    <Demo initial="creation" />
    <Demo initial="generation" />
    <Demo initial="preview" />
  </div>
)

/** 真实用法：工作区顶栏居中，两侧是品牌与项目名。 */
export const InWorkbenchHeader = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      width: 560,
      padding: '10px 14px',
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <span style={{ font: '600 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)', whiteSpace: 'nowrap' }}>
      海边黄昏
    </span>
    <Demo initial="generation" />
    <span style={{ font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)', whiteSpace: 'nowrap' }}>
      6 镜
    </span>
  </div>
)
