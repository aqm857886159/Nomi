import React from 'react'

import type { ModelSettingsPage } from './modelSettingsNavigation'

/**
 * 外部（今天只有设置页「素材上传通道」卡）要求模型工作区直接落到某一家的接入页。
 *
 * 带 `token` 而不是只带 vendorKey：模型工作区首次访问后**保持挂载**（见 SettingsDialog 的
 * modelsMounted），若只看 vendorKey，用户返回首页后再点一次「去配置」就什么都不会发生——
 * 请求值没变，effect 不再跑。token 每次点击都换，于是连点也每次都重新打开。
 */
export type ModelPageRequest = { vendorKey: string; token: number } | { section: 'model-assistance'; token: number } | null

export function useModelPageRequest(
  request: ModelPageRequest,
  openPage: (next: ModelSettingsPage) => void,
): void {
  const handledToken = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!request || handledToken.current === request.token) return
    handledToken.current = request.token
    openPage('vendorKey' in request
      ? { type: 'platformConnect', vendorKey: request.vendorKey }
      : { type: 'home', assistedRequest: request.token })
  }, [request, openPage])
}
