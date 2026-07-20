/**
 * 首启开屏动画（spec §3A）。
 *
 * 浅色 / 克制 / 极简：用 Nomi 真实 UI 元素的抽象讲产品理念，不用 AI 大图、不走电影深色。
 * 5 段序列（每段 ~2.6s，总 ~13s）：
 *   1 创作卡 → 2 画布节点卡行 → 3 中卡选中 + 操作 chip → 4 时间轴轨 → 5 真 logo 标版
 * 字幕在底部逐段淡入；右上「跳过 ›」随时可退。
 *
 * 渲染在 React 树内（**不 BodyPortal**——portal 到 body 会丢 --nomi-* token 作用域）。
 * framer-motion AnimatePresence + motion 内联模式，
 * 缓动 [0.22,1,0.36,1]（抄 Scene3DFullscreen.tsx:3680）。token-only，禁非 token px/hex。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../utils/cn'
import { NomiBrand } from '../../design'

type SplashIntroProps = {
  onDone: () => void
}

const EASE = [0.22, 1, 0.36, 1] as const
const SCENE_MS = 2600
const SCENE_COUNT = 5

// 画布点阵背景（spec §3A：radial-gradient(var(--nomi-ink-20) 1px, transparent 1px) 20px）。
const DOT_GRID: React.CSSProperties = {
  backgroundImage: 'radial-gradient(var(--nomi-ink-20) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
}

// ── 配乐：Web Audio 合成柔和音符随段触发（C 大调上行 + 收尾和弦） ──
// TODO: 后换 CC0 mp3（spec §6 待用户提供免版税轻乐），保留 playSceneTone 接口即可平替。
const SCENE_NOTES = [261.63, 329.63, 392.0, 440.0] // C4 E4 G4 A4
const FINALE_CHORD = [261.63, 329.63, 392.0] // C 大三和弦

type AudioRef = { ctx: AudioContext | null }

function playTone(audio: AudioRef, freq: number, when: number, duration: number, peak: number): void {
  const ctx = audio.ctx
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  const t0 = ctx.currentTime + when
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

function playSceneTone(audio: AudioRef, step: number): void {
  if (!audio.ctx) return
  if (step < SCENE_COUNT - 1) {
    playTone(audio, SCENE_NOTES[step] ?? 392.0, 0, 0.9, 0.06)
  } else {
    // 标版：柔和上行和弦收尾
    FINALE_CHORD.forEach((f, i) => playTone(audio, f, i * 0.08, 1.6, 0.05))
  }
}

export function SplashIntro({ onDone }: SplashIntroProps): JSX.Element {
  const { t } = useTranslation()
  const [step, setStep] = React.useState(0)
  const [leaving, setLeaving] = React.useState(false)
  const audioRef = React.useRef<AudioRef>({ ctx: null })
  const doneRef = React.useRef(false)
  const captions = [
    t('onboardingProviders.splash.captions.write'),
    t('onboardingProviders.splash.captions.canvas'),
    t('onboardingProviders.splash.captions.control'),
    t('onboardingProviders.splash.captions.timeline'),
    t('onboardingProviders.splash.captions.brand'),
  ]

  const finish = React.useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    try {
      audioRef.current.ctx?.close()
    } catch {
      /* ignore */
    }
    audioRef.current.ctx = null
    setLeaving(true)
    // 等淡出动画收尾再卸载（与 exit transition 时长对齐）。
    window.setTimeout(onDone, 460)
  }, [onDone])

  // 懒建 AudioContext（Electron 内无 autoplay 限制；浏览器测试环境失败则静默降级）。
  React.useEffect(() => {
    const audio = audioRef.current
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctor) audio.ctx = new Ctor()
    } catch {
      audio.ctx = null
    }
    return () => {
      try {
        audio.ctx?.close()
      } catch {
        /* ignore */
      }
      audio.ctx = null
    }
  }, [])

  // 每段触发配乐。
  React.useEffect(() => {
    if (leaving) return
    playSceneTone(audioRef.current, step)
  }, [step, leaving])

  // state machine：定时推进；走完最后一段自动收尾。
  React.useEffect(() => {
    if (leaving) return
    const id = window.setTimeout(() => {
      if (step < SCENE_COUNT - 1) {
        setStep((s) => s + 1)
      } else {
        finish()
      }
    }, SCENE_MS)
    return () => window.clearTimeout(id)
  }, [step, leaving, finish])

  return (
    <AnimatePresence>
      {!leaving ? (
        <motion.div
          key="splash-intro"
          className={cn(
            'nomi-splash fixed inset-0 z-[60] bg-nomi-bg text-nomi-ink font-nomi-sans',
            'flex flex-col items-center justify-center overflow-hidden select-none',
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
          role="dialog"
          aria-label={t('onboardingProviders.splash.aria')}
        >
          {/* 跳过 */}
          <button
            type="button"
            onClick={finish}
            data-splash-skip="true"
            className={cn(
              'absolute top-7 right-9 inline-flex items-center gap-1 cursor-pointer font-inherit bg-transparent border-0',
              'text-caption text-nomi-ink-40 transition-colors hover:text-nomi-ink',
            )}
          >
            {t('onboardingProviders.splash.skip')}
          </button>

          {/* 舞台：相对视口大尺寸，元素铺开占满，留白克制（草稿 v4）。 */}
          <div
            className="relative flex items-center justify-center w-full px-[6vw]"
            style={{ maxWidth: 'min(1180px, 82vw)', height: 'min(560px, 56vh)' }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                className="w-full flex items-center justify-center"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <SplashScene step={step} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 字幕（中段 1-4 底部；标版段为空字符串故不渲染文字） */}
          <div className="absolute bottom-[9%] left-0 right-0 flex justify-center px-10">
            <AnimatePresence mode="wait">
              <motion.p
                key={step}
                className="text-nomi-ink-60 text-center m-0 leading-snug"
                style={{ fontSize: 'clamp(15px, 1.6vw, 24px)' }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4, ease: EASE, delay: 0.12 }}
              >
                {captions[step]}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* 底部 5 段进度点：当前及之前 accent，其余 tertiary（蓝本） */}
          <div className="absolute bottom-7 left-0 right-0 flex justify-center gap-2">
            {Array.from({ length: SCENE_COUNT }).map((_, i) => (
              <span
                key={i}
                className={cn('rounded-pill transition-colors', i <= step ? 'bg-nomi-accent' : 'bg-nomi-ink-20')}
                style={{ width: 'clamp(16px,1.4vw,22px)', height: '3px' }}
                aria-hidden="true"
              />
            ))}
          </div>
        </motion.div>
      ) : (
        // exit 期间保留覆盖层做淡出（leaving 后 AnimatePresence 走 exit）
        <motion.div
          key="splash-leaving"
          className="fixed inset-0 z-[60] bg-nomi-bg"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.44, ease: EASE }}
          aria-hidden="true"
        />
      )}
    </AnimatePresence>
  )
}

