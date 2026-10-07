import React from 'react'
import { logRendererError } from '../../../desktop/rendererLog'
import { takeUnclassifiedProviderFailures } from '../lane/laneCommandFailure'
import type { V4FlowItem } from './agentPanelV4Types'

/**
 * 「认不出」的服务商报文留一份诊断日志——**在 effect 里、按条目 id 去重只记一次**。
 * 投影在 `useMemo` 里每个流式快照都重算，副作用放在那里同一条错误曾记了 28 次。
 */
export function useLogUnclassifiedProviderFailures(items: readonly V4FlowItem[]): void {
  const logged = React.useRef(new Set<string>())
  React.useEffect(() => {
    for (const diagnostic of takeUnclassifiedProviderFailures(items, logged.current)) {
      logRendererError('lane-unclassified-failure', undefined, { code: null, diagnostic })
    }
  }, [items])
}
