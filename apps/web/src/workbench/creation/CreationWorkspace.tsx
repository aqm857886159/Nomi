import React from 'react'
import CreationAiPanel from './CreationAiPanel'
import WorkbenchEditor from './WorkbenchEditor'

export default function CreationWorkspace(): JSX.Element {
  return (
    <section className="workbench-creation" aria-label="创作区">
      <WorkbenchEditor />
      <CreationAiPanel />
    </section>
  )
}
