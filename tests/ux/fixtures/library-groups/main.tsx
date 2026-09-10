import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../../src/i18n'
import { V4SkillPopover } from '../../../../src/workbench/ai/v4/AgentPanelV4Composer'
const rows = Array.from({ length: 12 }, (_, i) => ({ id: `variant-${i}`, name: `表情 ${i + 1}`, command: '', desc: `变体 ${i + 1}`, section: '提示词', group: { id: 'fixture-expression', label: '表情' } }))
function Fixture(): JSX.Element {
  const [selected, setSelected] = React.useState('')
  return <main><V4SkillPopover rows={rows} categories={['全部', '提示词']} onSelect={row => setSelected(row.id)} /><output>{selected}</output></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
