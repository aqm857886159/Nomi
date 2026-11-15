import React, { type JSX, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'

type NomiBrandProps = {
  markSize?: number
  wordSize?: number
  className?: string
}

type NomiLogoMarkProps = {
  size?: number
  className?: string
}

type NomiLoadingMarkProps = {
  size?: number
  className?: string
  label?: string
}

type NomiAILabelProps = {
  markSize?: number
  wordSize?: number
  className?: string
  suffix?: string
}

type NomiStepperProps = {
  value: 'creation' | 'storyboard' | 'generation' | 'preview'
  onChange: (mode: 'creation' | 'storyboard' | 'generation' | 'preview') => void
  /**
   * 每段后面那格真实进度（10-08 外壳拍板稿：「生成 5/6」「预览 0:26」）。由宿主算好的事实，不在这里猜；
   * 没有就不画（不填 0、不填占位）。
   */
  meta?: Partial<Record<'creation' | 'generation' | 'preview', string>>
}

type NomiWordmarkProps = {
  /** 字号 px；缺省则继承父级 font-size（如放进 h1 用 text-display）。 */
  fontSize?: number
  className?: string
} & HTMLAttributes<HTMLSpanElement>

/**
 * Nomi 文字标志「No·m·i」的**唯一真相源**（P1）：中间的 m 永远 accent 色、Fraunces 字体。
 * No/i 颜色由 className/父级控制（品牌处 text-nomi-ink、消息标签处可灰）；m 的 accent 是品牌不变量。
 * 任何要显示「Nomi」字标的地方都用它，别再手写 `No<span>m</span>i`。
 */
export function NomiWordmark({ fontSize, className, ...rest }: NomiWordmarkProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={cn('nomi-wordmark', 'font-nomi-display font-normal tracking-[-0.02em] leading-none', className)}
      style={fontSize ? { fontSize } : undefined}
      {...rest}
    >
      {t('brand.wordStart')}
      <span className={cn('nomi-wordmark__accent', 'text-nomi-accent')}>{t('brand.wordAccent')}</span>
      {t('brand.wordEnd')}
    </span>
  )
}

/**
 * 品牌标记的**唯一几何真相源**(P1):圆角方底 + 双竖 + 斜杠,viewBox 恒 28×28。
 *
 * 圆角 rx **恒为 7**(= 边长 25%),与 public/nomi-logo.svg、build/icon.png 同一形状。
 * **千万别按渲染尺寸再算一次 rx**:rx 是 viewBox 单位,缩放本来就由 viewBox 负责,
 * 乘 markSize 等于双重缩放——markSize≥56 时 rx 超过半边长(14),被 SVG 截断成**正圆**。
 * 2026-09-02 实测:开屏标版 markSize=75 → rx=19 → 屏幕上是个圆,而 README/系统图标是圆角方。
 * 两个组件共用这一份,就是为了这个 bug 不会再从另一个调用方回来。
 */
const NOMI_MARK_VIEWBOX = '0 0 28 28'

function NomiMarkShapes(): JSX.Element {
  return (
    <>
      <rect width="28" height="28" rx="7" fill="var(--nomi-logo-ground)" />
      <rect x="5.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
      <rect x="18.5" y="5.5" width="4" height="17" rx="1.2" fill="white" />
      <polygon points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5" fill="white" />
    </>
  )
}

export function NomiBrand({ markSize = 26, wordSize = 17, className }: NomiBrandProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className={cn('nomi-brand', 'inline-flex items-center gap-2 shrink-0', className)}
      aria-label={t('brand.name')}
    >
      <svg width={markSize} height={markSize} viewBox={NOMI_MARK_VIEWBOX} fill="none" aria-hidden="true" className="shrink-0">
        <NomiMarkShapes />
      </svg>
      <NomiWordmark fontSize={wordSize} className="nomi-brand__word text-nomi-ink" aria-hidden="true" />
    </div>
  )
}

export function NomiLogoMark({ size = 24, className }: NomiLogoMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={NOMI_MARK_VIEWBOX}
      fill="none"
      aria-hidden="true"
      className={cn('nomi-logo-mark', 'block shrink-0', className)}
    >
      <NomiMarkShapes />
    </svg>
  )
}

