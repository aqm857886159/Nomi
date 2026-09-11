// 「全自动」档的两件配套（2026-09-10 用户拍板 · 增量 2）：**切进去要二次确认**、**开着时有常驻提醒**。
//
// 为什么切档要多问一句：另外两档每一步都会在介入槽里现身，用户不可能忘了自己开着什么；
// 「全自动」的特征恰恰是「什么都不问」——它一旦被误点，界面上不会有任何东西提醒他。
// 那句确认文案里最重要的一半是**它仍然会问什么**（付费、不可逆），因为用户对全自动最合理的
// 恐惧就是「它会不会偷偷把钱花了」。答案摆在按下去之前，比事后翻档位说明省一整趟。
//
// 为什么确认卡不是新组件：换档本身是**可撤销**的（再点一下就回来了），所以它就是介入槽的
// `approval-reversible` 档。唯一的差别是标题左边那颗 ✓ 不画（`hideIcon`）——这张卡的标题是一句
// 问句，问句前面顶着一个对勾读起来像「已经切好了」，记号和它要说的事正好相反（用户 2026-09-10 拍板）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { InterventionData, PermissionTier } from './agentPanelV4Types'

export type AgentPanelAutoMode = Readonly<{
  /** 待确认的切档卡。`undefined` = 此刻没有在问。 */
  slot: InterventionData | undefined
  /** 提醒条要不要渲染（`project` 档 + 本会话没被叉掉）。 */
  bannerVisible: boolean
  /** 拦在 `setPermission` 前面：切到全自动先问一句，其余档位直接放行。 */
  request: (tier: PermissionTier) => void
  confirm: () => void
  cancel: () => void
  dismissBanner: () => void
}>

export function useAgentPanelAutoMode(
  permission: PermissionTier,
  setPermission: (tier: PermissionTier) => void,
): AgentPanelAutoMode {
  const { t } = useTranslation()
  const [asking, setAsking] = React.useState(false)
  // 叉掉只影响**这一会话的这一条横幅**，档位一动不动。所以它是组件状态，不落盘：
  // 「我这次不想看见它」和「我以后都不想看见它」是两句不同的话，用户说的是前一句。
  const [dismissed, setDismissed] = React.useState(false)

  const request = React.useCallback((tier: PermissionTier) => {
    if (tier === 'project' && permission !== 'project') {
      setAsking(true)
      return
    }
    setAsking(false)
    setPermission(tier)
  }, [permission, setPermission])

  const slot: InterventionData | undefined = asking
    ? Object.freeze({
        kind: 'approval-reversible' as const,
        hideIcon: true as const,
        title: t('agentPanelV4.autoModeConfirmTitle'),
        summary: t('agentPanelV4.autoModeConfirmBody'),
        confirmLabel: t('agentPanelV4.autoModeConfirmOk'),
      })
    : undefined

  return {
    slot,
    bannerVisible: permission === 'project' && !dismissed,
    request,
    confirm: () => {
      setAsking(false)
      setDismissed(false)
      setPermission('project')
    },
    cancel: () => setAsking(false),
    dismissBanner: () => setDismissed(true),
  }
}
