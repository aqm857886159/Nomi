// 镜级 verify 的真实 deps(impure 接线)—— 把 shotVerifyRunner 的注入口接到 app 现成基建:
//   · extractFrame：复用抽帧 IPC(getDesktopBridge().video.extractFrame,which:'first')→ nomi-local 首帧 URL；
//   · judge：复用 agent 的 mode:'chat' 多模态链路(sendWorkbenchAiMessage + 图作 attachment),非新建视觉 IPC；
//   · visionAvailable：默认 true，靠 judge 的逐镜 try/catch 优雅降级(非多模态模型 → 解析失败 → 跳过该镜)。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排，架构决策已锁定）。

import { getDesktopBridge } from '../../../desktop/bridge'
import { sendWorkbenchAiMessage } from '../../ai/workbenchAiClient'
import { clearWorkbenchAgentSession } from '../../../api/desktopClient'
import { getAssistantModelPref } from '../../ai/assistantModelPref'
import { readWindowUrlParam } from '../../windowUrlParam'
import type { ShotVerifyDeps } from './shotVerifyRunner'

/** verify 用独立会话键(与创作/生成区线程隔离,不污染用户对话历史)。 */
function verifySessionKey(): string {
  return `nomi:shot-verify:${readWindowUrlParam('projectId') || 'local'}`
}

/** 真实 deps 工厂(渲染层环境)。无桌面桥(非 Electron)→ extractFrame 抛错,被 runner 逐镜 catch 跳过。 */
export function makeShotVerifyDeps(): ShotVerifyDeps {
  const projectId = readWindowUrlParam('projectId') || ''
  return {
    extractFrame: async (videoUrl: string): Promise<string> => {
      const extract = getDesktopBridge()?.video?.extractFrame
      if (!extract) throw new Error('当前环境不支持抽帧(需桌面端)')
      const result = await extract({ videoUrl, which: 'first', projectId })
      const url = result?.url
      if (!url) throw new Error('抽帧未返回 URL')
      return url
    },
    judge: async (prompt: string, frameImageUrl: string): Promise<string> => {
      const sessionKey = verifySessionKey()
      // 每镜判断必须独立:清会话,避免上一镜的图/判决污染本镜上下文(偏判)。
      await clearWorkbenchAgentSession(sessionKey).catch(() => {})
      const pref = getAssistantModelPref()
      const response = await sendWorkbenchAiMessage(
        {
          prompt,
          displayPrompt: prompt.slice(0, 40),
          sessionKey,
          ...(projectId ? { projectId } : {}),
          skillKey: 'workbench.shot-verify',
          skillName: '镜级画面校验',
          mode: 'chat', // 无工具的纯多模态判断
          ...(pref ? { agentModelKey: pref.modelKey, agentVendorKey: pref.vendorKey } : {}),
          attachments: [{ url: frameImageUrl, contentType: 'image/png', fileName: 'shot-frame.png', kind: 'image' }],
        },
        {},
      )
      return response.text ?? ''
    },
    // 默认视觉开;非多模态模型 → judge 返回非 JSON,runner 逐镜 catch 跳过(降级仅结构校验)。
    visionAvailable: () => true,
  }
}