/**
 * Agent 形象（Nomi 这个角色）的姿态。五个基本状态 + 「有新消息」变体；状态 → 姿态的映射由宿主做
 * （右下小球见 src/ui/app-shell/shell/AgentBallFace.tsx 的 agentBallLook），这里只画。
 * 拍板：docs/design/boards/2026-10-27-agent-persona/（G · 去框：logo 同一块底色、同一个圆角比例的形 + 两只眼）。
 */
export type NomiAgentPose = 'idle' | 'unread' | 'running' | 'confirm' | 'done' | 'failed'

type NomiAgentFaceProps = {
  pose?: NomiAgentPose
  /**
   * live = 右下小球的活形象：28 个形象单位的方舞台贴在宿主右缘，状态之间连续形变、眨眼、在跑转弧；
   * mark = 静态脸（聊天身份行）：填满 size×size 的方框，空闲那一副长相，没有任何动效、没有状态。
   */
  variant?: 'live' | 'mark'
  /** live：舞台边长（默认 44 = BALL_SIZE）；mark：方框边长（默认 16）。 */
  size?: number
  /** 胶囊里的那句（只在 confirm 时显示）。 */
  text?: string
  /** 在跑那段弧上的额外属性（宿主的走查探针，如 data-agent-ball-progress）。 */
  ringProps?: Record<`data-${string}`, string | boolean | undefined>
  /** 挂在舞台里、画在最上面的宿主装饰（右上角的未读点 / 出错点），坐标按舞台算。 */
  children?: ReactNode
  className?: string
}

/** 舞台边长（形象单位）。空闲身体 22、圆角 5.5 = 边长 25%，与 logo mark（28 / rx 7）同一比例。 */
const AGENT_STAGE_UNITS = 28
type AgentBodyGeometry = { right: number; top: number; width: number; height: number; radius: number; rotate: number }
type AgentEyeGeometry = { top: number; width: number; height: number; radius: number; left: readonly [number, number]; opacity: number }
type AgentPoseGeometry = { body: AgentBodyGeometry; eyes: AgentEyeGeometry; smile: { top: number; opacity: number } }

/**
 * 每种姿态的几何（形象单位；身体按舞台右缘 / 上缘定位，眼睛和笑眼按身体定位）。照拍板小样
 * source/AgentPersona.dc.html 的 .st-* 规则逐项抄；小样用 left 定位身体，这里换成 right（同一个框），
 * 好让胶囊「右缘不动往左长」时宽度可以直接取字的宽度。胶囊（confirm）按 --nomi-agent-ph 另算，不在表里。
 */
const AGENT_IDLE_EYES: AgentEyeGeometry = { top: 6.6, width: 3.4, height: 6.6, radius: 1.7, left: [6.2, 12.4], opacity: 1 }
const AGENT_IDLE_BODY: AgentBodyGeometry = { right: 3, top: 4, width: 22, height: 22, radius: 5.5, rotate: 0 }
const NOMI_AGENT_POSES: Readonly<Record<Exclude<NomiAgentPose, 'confirm'>, AgentPoseGeometry>> = {
  idle: { body: AGENT_IDLE_BODY, eyes: AGENT_IDLE_EYES, smile: { top: 9, opacity: 0 } },
  // 有新消息：眼睛往屏幕里（左上）看。
  unread: { body: AGENT_IDLE_BODY, eyes: { ...AGENT_IDLE_EYES, top: 5.8, left: [5.4, 11.6] }, smile: { top: 9, opacity: 0 } },
  // 在跑：变圆，眼睛低头。
  running: { body: { right: 4, top: 5, width: 20, height: 20, radius: 10, rotate: 0 }, eyes: { ...AGENT_IDLE_EYES, top: 8, height: 4.6, left: [5.6, 11] }, smile: { top: 9, opacity: 0 } },
  // 刚做完：压扁一点、眯眼笑（眼睛收起，两道笑眼弧出来）。
  done: { body: { right: 2, top: 8, width: 24, height: 18, radius: 8, rotate: 0 }, eyes: { ...AGENT_IDLE_EYES, top: 8.6, height: 0, opacity: 0, left: [7, 13.6] }, smile: { top: 7.2, opacity: 1 } },
  // 出错：歪 9°，眼睛塌成两条。
  failed: { body: { ...AGENT_IDLE_BODY, height: 21, rotate: -9 }, eyes: { ...AGENT_IDLE_EYES, top: 10, height: 1.7, radius: 0.85 }, smile: { top: 9, opacity: 0 } },
}

