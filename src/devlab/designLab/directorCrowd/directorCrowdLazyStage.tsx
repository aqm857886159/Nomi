// 设计实验室 · 「导演台 · 群众并进加人」格子的轻量外壳：先登记就绪持有，再动态加载真正的取景台（理由见 directorCrowdLabKit 头注释）。
import React, { type JSX } from 'react'
import type { AppLocale } from '../../../i18n'
import { holdDesignLabReady } from '../labReadyHold'
import type { CrowdCell } from './directorCrowdLabKit'

const Stage = React.lazy(() => import('./directorCrowdLabKit').then((module) => ({ default: module.DirectorCrowdStage })))

export function DirectorCrowdLazyStage({ cell, locale }: { cell: CrowdCell; locale: AppLocale }): JSX.Element {
  const [release] = React.useState(() => holdDesignLabReady('director-crowd'))
  return (
    <React.Suspense fallback={null}>
      <Stage cell={cell} locale={locale} release={release} />
    </React.Suspense>
  )
}
