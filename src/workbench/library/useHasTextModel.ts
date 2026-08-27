import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import { getTextBrain } from '../api/promptLibraryApi'

/**
 * 「文本大脑是否**已配置**」——库页状态条 / 空库提示行 / 上手清单第一步 / 创作助手错误分支的单一数据源。
 * null = 未知（查询中），不渲染告警（避免闪条）；查询失败同样不报警，状态条只在确证缺失时出现。
 * Web 端无桌面桥，视为已接入（不吓人）。
 *
 * 首屏只读取 enabled vendor/model 与 enabled/nonempty 凭据记录，不碰 safeStorage。密文能否解开只能在
 * 用户首次真实发送时验证；失败由 Agent 返回 text_model_credential_locked，不能用启动探测阻塞窗口。
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
