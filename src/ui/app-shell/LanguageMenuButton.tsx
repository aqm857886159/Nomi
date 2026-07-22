import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconLanguage } from '@tabler/icons-react'
import { BodyPortal } from '../../design'
import { cn } from '../../utils/cn'
import { getAppLocale, isAppLocale, setAppLocale, SUPPORTED_LOCALES } from '../../i18n'

// 语言切换的**唯一入口**（P1）：一个「文/A」图标钮 + 点击弹出的小面板，摆在顶栏「素材盒」旁边。
// 原先语言藏在「关于」弹窗第三层（logo→翻到语言行→下拉），换个语言要三步；抽成常驻图标后一眼可见、一点即切。
// 触发钮样式交给调用点（跟同处素材盒/主题钮对齐），本组件只管图标 + 面板 + 定位 + 选中态。

const PANEL_WIDTH = 184
const VIEWPORT_MARGIN = 12

// 语言用「母语名」直读（简体中文 / English），不随界面语言翻译——换语言时两个名字都稳定可认。
const LOCALE_LABEL_KEY: Record<string, string> = {
  'zh-CN': 'common.chinese',
  en: 'common.english',
}

type LanguageMenuButtonProps = {
  /** 触发钮附加样式：各顶栏传自己的尺寸/形状，跟旁边「素材盒」按钮对齐。 */
  className?: string
  iconSize?: number
  iconStroke?: number
}

export function LanguageMenuButton({
  className,
  iconSize = 15,
  iconStroke = 1.8,
}: LanguageMenuButtonProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  // useTranslation 的 t 随语言变化而变，选中态渲染时读 getAppLocale() 即拿最新值。
  const current = getAppLocale()

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('common.language')}
        title={t('common.language')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-grid place-items-center size-7 rounded-pill border border-transparent',
          'bg-transparent text-nomi-ink-60 cursor-pointer',
          'transition-[background,border-color,color] duration-[var(--nomi-transition-fast)]',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          'focus-visible:outline-2 focus-visible:outline-[var(--nomi-accent)] focus-visible:outline-offset-2',
          className,
        )}
      >
        <IconLanguage size={iconSize} stroke={iconStroke} aria-hidden="true" />
      </button>
      {open ? (
        <LanguagePopover
          anchorEl={buttonRef.current}
          current={current}
          onPick={(locale) => {
            if (isAppLocale(locale)) setAppLocale(locale)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

type LanguagePopoverProps = {
  anchorEl: HTMLElement | null
  current: string
  onPick: (locale: string) => void
  onClose: () => void
}

function LanguagePopover({ anchorEl, current, onPick, onClose }: LanguagePopoverProps): JSX.Element {
  const { t } = useTranslation()
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)

  // 定位照抄 AboutNomiPopover（同族浮层，风格统一）：钮下方 6px 展开，向右夹取不溢出视口。
  React.useLayoutEffect(() => {
    if (!anchorEl) return
    const compute = (): void => {
      const rect = anchorEl.getBoundingClientRect()
      const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
      setPos({ top: rect.bottom + 6, left: Math.max(VIEWPORT_MARGIN, left) })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [anchorEl])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[600]" onMouseDown={onClose} aria-hidden="true" />
      <div
        className={cn(
          'fixed z-[601] p-1.5',
          'bg-nomi-paper border border-nomi-line rounded-nomi shadow-nomi-lg',
        )}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: PANEL_WIDTH }}
        role="menu"
        aria-label={t('common.language')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {SUPPORTED_LOCALES.map((locale) => {
          const selected = locale === current
          return (
            <button
              key={locale}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onPick(locale)}
              className={cn(
                'flex w-full items-center gap-2 h-8 px-2.5 rounded-nomi-sm border-0 bg-transparent cursor-pointer text-left',
                'text-caption transition-colors hover:bg-nomi-ink-05',
                selected ? 'text-nomi-ink font-semibold' : 'text-nomi-ink-80',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{t(LOCALE_LABEL_KEY[locale] ?? 'common.language')}</span>
              <IconCheck
                size={14}
                stroke={1.8}
                className={cn('shrink-0 text-nomi-accent', selected ? '' : 'invisible')}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>
    </BodyPortal>
  )
}
