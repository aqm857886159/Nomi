/**
 * 模型设置面板的「网络」行（应用内代理设置 · 见 docs/plan/2026-08-01-in-app-proxy-setting.md）。
 *
 * 为什么在这个位置、为什么收起只有一行：真实面板实测 320×841（已顶到 maxHeight 上限），
 * 用户接了几家之后卡片就撑满整屏。放底部 = 用户需要它的那一刻（连不上、着急）要滚过十几张卡。
 * 故放在能力条之下、「已接入」之上，收起态只占一行。
 *
 * 收起态那颗状态胶囊本身就是答案：用户真正的问题是「Nomi 到底走没走我的梯子」，
 * 这个信息以前**只存在于 console log**，界面零暴露。顺带把「探到 SOCKS 但本版用不了」
 * 这个以前完全隐形的状态也显出来了。
 *
 * 组头字号字色沿用面板既有的 section header 规格（text-micro / ink-40 + chevron），
 * 不另立视觉语言（P1）。（原文引用的 AvailableGroup.tsx 已于 2026-08-26 作为死代码删除。）
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge, type DesktopProxyMode, type DesktopProxyStatus } from '../../desktop/bridge'

type TestState = { phase: 'idle' | 'running' | 'ok' | 'partial' | 'fail'; ms: number; ok: number; total: number }

const MODES: readonly DesktopProxyMode[] = ['system', 'custom', 'off']

/**
 * 状态胶囊要显示的语义。**unsupported 优先于一切**：探到 SOCKS 时用户其实开着代理，
 * 却按直连在跑——这时说「直连」是误导，必须说「检测到 SOCKS · 未生效」（同 describeNetworkError 的取舍）。
 * 纯函数，直测。
 */
export function proxyPillTone(status: DesktopProxyStatus): { key: string; ok: boolean } {
  if (status.unsupported) return { key: 'pillUnsupported', ok: false }
  if (status.mode === 'off' || !status.activeUrl) {
    // fake-ip 本地代理（Clash/Surge TUN）：app 侧看不到任何代理配置，说「直连」是**错的**——
    // 流量其实全被本机解析器映射进 198.18/15 交给代理。同 unsupported 的取舍：宁可多说一句，
    // 也不能让用户以为 Nomi 没走他的梯子（2026-09-06 验收现场）。
    if (status.localProxyDetected) return { key: 'pillLocalProxy', ok: true }
    return { key: 'pillDirect', ok: false }
  }
  return { key: status.mode === 'custom' ? 'pillCustom' : 'pillSystem', ok: true }
}

