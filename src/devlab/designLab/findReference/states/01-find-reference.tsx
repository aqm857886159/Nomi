import React from 'react'
import type { LabState } from '../../labScreen'
import { FindReferenceStage } from '../findReferenceLabKit'

const SOURCE = 'docs/plan/2026-09-10-pr619-finish.md · 四画板逐项对账'
export const FIND_REFERENCE_STATES: readonly LabState[] = [
  {
    id: 'fr-main',
    name: 'Main · 真实归一结果',
    source: SOURCE,
    coverage: 'shell',
    render: () => <FindReferenceStage  />,
  },
  {
    id: 'fr-empty-entry',
    name: 'EmptyEntry · 现役空态',
    source: SOURCE,
    coverage: 'shell',
    render: () => <FindReferenceStage emptyEntry />,
  },
  {
    id: 'fr-platform-evidence',
    name: 'PlatformEvidence · 三平台证据',
    source: SOURCE,
    coverage: 'shell',
    render: () => <FindReferenceStage allPlatforms />,
  },
  {
    id: 'fr-fail-states',
    name: 'FailStates · 英文检索空结果',
    source: SOURCE,
    coverage: 'shell',
    render: () => <FindReferenceStage emptyResults />,
  },
]
