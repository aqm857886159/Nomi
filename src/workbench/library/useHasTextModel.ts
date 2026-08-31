import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import { getTextBrain } from '../api/promptLibraryApi'

/**
 * 「文本大脑是否**真能用**」——库页状态条 / 空库提示行 / 上手清单第一步 / 创作助手错误分支的单一数据源。
 * null = 未知（查询中），不渲染告警（避免闪条）；查询失败同样不报警，状态条只在确证缺失时出现。
 * Web 端无桌面桥，视为已接入（不吓人）。
 *
 * 为什么不是「catalog 有没有 enabled 的 text 模型」（2026-08-25 走查根因）：那只证「登记在册」，
 * 不证「key 解得开」。safeStorage 解密失败时（locked：密文在、当前宿主身份读不动）catalog 仍显示
 * 该模型 enabled → 旧判据打勾/放行，可真实生成必失败（报 "No local text model is configured"）。
 * 这里改用 getTextBrain()——它背后是 agentChatV2.chooseTextModel（解不出 key 就跳过该候选），
 * **与真实拆镜头/提示词优化同一份可用性判据**（P1 不另造探测）。解得出大脑=true，locked/未配=false。
 */
export function useHasTextModel(): { hasTextModel: boolean | null; refresh: () => void } {
  const [hasTextModel, setHasTextModel] = React.useState<boolean | null>(null)
  const refresh = React.useCallback(() => {
    if (!getDesktopBridge()) {
      setHasTextModel(true)
      return
    }
    getTextBrain()
      .then((brain) => setHasTextModel(brain !== null))
      .catch(() => setHasTextModel(true))
  }, [])
  React.useEffect(() => {
    refresh()
    // 模型目录变更（OnboardingDrawer.refresh 广播）→ 立即重查，状态条/弱入口当场翻面
    window.addEventListener('nomi-model-catalog-changed', refresh)
    return () => window.removeEventListener('nomi-model-catalog-changed', refresh)
  }, [refresh])
  return { hasTextModel, refresh }
}