/** 小样里笑眼弧的几何（形象单位，按身体定位）。 */
const AGENT_SMILE = { left: [6.4, 12.6] as const, width: 5, height: 2.6, stroke: 1.6 }
/** 约 20 秒眨一次眼；眨眼本身 600ms（与 tailwind.config.ts 的 nomi-agent-blink 同一个数）。组件常量，不是全局 token。 */
const NOMI_AGENT_BLINK_EVERY_MS = 20_000
const AGENT_BLINK_MS = 600

const au = (value: number): string => `calc(var(--nomi-agent-u) * ${value})`
const aph = (value: number): string => `calc(var(--nomi-agent-ph) * ${value})`

function bodyStyle(pose: NomiAgentPose): CSSProperties {
  if (pose === 'confirm') {
    // 胶囊：高 ph = 11u + 18px，右缘停在舞台 27u 处，宽 = 字的宽度 + 两侧留白（左 0.9ph 放眼睛，右 0.32ph），
    // 最宽不超过 PILL_WIDTH 132px 里放得下的（舞台左边还有 88px）。宽度从 22u 形变到 max-content 靠 interpolate-size。
    return {
      right: au(1),
      top: 'calc(var(--nomi-agent-u) * 15 - var(--nomi-agent-ph) / 2)',
      width: 'max-content',
      maxWidth: 'calc(var(--nomi-agent-u) * 27 + 88px)',
      height: aph(1),
      borderRadius: aph(0.5),
      transform: 'rotate(0deg)',
    }
  }
  const body = NOMI_AGENT_POSES[pose].body
  return { right: au(body.right), top: au(body.top), width: au(body.width), height: au(body.height), borderRadius: au(body.radius), transform: `rotate(${body.rotate}deg)` }
}

function eyeStyle(pose: NomiAgentPose, side: 0 | 1): CSSProperties {
  if (pose === 'confirm') {
    return { top: aph(0.3), left: aph(side ? 0.54 : 0.3), width: aph(0.16), height: aph(0.4), borderRadius: aph(0.08), opacity: 1 }
  }
  const eyes = NOMI_AGENT_POSES[pose].eyes
  return { top: au(eyes.top), left: au(eyes.left[side]), width: au(eyes.width), height: au(eyes.height), borderRadius: au(eyes.radius), opacity: eyes.opacity }
}

function smileStyle(pose: NomiAgentPose, side: 0 | 1): CSSProperties {
  const smile = pose === 'confirm' ? NOMI_AGENT_POSES.idle.smile : NOMI_AGENT_POSES[pose].smile
  const radius = au(AGENT_SMILE.height)
  return {
    top: au(smile.top),
    left: au(AGENT_SMILE.left[side]),
    width: au(AGENT_SMILE.width),
    height: au(AGENT_SMILE.height),
    borderWidth: au(AGENT_SMILE.stroke),
    borderBottomWidth: 0,
    borderRadius: `${radius} ${radius} 0 0`,
    opacity: smile.opacity,
  }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 空闲 / 有新消息时约 20 秒眨一下：定时器给脸根加一次 data-blink、眨完摘掉（不进 React state）。
 * 窗口在后台或系统开了减弱动效就这一轮不眨；不用无限循环的 CSS 动画，空闲时没有在跑的动画。
 */
function useAgentBlink(root: React.RefObject<HTMLSpanElement | null>, enabled: boolean): void {
  React.useEffect(() => {
    const element = root.current
    if (!enabled || !element) return undefined
    let open: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (document.hidden || prefersReducedMotion()) return
      element.setAttribute('data-blink', '')
      open = setTimeout(() => element.removeAttribute('data-blink'), AGENT_BLINK_MS)
    }
    const timer = setInterval(tick, NOMI_AGENT_BLINK_EVERY_MS)
    return () => {
      clearInterval(timer)
      if (open) clearTimeout(open)
      element.removeAttribute('data-blink')
    }
  }, [root, enabled])
}

/**
 * Agent 形象（§3.9 第七个品牌组件）。只画、不判断：姿态由宿主传。眼睛跟着鼠标看由宿主往
 * --nomi-agent-look-x / -y 两个 CSS 变量里写（右下小球见 useAgentBallEyeFollow），这里只把它们接到眼睛那一层上。
 * 所有元素都是装饰：aria-hidden、不吃指针事件，宿主的原生按钮照旧是唯一能点、能 Tab 到的东西。
 * 减弱动效：形变、跳、扫眼、眨眼、跟随过渡全部硬切 / 停下，「在跑」那段弧停转但留着。
 */
