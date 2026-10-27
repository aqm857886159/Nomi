import React from 'react'
import { create } from 'zustand'
import { logRendererWarn } from '../../desktop/rendererLog'
import { declareStoreLifetime } from '../project/storeLifetime'

/**
 * 「把光标放进常驻 Agent 的输入框」的一次请求。Mod+J、点开小球、小球右键「浮窗 / 停靠」、面板头部三选一、
 * 空态起手句都走这一扇门。
 *
 * 输入框只有它的主人（ProjectAgentResidentShell，手里有编辑器实例）聚焦得了，请求方不认识输入框长什么样。
 * 之前外壳在页面里按标签名找 `#project-agent-resident textarea`：10-12 输入框换成 TipTap 之后页里没有 textarea，
 * 找不到就什么也不做，Mod+J 打开 Agent 后焦点一直留在 BODY（docs/fixes/2026-10-27-agent-composer-focus.root-cause.json）。
 *
 * 为什么是一份小状态而不是直接调：小球形态下面板挂在看不见的容器里，形态切过去要等下一次提交才挪到可见处，
 * 按下那一帧聚焦必然落空。请求留着，主人每帧试一次，焦点真的进了编辑器才算数；试满 COMPOSER_FOCUS_FRAME_BUDGET
 * 帧还不行就丢掉并记一条日志——不在用户已经去点别处之后再把焦点抢回来。
 */
type ResidentComposerFocusState = { request: number | null }

export const useResidentComposerFocusStore = create<ResidentComposerFocusState>(() => ({ request: null }))

/**
 * 寿命：`request` 是 project——它是「这个项目的面板该拿焦点」；切到别的项目后还没取走的请求不该落到新项目的面板上。
 * 切项目 / 关项目时清回 null。（序号是模块内计数器，不是 store 字段。）
 */
export const residentComposerFocusStoreLifetime = declareStoreLifetime({
  store: 'useResidentComposerFocusStore',
  fields: { request: 'project' },
  releaseProject: () => useResidentComposerFocusStore.setState({ request: null }),
})

/** 约半秒（60fps）。形态切换后面板一两帧内就挪到可见处；再久说明面板根本没挂出来，别再等。 */
export const COMPOSER_FOCUS_FRAME_BUDGET = 30

let seq = 0

export function requestResidentComposerFocus(): void {
  seq += 1
  useResidentComposerFocusStore.setState({ request: seq })
}

/**
 * 输入框的主人调。有请求且 `focus` 就绪时每帧调一次 `focus`；它返回 true（焦点真的进了编辑器）才清掉请求。
 * 新请求顶掉旧请求：旧的那一轮停下，新的从头计帧。
 */
export function useResidentComposerFocusRequest(focus: (() => boolean) | null): void {
  const pending = useResidentComposerFocusStore((state) => state.request)
  React.useEffect(() => {
    if (pending === null || !focus) return undefined
    let attempts = 0
    let frame = 0
    const attempt = () => {
      if (useResidentComposerFocusStore.getState().request !== pending) return
      if (focus()) {
        useResidentComposerFocusStore.setState({ request: null })
        return
      }
      attempts += 1
      if (attempts < COMPOSER_FOCUS_FRAME_BUDGET) {
        frame = requestAnimationFrame(attempt)
        return
      }
      useResidentComposerFocusStore.setState({ request: null })
      logRendererWarn('resident-composer-focus-expired', { attempts })
    }
    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [focus, pending])
}