// ── 各段画面（真实元素抽象，token-only） ──

function SplashScene({ step }: { step: number }): JSX.Element {
  switch (step) {
    case 0:
      return <SceneCreationCard />
    case 1:
      return <SceneNodeRow selected={false} />
    case 2:
      return <SceneNodeRow selected />
    case 3:
      return <SceneTimeline />
    default:
      return <SceneBrand />
  }
}

/** 1 创作卡：编辑器抽象——工具点 + Fraunces 标题 + 文字行。占满舞台大半宽。 */
function SceneCreationCard(): JSX.Element {
  const { t } = useTranslation()
  return (
    <motion.div
      className="w-full bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-md"
      style={{ maxWidth: 'min(720px, 68vw)', padding: 'clamp(28px, 3.2vw, 52px)' }}
      initial={{ scale: 0.96 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {/* 顶部 3 个小方点：第 1 深(secondary)、后 2 浅(tertiary)，9px 圆角方 */}
      <div className="flex items-center gap-2 mb-[clamp(20px,2vw,32px)]">
        <span
          className="rounded-nomi-sm bg-nomi-ink-60"
          style={{ width: 'clamp(8px,0.7vw,12px)', height: 'clamp(8px,0.7vw,12px)' }}
        />
        <span
          className="rounded-nomi-sm bg-nomi-ink-30"
          style={{ width: 'clamp(8px,0.7vw,12px)', height: 'clamp(8px,0.7vw,12px)' }}
        />
        <span
          className="rounded-nomi-sm bg-nomi-ink-30"
          style={{ width: 'clamp(8px,0.7vw,12px)', height: 'clamp(8px,0.7vw,12px)' }}
        />
      </div>
      <p
        className="font-nomi-display text-nomi-ink m-0 mb-[clamp(20px,2vw,32px)] leading-snug"
        style={{ fontSize: 'clamp(24px, 3vw, 48px)' }}
      >
        {t('onboardingProviders.splash.sentence')}
      </p>
      {/* 3 行文字线：宽 92%/78%/85%、secondary、高 3px 圆角 */}
      <div className="flex flex-col gap-[clamp(12px,1.1vw,18px)]">
        <span className="rounded-nomi-sm bg-nomi-ink-30" style={{ width: '92%', height: 'clamp(10px,0.9vw,15px)' }} />
        <span className="rounded-nomi-sm bg-nomi-ink-30" style={{ width: '78%', height: 'clamp(10px,0.9vw,15px)' }} />
        <span className="rounded-nomi-sm bg-nomi-ink-30" style={{ width: '85%', height: 'clamp(10px,0.9vw,15px)' }} />
      </div>
    </motion.div>
  )
}

/** 2/3 画布节点卡行：点阵背景 + 3 张节点卡铺满舞台宽；selected 时中卡点亮（无操作 chip）。 */
function SceneNodeRow({ selected }: { selected: boolean }): JSX.Element {
  return (
    <div className="relative w-full flex items-center justify-center py-[clamp(40px,5vh,72px)]">
      <div className="absolute inset-0 rounded-nomi-lg opacity-70" style={DOT_GRID} aria-hidden="true" />
      {/* 卡间距与卡宽随视口放大；上方留 chip 浮出空间，不裁剪。 */}
      <div className="relative w-full flex items-stretch justify-center" style={{ gap: 'clamp(16px,2vw,36px)' }}>
        {[0, 1, 2].map((i) => (
          <NodeCard key={i} index={i} selected={selected && i === 1} />
        ))}
      </div>
    </div>
  )
}

function NodeCard({ index, selected }: { index: number; selected: boolean }): JSX.Element {
  const { t } = useTranslation()
  const labelKeys = ['opening', 'closeup', 'ending'] as const
  return (
    // 外层不裁剪（chip 上浮要留空间）；圆角裁剪只落在内部缩略图块上。
    <motion.div
      className="relative flex-1"
      style={{ maxWidth: 'min(300px, 22vw)' }}
      initial={{ y: 0 }}
      animate={{ y: selected ? -12 : 0 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <div
        className={cn(
          'w-full bg-nomi-paper rounded-nomi overflow-hidden',
          selected ? 'border-2 border-nomi-accent shadow-nomi-md' : 'border border-nomi-line',
        )}
      >
        <div className="aspect-video bg-nomi-ink-05 grid place-items-center">
          <span
            className="rounded-nomi-sm bg-nomi-ink-10"
            style={{ width: 'clamp(28px,2.4vw,44px)', height: 'clamp(28px,2.4vw,44px)' }}
            aria-hidden="true"
          />
        </div>
        <div className="px-[clamp(12px,1.1vw,18px)] py-[clamp(10px,0.9vw,14px)]">
          <p className="text-nomi-ink-60 m-0" style={{ fontSize: 'clamp(12px,1vw,15px)' }}>
            {t(`onboardingProviders.splash.nodes.${labelKeys[index]}`)}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

/**
 * 4 时间轴（蓝本）：一张白卡内两行轨。
 * 画面轨 = 正好 3 个等宽 clip，第 2 个(中间)=accent 半透明，余 secondary 灰；
 * 声音轨 = 一条整轨(单块, tertiary 灰)，不拆 clip。
 */
function SceneTimeline(): JSX.Element {
  const { t } = useTranslation()
  return (
    <motion.div
      className="w-full bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-md flex flex-col gap-[clamp(12px,1.2vw,20px)]"
      style={{ maxWidth: 'min(760px, 70vw)', padding: 'clamp(20px,2.2vw,36px)' }}
      initial={{ scale: 0.96 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {/* 画面轨：3 等宽 clip，中间 accent 半透明 */}
      <TimelineTrack label={t('onboardingProviders.splash.visualTrack')}>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className={cn('flex-1 h-full rounded-nomi-sm', i === 1 ? 'bg-nomi-accent' : 'bg-nomi-ink-20')}
            initial={{ scaleX: 0.7, opacity: 0 }}
            animate={{ scaleX: 1, opacity: i === 1 ? 0.5 : 1 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.1 + i * 0.07 }}
          />
        ))}
      </TimelineTrack>
      {/* 声音轨：一条整轨（tertiary 灰），不拆 clip */}
      <TimelineTrack label={t('onboardingProviders.splash.audioTrack')}>
        <motion.span
          className="flex-1 h-full rounded-nomi-sm bg-nomi-ink-10"
          initial={{ scaleX: 0.7, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.24 }}
        />
      </TimelineTrack>
    </motion.div>
  )
}

function TimelineTrack({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-[clamp(12px,1.2vw,20px)]">
      <span
        className="shrink-0 text-nomi-ink-40"
        style={{ width: 'clamp(34px,3vw,52px)', fontSize: 'clamp(11px,0.9vw,15px)' }}
      >
        {label}
      </span>
      {/* 轨容器：clip 间距 4px、clip 高 14px（随视口放大） */}
      <div className="flex-1 flex items-center gap-[clamp(4px,0.4vw,8px)]" style={{ height: 'clamp(14px,1.6vh,26px)' }}>
        {children}
      </div>
    </div>
  )
}

/** 5 标版：真 NomiBrand（mark + Fraunces「Nomi」字标）+ slogan 紧随其下，整组垂直居中。 */
function SceneBrand(): JSX.Element {
  const { t } = useTranslation()
  // NomiBrand 只接受 px 数值；按视口实测推一个大尺寸（min(96, 7vmin)），让标版随全屏放大。
  const { markSize, wordSize } = useBrandSize()
  return (
    <motion.div
      className="flex flex-col items-center"
      style={{ gap: 'clamp(16px, 1.8vw, 28px)' }}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <NomiBrand markSize={markSize} wordSize={wordSize} />
      <p
        className="text-nomi-ink-60 text-center m-0 tracking-[0.04em]"
        style={{ fontSize: 'clamp(15px, 1.6vw, 24px)' }}
      >
        {t('onboardingProviders.splash.slogan')}
      </p>
    </motion.div>
  )
}

/** 据视口实测推标版尺寸（mark 约 7vmin、clamp 56–96px；字标按比例），随窗口变化重算。 */
function useBrandSize(): { markSize: number; wordSize: number } {
  const compute = React.useCallback((): number => {
    if (typeof window === 'undefined') return 72
    const vmin = Math.min(window.innerWidth, window.innerHeight)
    return Math.round(Math.max(56, Math.min(96, vmin * 0.09)))
  }, [])
  const [markSize, setMarkSize] = React.useState(compute)
  React.useEffect(() => {
    const onResize = () => setMarkSize(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [compute])
  return { markSize, wordSize: Math.round(markSize * 0.82) }
}
