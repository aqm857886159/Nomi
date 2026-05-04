import React from 'react'
import AgentDiagnosticsContent from './AgentDiagnosticsContent'
import { DesignModal } from '../design'

type AgentDiagnosticsPanelProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  onClose: () => void
}

export default function AgentDiagnosticsPanel(props: AgentDiagnosticsPanelProps): JSX.Element {
  const { className, opened, projectId, onClose } = props

  return (
    <DesignModal
      className={className}
      opened={opened}
      onClose={onClose}
      title="AI 诊断面板"
      centered={false}
      size="xl"
      padding="md"
    >
      <AgentDiagnosticsContent className="agent-diagnostics-panel-stack" opened={opened} projectId={projectId} />
    </DesignModal>
  )
}
