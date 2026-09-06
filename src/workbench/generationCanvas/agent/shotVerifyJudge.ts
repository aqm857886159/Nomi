// 镜级 verify 的真实 deps(impure 接线)—— 把 shotVerifyRunner 的注入口接到 app 现成基建:
//   · extractFrame：复用抽帧 IPC(getDesktopBridge().video.extractFrame,which:'first')→ nomi-local 首帧 URL；
//   · judge：复用 agent 的 mode:'chat' 多模态 single-shot 链路,非新建视觉 IPC；
//   · visionAvailable：默认 true，靠 judge 的逐镜 try/catch 优雅降级(非多模态模型 → 解析失败 → 跳过该镜)。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排，架构决策已锁定）。

import { getDesktopBridge } from '../../../desktop/bridge'
import { shotVerifySessionKey } from '../../ai/agentSessionKey'
import { runSingleShotAgent } from '../../ai/agentLoopMode'
import { readWindowUrlParam } from '../../windowUrlParam'
import type { ShotVerifyDeps } from './shotVerifyRunner'

/**
 * Resolve a renderer-owned local frame to the main-owned asset identity before
 * enqueueing an ephemeral Agent request. Host deliberately ignores display-only
 * attachment URLs; the claim is the capability admission that lets the main
 * process rehydrate the canonical bytes. Keeping this lookup here also covers
 * extracted video frames, which are written to the same asset index.
 */
async function resolveFrameAssetClaim(projectId: string, frameImageUrl: string): Promise<{ assetId: string } | undefined> {
  if (!frameImageUrl.startsWith('nomi-local://') || !projectId) return undefined
  const list = getDesktopBridge()?.assets?.list
  if (!list) return undefined
  const result = await list({ projectId, limit: 500 })
  const asset = result?.items?.find((candidate) => {
    const data = candidate && typeof candidate === 'object' && candidate.data && typeof candidate.data === 'object'
      ? candidate.data as Record<string, unknown>
      : null
    return candidate?.projectId === projectId && data?.url === frameImageUrl && typeof candidate.id === 'string'
  })
  if (!asset || typeof asset.id !== 'string' || !asset.id.trim()) {
    throw new Error('shot_verify_frame_asset_unresolved')
  }
  return { assetId: asset.id }
}

/** 真实 deps 工厂(渲染层环境)。无桌面桥(非 Electron)→ extractFrame 抛错,被 runner 逐镜 catch 跳过。
 * 调用方在校验开始时传入项目 id，保证异步审片期间切项目也不会把旧镜头写进新会话；
 * 无显式参数仅为旧调用/独立预览保留 URL 兜底。 */
export function makeShotVerifyDeps(projectIdInput?: string): ShotVerifyDeps {
  const projectId = typeof projectIdInput === 'string'
    ? projectIdInput.trim()
    : (readWindowUrlParam('projectId') || '')
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
      // 每镜判断独立：ephemeral 纯多模态请求不会读写任何会话历史，
      // 避免上一镜的图/判决污染本镜上下文(偏判)。
      const attachmentClaim = await resolveFrameAssetClaim(projectId, frameImageUrl)
      const response = await runSingleShotAgent({
        featureKey: shotVerifySessionKey(projectId),
        prompt,
        displayPrompt: prompt.slice(0, 40),
        ...(projectId ? { projectId } : {}),
        skillKey: 'workbench.shot-verify',
        skillName: '镜级画面校验',
        attachments: [{ url: frameImageUrl, contentType: 'image/png', fileName: 'shot-frame.png', kind: 'image' }],
        ...(attachmentClaim ? { attachmentClaims: [{ ...attachmentClaim, version: 1 }] } : {}),
      })
      return response.text ?? ''
    },
    // 默认视觉开;非多模态模型 → judge 返回非 JSON,runner 逐镜 catch 跳过(降级仅结构校验)。
    visionAvailable: () => true,
  }
}
