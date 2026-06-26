/**
 * 即梦会员（dreamina 官方 CLI）接入卡。
 *
 * 让「有即梦高级会员、没别的 API key」的用户也能用自己的会员积分在 Nomi 跑 Seedance 2.0 视频
 * ——接得多是为了没渠道的用户也用得上（包容性），不与深度冲突。
 *
 * 设备码 OAuth 登录：扫码确认 → 用会员积分生成。诚实标门槛：生成需「高级会员 / maestro vip」这一特定档
 * （非任意即梦会员，光充积分不行）——非会员明示，不让用户点了干等（D4 effect-first / 诚实交付）。
 */
import React from 'react'
import { IconMovie, IconExternalLink, IconCircleCheck, IconQrcode, IconDownload, IconCopy, IconCheck } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'

export type DreaminaStatus = { installed: boolean; loggedIn: boolean; totalCredit: number | null; vipLevel: string; notMaestroVip: boolean }
type DeviceFlow = { verificationUri: string; userCode: string; deviceCode: string; expiresAt: string }

type DreaminaMemberCardProps = {
  /** 连接状态由父组件统一 fetch 后下传（单一来源，见 plan §4.1）；null = 不显（加载中/老 preload）。 */
  status: DreaminaStatus | null
  /** 安装/登录/退出后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
}

export function DreaminaMemberCard({ status, onChanged }: DreaminaMemberCardProps): JSX.Element | null {
  const dreamina = getDesktopBridge()?.dreamina
  const [busy, setBusy] = React.useState(false)
  const [flow, setFlow] = React.useState<DeviceFlow | null>(null)
  const [polling, setPolling] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState('')
  const cancelPoll = React.useRef(false)

  React.useEffect(() => () => { cancelPoll.current = true }, [])

  // 加载中 / 老 preload（无 dreamina 口）：整卡不显，避免坏入口。
  if (!dreamina || !status) return null

  const handleInstall = async () => {
    setBusy(true); setError('')
    try {
      const r = await dreamina.install()
      if (r.ok) { toast('即梦 CLI 安装完成', 'success'); onChanged() }
      else setError(r.message)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const runPollLoop = async (deviceCode: string) => {
    cancelPoll.current = false
    setPolling(true)
    try {
      // checklogin 单次最多阻塞 ~60s；循环续查直到成功/出错/用户取消（设备码有效期内）。
      for (let i = 0; i < 8 && !cancelPoll.current; i += 1) {
        const r = await dreamina.loginPoll(deviceCode)
        if (r.status === 'success') { toast('即梦登录成功', 'success'); setFlow(null); onChanged(); return }
        if (r.status === 'error') { setError(r.message); return }
        // pending → 继续下一轮
      }
      if (!cancelPoll.current) setError('登录超时，请重新发起。')
    } finally { setPolling(false) }
  }

  const handleLogin = async () => {
    setBusy(true); setError('')
    try {
      const f = await dreamina.loginStart()
      setFlow(f)
      void runPollLoop(f.deviceCode)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const handleLogout = async () => {
    cancelPoll.current = true
    setBusy(true); setError('')
    try { await dreamina.logout(); setFlow(null); onChanged(); toast('已退出即梦登录', 'success') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const handleCopyLink = () => {
    if (!flow) return
    void navigator.clipboard.writeText(flow.verificationUri).then(() => {
      setCopied(true); toast('授权链接已复制', 'success'); window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const cardStatus: 'ok' | 'todo' = status.installed && status.loggedIn ? 'ok' : 'todo'
  const statusLabel = !status.installed ? '未安装' : !status.loggedIn ? '待登录' : status.notMaestroVip ? '非高级会员' : '已登录'

  return (
    <FoldableModelCard
      glyph={<IconMovie size={16} stroke={1.6} />}
      glyphTone="ink"
      name="即梦会员"
      subtitle="用即梦高级会员积分跑 Seedance 2.0 视频"
      status={cardStatus}
      statusLabel={statusLabel}
      defaultExpanded={false}
    >
      {/* 未安装 CLI */}
      {!status.installed ? (
        <>
          <div className="text-caption text-nomi-ink-60 leading-relaxed">
            即梦用官方命令行工具接入。一键装好后，扫码登录就能用你的会员积分在 Nomi 里出视频。
          </div>
          <button
            type="button" onClick={handleInstall} disabled={busy}
            className={cn('w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-body-sm font-semibold',
              'inline-flex items-center justify-center gap-1.5 hover:bg-nomi-accent disabled:opacity-50')}
          >
            <IconDownload size={15} stroke={1.8} />{busy ? '安装中…' : '一键安装即梦 CLI'}
          </button>
          <div className="text-micro text-nomi-ink-30">官方源 jimeng.jianying.com，安装到 ~/.local/bin。</div>
        </>
      ) : flow ? (
        /* 设备码登录中：显链接 + 验证码 */
        <>
          <div className="flex items-start gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
            <IconQrcode size={17} className="shrink-0 mt-0.5 text-nomi-accent" />
            <div className="min-w-0">
              <div className="text-body-sm font-semibold text-nomi-ink">扫码 / 点链接授权</div>
              <div className="text-caption text-nomi-ink-60 mt-0.5">用即梦 App 或浏览器打开下面链接，确认授权。要登录有<strong>高级会员</strong>的账号。</div>
            </div>
          </div>
          <button
            type="button" onClick={() => window.open(flow.verificationUri, '_blank', 'noopener')}
            className="w-full h-9 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink inline-flex items-center justify-center gap-1.5 hover:border-nomi-accent hover:text-nomi-accent"
          >
            打开授权页<IconExternalLink size={14} stroke={1.6} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-caption text-nomi-ink-60">验证码 <code className="text-nomi-ink font-mono">{flow.userCode.slice(0, 12)}…</code></div>
            <button type="button" onClick={handleCopyLink} className="h-8 px-2 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-accent">
              {copied ? <IconCheck size={13} stroke={1.8} /> : <IconCopy size={13} stroke={1.6} />}{copied ? '已复制' : '复制链接'}
            </button>
          </div>
          <div className="text-caption text-nomi-ink-40">{polling ? '等待你确认授权…确认后自动接住。' : '授权完成后稍候。'}</div>
          <button type="button" onClick={() => { cancelPoll.current = true; setFlow(null) }} className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger">取消</button>
        </>
      ) : status.loggedIn ? (
        /* 已登录。注意：user_credit 成功 ≠ 能生成（「not maestro vip」只在生成时才报），故这里**不承诺**
           能出片，始终诚实标门槛——避免给非会员账号误报「可以出片」（D4）。 */
        <>
          <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-success-soft)] px-3 py-2.5">
            <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success" />
            <div className="min-w-0">
              <div className="text-body-sm font-semibold text-nomi-ink">
                已登录即梦
                {status.totalCredit != null ? <span className="text-nomi-ink-60 font-normal"> · 积分 {status.totalCredit}</span> : null}
              </div>
              <div className="text-caption text-nomi-ink-60 mt-0.5">
                在生成画布选「即梦 Seedance 2.0（会员）」出视频。注意：生成需即梦<strong>高级会员（maestro vip）</strong>档——非此档会被拒（光充积分不够）。
              </div>
            </div>
          </div>
          <button type="button" onClick={handleLogout} disabled={busy} className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50">退出登录</button>
        </>
      ) : (
        /* 已装未登录 */
        <>
          <div className="text-caption text-nomi-ink-60 leading-relaxed">
            扫码登录你的即梦账号，用会员积分在 Nomi 出视频。<strong>生成需高级会员（maestro vip）</strong>这一档。
          </div>
          <button
            type="button" onClick={handleLogin} disabled={busy}
            className={cn('w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-body-sm font-semibold',
              'inline-flex items-center justify-center gap-1.5 hover:bg-nomi-accent disabled:opacity-50')}
          >
            <IconQrcode size={15} stroke={1.8} />{busy ? '发起中…' : '扫码登录即梦'}
          </button>
        </>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
