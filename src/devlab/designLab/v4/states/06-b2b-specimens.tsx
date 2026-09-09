import React from 'react'
import type { LabState } from '../../labScreen'
import { B2bBrandAudit, B2bFrames, B2bProcessSpecimen, B2bResizeSpecimen } from '../b2bSpecimens'

export const B2B_SPECIMEN_STATES: readonly LabState[] = [
  { id: 'b2b-process-running', name: 'B2b 待拍板 · 进行中', source: '2026-09-09-agent-process-state-and-panel-frame.md · C34', mirrors: 'src/workbench/ai/v4/AgentPanelV4Panel.tsx:263', coverage: 'component-only', span: 2, render: () => <B2bProcessSpecimen phase="running" /> },
  { id: 'b2b-process-done', name: 'B2b 待拍板 · 完成摘要', source: '2026-09-09-agent-process-state-and-panel-frame.md · C34', mirrors: 'src/workbench/ai/v4/AgentPanelV4Panel.tsx:263', coverage: 'component-only', span: 2, render: () => <B2bProcessSpecimen phase="done" /> },
  { id: 'b2b-process-failed', name: 'B2b 待拍板 · 失败独立卡', source: '2026-09-09-agent-process-state-and-panel-frame.md · C34', mirrors: 'src/workbench/ai/v4/AgentPanelV4Panel.tsx:263', coverage: 'component-only', span: 2, render: () => <B2bProcessSpecimen phase="failed" /> },
  { id: 'b2b-panel-narrow', name: 'B2b 待拍板 · 窄面板', source: '2026-09-09-agent-process-state-and-panel-frame.md · C30', mirrors: 'src/workbench/generation/GenerationWorkspace.tsx:163', coverage: 'component-only', span: 2, render: () => <B2bResizeSpecimen initial={300} /> },
  { id: 'b2b-panel-wide', name: 'B2b 待拍板 · 宽面板', source: '2026-09-09-agent-process-state-and-panel-frame.md · C30', mirrors: 'src/workbench/generation/GenerationWorkspace.tsx:163', coverage: 'component-only', span: 2, render: () => <B2bResizeSpecimen initial={600} /> },
  { id: 'b2b-frames-unified', name: 'B2b 待拍板 · 四面同框', source: '2026-09-09-agent-process-state-and-panel-frame.md · C31', mirrors: ['src/workbench/creation/CreationWorkspace.tsx:39', 'src/workbench/creation/storyboard/StoryboardWorkspace.tsx:47', 'src/workbench/generation/GenerationWorkspace.tsx:163', 'src/workbench/preview/PreviewWorkspace.tsx:282'], coverage: 'component-only', span: 2, render: () => <B2bFrames /> },
  { id: 'b2b-logo-audit', name: 'B2b 待拍板 · 品牌对账', source: '2026-09-09-agent-process-state-and-panel-frame.md · C32', mirrors: ['src/ui/app-shell/NomiAppBar.tsx:119', 'src/workbench/ai/v4/AgentPanelV4Panel.tsx:244'], coverage: 'component-only', span: 2, render: () => <B2bBrandAudit /> },
]