export function NomiAgentFace({ pose = 'idle', variant = 'live', size, text, ringProps, children, className }: NomiAgentFaceProps): JSX.Element {
  const root = React.useRef<HTMLSpanElement>(null)
  useAgentBlink(root, variant === 'live' && (pose === 'idle' || pose === 'unread'))
  if (variant === 'mark') {
    // 静态脸：与小球空闲时同一套几何（身体 22、圆角 5.5、眼睛 3.4×6.6 在 6.2 / 12.4），按方框等比缩放。
    const side = size ?? 16
    return (
      <svg width={side} height={side} viewBox="0 0 22 22" fill="none" aria-hidden="true" className={cn('nomi-agent-face', 'block shrink-0', className)} data-nomi-agent-face="mark">
        <rect width={AGENT_IDLE_BODY.width} height={AGENT_IDLE_BODY.height} rx={AGENT_IDLE_BODY.radius} fill="var(--nomi-logo-ground)" />
        {AGENT_IDLE_EYES.left.map((x) => (
          <rect key={x} x={x} y={AGENT_IDLE_EYES.top} width={AGENT_IDLE_EYES.width} height={AGENT_IDLE_EYES.height} rx={AGENT_IDLE_EYES.radius} fill="white" />
        ))}
      </svg>
    )
  }
  const stage = size ?? 44
  const confirm = pose === 'confirm'
  const morph = 'duration-nomi-morph ease-nomi-morph motion-reduce:transition-none'
  return (
    <span
      ref={root}
      aria-hidden="true"
      data-nomi-agent-face={pose}
      className={cn('nomi-agent-face', 'group/agent-face pointer-events-none absolute inset-0 block [interpolate-size:allow-keywords]', className)}
      style={{ '--nomi-agent-u': `${stage / AGENT_STAGE_UNITS}px`, '--nomi-agent-ph': 'calc(var(--nomi-agent-u) * 11 + 18px)' } as CSSProperties}
    >
      <span
        className={cn('absolute right-0 top-0 block', pose === 'done' && 'animate-nomi-agent-hop motion-reduce:animate-none')}
        style={{ width: au(AGENT_STAGE_UNITS), height: au(AGENT_STAGE_UNITS) }}
      >
        <span
          className={cn(
            'absolute flex items-center overflow-hidden shadow-nomi-md ring-1',
            'transition-[right,top,width,height,border-radius,background-color,box-shadow,transform]',
            morph,
            // 压在深色画面上 / 暗色模式：一圈浅描边，免得身体被背景吃掉（浅色画布上白描边本来就看不见）。
            confirm ? 'bg-nomi-warning-soft ring-nomi-warning-edge' : 'bg-[var(--nomi-logo-ground)] ring-nomi-media-ink/30 dark:ring-nomi-media-ink/[0.14]',
          )}
          style={bodyStyle(pose)}
          data-nomi-agent-body=""
        >
          <span
            className="absolute inset-0 block transition-[translate] duration-nomi-fast ease-nomi-fast motion-reduce:transition-none"
            style={{ translate: 'var(--nomi-agent-look-x, 0px) var(--nomi-agent-look-y, 0px)' }}
          >
            {([0, 1] as const).map((side) => (
              <span
                key={side}
                className={cn(
                  'absolute block transition-[left,top,width,height,border-radius,background-color,opacity]',
                  morph,
                  confirm ? 'bg-nomi-warning-ink' : 'bg-nomi-media-ink',
                  pose === 'running' && 'animate-nomi-agent-scan motion-reduce:animate-none',
                  (pose === 'idle' || pose === 'unread') && 'group-data-[blink]/agent-face:animate-nomi-agent-blink motion-reduce:animate-none',
                )}
                style={eyeStyle(pose, side)}
                data-nomi-agent-eye=""
              />
            ))}
          </span>
          {([0, 1] as const).map((side) => (
            <span key={side} className={cn('absolute box-border block border-solid border-nomi-media-ink transition-[top,opacity]', morph)} style={smileStyle(pose, side)} data-nomi-agent-smile="" />
          ))}
          <span
            className={cn('relative block min-w-0 truncate text-body-sm font-semibold leading-none tabular-nums text-nomi-warning-ink transition-opacity', morph)}
            style={{ paddingLeft: aph(0.9), paddingRight: aph(0.32), opacity: confirm && text ? 1 : 0 }}
            data-nomi-agent-label=""
          >
            {confirm ? text : null}
          </span>
        </span>
        {pose === 'running' ? (
          // 在跑：外圈一段 accent 弧绕着转；减弱动效时停转，弧留着，看得出在跑。
          <span
            {...ringProps}
            className="absolute block rounded-full border-solid border-transparent border-t-nomi-accent animate-nomi-agent-spin motion-reduce:animate-none"
            style={{ left: au(2.4), top: au(3.4), width: au(23.2), height: au(23.2), borderWidth: au(1.4) }}
          />
        ) : null}
        {children}
      </span>
    </span>
  )
}

