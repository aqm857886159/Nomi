import React from 'react'

// 第三方示例媒体（提示词库 / 技能库里公开示例的封面、视频）的可用性记账——本次会话内的唯一 owner。
//
// 这些地址不归我们管：来源站点会删、会按网络环境防盗链（推特示例在部分网络下回 403，已有条目被删成 404）。
// 失败一次就记下：①各处统一显示「示例已失效」，不留黑框；②同一个地址本次会话不再请求——
// 虚拟列表来回滚动会反复挂载卡片，每挂一次就多一条失败请求刷进控制台。
const broken = new Set<string>()

export function markRemoteExampleMediaBroken(url: string | undefined): void {
  if (url) broken.add(url)
}

export function isRemoteExampleMediaBroken(url: string | undefined): boolean {
  return Boolean(url && broken.has(url))
}

/** 挂在示例媒体元素上：初值读会话记账，onError 记账并切占位。地址变了重新判定。 */
export function useRemoteExampleMedia(url: string | undefined): { broken: boolean; onError: () => void } {
  const [brokenUrl, setBrokenUrl] = React.useState<string | null>(() => (url && broken.has(url) ? url : null))
  const onError = React.useCallback(() => {
    markRemoteExampleMediaBroken(url)
    if (url) setBrokenUrl(url)
  }, [url])
  return { broken: Boolean(url) && (brokenUrl === url || isRemoteExampleMediaBroken(url)), onError }
}
