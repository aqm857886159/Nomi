import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../desktop/bridge'
import {
  describeVideoPlaybackFailure,
  diagnoseVideoPlaybackFailure,
  logVideoPlaybackFailure,
} from './videoPlaybackDiagnostics'
import { buildVideoPlaybackUrl } from './videoPlaybackUrl'

// 视频播放守卫的共享内核（原先只活在 NodeVideoPlaybackGuard 里，画布节点独享）。
//
// 根因：自愈与诚实报错被绑在「某个 UI 组件」上，而不是绑在「这个资产播不了」这件事上——
// 于是画布节点能自己修好的视频，到了时间轴片段/时间轴预览/点开大图/3D 卡片/文件预览就永远是坏的：
// 那几个面的 onError 要么只 console.log、要么（点开大图）压根没有 handler，用户看到的是
// 纯灰壳/纯黑 + 一个字都没有。任何播放失败（HEVC 存量、供应商 HEVC 产物、失效链接、文件损坏）
// 在那些面上都长成同一副「没反应」的样子，无从判断也无从修。
//
// 收口成 hook 而非再包一层组件：各播放面的 <video> 形态差异很大（DeferredNodeVideo 带并发队列、
// 时间轴片段是缩略图、预览播放器要跟播放头），共用组件必然长出一堆分支；共用「行为」才是单一真相源。
export type VideoPlaybackHeal = {
  /** 实际喂给 <video src> 的地址：自愈成功后自动切到转码产物，调用方无需自己判断。 */
  playbackUrl: string
  onError: React.ReactEventHandler<HTMLVideoElement>
  onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement>
  /** 自愈中的提示文案（非空即应盖一层「修复中」）。 */
  healingText: string
  /** 自愈不了时的人话原因（非空即应盖一层报错）。 */
  failureText: string
}

export function useVideoPlaybackHeal({
  rawUrl,
  onHealed,
}: {
  /** 节点 result.url 原值——诊断探针与自愈都要原始 URL，不要 buildVideoPlaybackUrl 之后的。 */
  rawUrl: string
  /** 自愈成功回调：有持久化去处的面（画布节点/时间轴源节点）借此把新 URL 写回，下次开项目直接好。
   * sourceUrl 是发起自愈时的原始 URL——持久化方必须校验节点当前 result.url 仍是它，防止旧自愈
   * 结论覆盖期间重新生成的新结果。 */
  onHealed?: (healedUrl: string, sourceUrl: string) => void
}): VideoPlaybackHeal {
  const { t } = useTranslation()
  const [failureText, setFailureText] = React.useState('')
  const [healing, setHealing] = React.useState(false)
  const [healedUrl, setHealedUrl] = React.useState('')
  const healAttemptedRef = React.useRef('')
  const onHealedRef = React.useRef(onHealed)
  onHealedRef.current = onHealed
  // 最新 rawUrl 的只读锚点：await 之后用它比对「自愈发起时的 rawUrl」是否已被换掉。
  const rawUrlRef = React.useRef(rawUrl)
  rawUrlRef.current = rawUrl

  // rawUrl 换了（重新生成/换素材）→ 上一轮的失败与自愈结论全部作废，否则旧报错会盖在新视频上。
  React.useEffect(() => {
    setFailureText('')
    setHealing(false)
    setHealedUrl('')
    healAttemptedRef.current = ''
  }, [rawUrl])

  const onError: React.ReactEventHandler<HTMLVideoElement> = (event) => {
    const mediaError = event.currentTarget.error
    void diagnoseVideoPlaybackFailure(rawUrl, mediaError).then(async (diagnostics) => {
      // 诊断在飞时 rawUrl 已被换掉 → 旧结论作废（reset effect 只在换的那一刻跑，拦不住之后 resolve 的写回）。
      if (rawUrlRef.current !== rawUrl) return
      logVideoPlaybackFailure(diagnostics)
      const decodeFailure = diagnostics.mediaErrorCode === 3 || diagnostics.mediaErrorCode === 4
      const ensurePlayable = getDesktopBridge()?.assets?.ensurePlayable
      // 每个 rawUrl 只自愈一次：转码很贵，失败了重试也只会同样失败。
      const alreadyTried = healAttemptedRef.current === rawUrl
      if (decodeFailure && !alreadyTried && rawUrl.startsWith('nomi-local://') && ensurePlayable) {
        healAttemptedRef.current = rawUrl
        setHealing(true)
        try {
          const healed = await ensurePlayable({ url: rawUrl })
          // 自愈在飞时节点被重新生成（rawUrl 已换）→ 旧 healedUrl 不得写回，否则覆盖新结果。
          if (rawUrlRef.current !== rawUrl) return
          const nextUrl = typeof healed?.data?.url === 'string' ? healed.data.url.trim() : ''
          if (nextUrl && nextUrl !== rawUrl) {
            // 本地先切过去，当场就能播；有持久化去处的面再把它写回节点，下次开项目直接好。
            setHealedUrl(nextUrl)
            onHealedRef.current?.(nextUrl, rawUrl)
            setHealing(false)
            setFailureText('')
            return
          }
        } catch {
          // 自愈失败 → 落到下面的诚实报错。
        }
        setHealing(false)
      }
      setFailureText(describeVideoPlaybackFailure(diagnostics))
    })
  }

  const onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement> = () => {
    setFailureText('')
  }

  return {
    playbackUrl: buildVideoPlaybackUrl(healedUrl || rawUrl),
    onError,
    onLoadedMetadata,
    healingText: healing ? t('generationCommon.node.videoRepairing') : '',
    failureText,
  }
}