export function NomiLoadingMark({ size = 18, className, label }: NomiLoadingMarkProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'nomi-loading-mark',
        'inline-grid place-items-center flex-none leading-none animate-spin motion-reduce:animate-none',
        className,
      )}
      aria-label={label ?? t('common.loading')}
      role="status"
      style={{ '--nomi-loading-size': `${size}px`, width: `${size}px`, height: `${size}px` } as CSSProperties}
    >
      <NomiLogoMark size={size} className={cn('nomi-loading-mark__logo', 'block')} />
    </span>
  )
}

export function NomiAILabel({ markSize = 22, wordSize = 14, className, suffix = 'AI' }: NomiAILabelProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn('nomi-ai-label', 'inline-flex items-center gap-2 shrink-0', className)}
      aria-label={t('brand.aiLabel', { suffix })}
    >
      <NomiLogoMark size={markSize} />
      <span className={cn('nomi-ai-label__text', 'leading-none')} style={{ fontSize: wordSize }}>
        <NomiWordmark className="nomi-ai-label__word text-nomi-ink" />
        <span className={cn('nomi-ai-label__suffix', 'font-nomi-display text-nomi-ink-60 tracking-[-0.01em]')}>
          {' '}
          {suffix}
        </span>
      </span>
    </div>
  )
}

export function NomiStepper({ value, onChange, meta }: NomiStepperProps): JSX.Element {
  const { t } = useTranslation()
  const visibleValue = value === 'storyboard' ? 'creation' : value
  const tabs: { mode: NomiStepperProps['value']; label: string }[] = [
    { mode: 'creation', label: t('workspace.creationTab') },
    { mode: 'generation', label: t('workspace.generationTab') },
    { mode: 'preview', label: t('workspace.previewTab') },
  ]
  return (
    <nav
      className={cn(
        'nomi-stepper',
        'inline-flex h-7 items-center gap-0.5 p-0.5 rounded-full bg-nomi-ink-10',
      )}
      aria-label={t('workspace.switchLabel')}
    >
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          className={cn(
            'nomi-stepper__step',
            'inline-flex h-6 items-center gap-1.5 px-3 border-0 rounded-full bg-transparent text-nomi-ink-60 font-inherit text-body-sm cursor-pointer',
            'transition-[background,color,box-shadow] ease-nomi-fast',
            'hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
            'data-[state=active]:bg-nomi-paper data-[state=active]:font-medium data-[state=active]:text-nomi-ink data-[state=active]:shadow-nomi-sm',
          )}
          type="button"
          aria-current={visibleValue === tab.mode ? 'page' : undefined}
          data-state={visibleValue === tab.mode ? 'active' : 'idle'}
          data-mode={tab.mode}
          // 无障碍名只是阶段名（「生成」）：进度（「5/6」）是附属信息，进名字会让「按名字找这一步」的读屏与走查全部对不上
          // （10-09 实测：getByRole('button', { name: 'Generate', exact: true }) 因名字变成「Generate 0/1」而落空）。
          aria-label={tab.label}
          title={tab.mode !== 'storyboard' && meta?.[tab.mode] ? `${tab.label} · ${meta[tab.mode]}` : undefined}
          onClick={() => onChange(tab.mode)}
        >
          {tab.label}
          {tab.mode !== 'storyboard' && meta?.[tab.mode] ? (
            <span className="text-micro font-normal tabular-nums text-nomi-ink-40" data-stepper-meta={tab.mode} aria-hidden="true">{meta[tab.mode]}</span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}