export function NetworkSection(): JSX.Element | null {
  const { t } = useTranslation()
  const bridge = getDesktopBridge()
  const proxy = bridge?.proxy
  const [expanded, setExpanded] = React.useState(false)
  const [status, setStatus] = React.useState<DesktopProxyStatus | null>(null)
  const [draftUrl, setDraftUrl] = React.useState('')
  /**
   * UI 上选中的档，可以**领先于**已落盘的档。
   * 必须分开：normalizeProxyPrefs 有「custom 但没填地址 → 按 system 跑」的保护（防止把用户
   * 静默扔进直连），若 UI 直接跟随落盘值，点「自定义」会当场被弹回「跟随系统」——
   * 用户永远没机会输入地址（2026-08-01 走查点进去才发现）。
   */
  const [uiMode, setUiMode] = React.useState<DesktopProxyMode | null>(null)
  const [test, setTest] = React.useState<TestState>({ phase: 'idle', ms: 0, ok: 0, total: 0 })
  const bodyId = React.useId()

  React.useEffect(() => {
    if (!proxy) return
    let alive = true
    void proxy.get().then((res) => {
      if (!alive || !res?.status) return
      setStatus(res.status)
      setDraftUrl(res.status.customUrl)
    })
    return () => {
      alive = false
    }
  }, [proxy])

  const apply = React.useCallback(
    async (mode: DesktopProxyMode, customUrl: string) => {
      if (!proxy) return
      const res = await proxy.set({ mode, customUrl })
      if (res?.status) {
        setStatus(res.status)
        setDraftUrl(res.status.customUrl)
      }
      setTest({ phase: 'idle', ms: 0, ok: 0, total: 0 }) // 换了代理，上一次的测试结论就作废了
    },
    [proxy],
  )

  /** 点分段：先切 UI 档（立刻给反馈），有内容可落盘才落盘。 */
  const selectMode = React.useCallback(
    (next: DesktopProxyMode) => {
      setUiMode(next)
      // 自定义且还没填地址：只切 UI 露出输入框，不落盘（落了也会被归一化弹回 system）。
      if (next === 'custom' && !draftUrl.trim()) return
      // 非 custom 档也把 draftUrl 传下去：切走再切回来不用重打（归一化会保留它）。
      void apply(next, draftUrl)
    },
    [apply, draftUrl],
  )

  const runTest = React.useCallback(async () => {
    if (!proxy) return
    setTest({ phase: 'running', ms: 0, ok: 0, total: 0 })
    const res = await proxy.test().catch(() => null)
    const result = res?.result
    const tried = result?.tried ?? []
    const okCount = tried.filter((attempt) => attempt.ok).length
    // 「部分可达」必须和「全通」分开说：上传链是有序 fallback，只剩一个能用时**图还送得出去**，
    // 但兜底没了——2026-07-31 那次整链失败正是「litterbox 自己 500 + 没代理够不到 tmpfiles」。
    // 只报一个绿色「可达」会让用户以为一切正常，等真断了才发现早就只剩一条腿。
    setTest(
      !result?.ok
        ? { phase: 'fail', ms: 0, ok: okCount, total: tried.length }
        : okCount < tried.length
          ? { phase: 'partial', ms: result.ms, ok: okCount, total: tried.length }
          : { phase: 'ok', ms: result.ms, ok: okCount, total: tried.length },
    )
  }, [proxy])

  // 桥不在（网页预览/测试环境）或还没读到状态：整行不渲染，别给一个点不动的空壳。
  if (!proxy || !status) return null

  const pill = proxyPillTone(status)
  const selectedMode = uiMode ?? status.mode
  const sourceLabel =
    status.source === 'env'
      ? t('onboardingProviders.drawer.network.sourceEnv')
      : status.source === 'custom'
        ? t('onboardingProviders.drawer.network.sourceCustom')
        : t('onboardingProviders.drawer.network.sourceSystem')
  const hint = status.unsupported
    ? t('onboardingProviders.drawer.network.hintUnsupported')
    : selectedMode === 'off'
      ? t('onboardingProviders.drawer.network.hintOff')
      : selectedMode === 'custom'
        ? t('onboardingProviders.drawer.network.hintCustom')
        : status.activeUrl
          ? t('onboardingProviders.drawer.network.hintSystem', { url: status.activeUrl, source: sourceLabel })
          : t('onboardingProviders.drawer.network.hintSystemNone')

  return (
    <div className="flex flex-col border-t border-nomi-line-soft pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left px-0.5 py-1.5 group"
      >
        <span className="text-micro font-semibold text-nomi-ink-40">
          {t('onboardingProviders.drawer.network.label')}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-micro font-semibold',
            'bg-nomi-ink-10 text-nomi-ink-60',
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', pill.ok ? 'bg-workbench-success' : 'bg-nomi-ink-30')} />
          {t(`onboardingProviders.drawer.network.${pill.key}`)}
        </span>
        <span className="flex-1" />
        <IconChevronDown
          size={15}
          stroke={1.8}
          className={cn(
            'shrink-0 text-nomi-ink-30 transition-transform duration-150 group-hover:text-nomi-ink-40',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-2 pt-0.5 pb-1">
          <div className="flex gap-0.5 p-0.5 bg-nomi-ink-05 rounded-nomi-sm">
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={selectedMode === mode}
                onClick={() => selectMode(mode)}
                className={cn(
                  'flex-1 py-1 rounded-nomi-sm text-caption transition-colors',
                  selectedMode === mode
                    ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-[0_0_0_1px_var(--nomi-line)]'
                    : 'text-nomi-ink-60 hover:text-nomi-ink',
                )}
              >
                {t(`onboardingProviders.drawer.network.mode${mode === 'system' ? 'System' : mode === 'custom' ? 'Custom' : 'Off'}`)}
              </button>
            ))}
          </div>

          {selectedMode === 'custom' ? (
            <input
              type="text"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              onBlur={() => void apply('custom', draftUrl)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void apply('custom', draftUrl)
              }}
              placeholder={t('onboardingProviders.drawer.network.placeholder')}
              className="w-full h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent"
            />
          ) : null}

          <p className="text-micro text-nomi-ink-40 leading-relaxed">{hint}</p>

          {status.localProxyDetected ? (
            <p data-network-local-proxy="true" className="text-micro text-nomi-ink-60 leading-relaxed">
              {t('onboardingProviders.drawer.network.localProxyDetected', { address: status.localProxySample || '198.18.x.x' })}
            </p>
          ) : null}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={test.phase === 'running'}
              className="shrink-0 h-7 px-2.5 rounded-nomi-sm border border-nomi-line text-caption text-nomi-ink hover:bg-nomi-ink-05 disabled:opacity-50"
            >
              {t('onboardingProviders.drawer.network.test')}
            </button>
            <span
              className={cn(
                'text-micro',
                test.phase === 'ok' && 'text-workbench-success',
                test.phase === 'fail' && 'text-workbench-danger',
                test.phase === 'partial' && 'text-nomi-ink-60',
                (test.phase === 'idle' || test.phase === 'running') && 'text-nomi-ink-40',
              )}
            >
              {test.phase === 'running'
                ? t('onboardingProviders.drawer.network.testing')
                : test.phase === 'ok'
                  ? t('onboardingProviders.drawer.network.testOk', { ms: test.ms })
                  : test.phase === 'partial'
                    ? t('onboardingProviders.drawer.network.testPartial', { ok: test.ok, total: test.total })
                    : test.phase === 'fail'
                      ? t('onboardingProviders.drawer.network.testFail')
                      : t('onboardingProviders.drawer.network.testIdle')}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
