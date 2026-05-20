import React from 'react'
import { motion } from 'framer-motion'
import { onDesktopBootProgress, isDesktop } from '../../shared/desktop'

type Act0Props = {
  onContinue: () => void
}

const BOOT_STEPS: Record<string, string> = {
  'db-init': '正在初始化本地数据库',
  'api-start': '正在启动本地 API',
  'agents-start': '正在加载 Agent 桥',
  'ui-load': '准备就绪',
}
const BOOT_STEP_LABELS = Object.values(BOOT_STEPS)

export function Act0Welcome({ onContinue }: Act0Props): JSX.Element {
  const [bootStep, setBootStep] = React.useState(0)
  const [showCta, setShowCta] = React.useState(false)

  React.useEffect(() => {
    // 桌面端：监听主进程 boot-progress IPC 事件驱动动画
    if (isDesktop) {
      onDesktopBootProgress((stage) => {
        const label = BOOT_STEPS[stage]
        if (!label) return
        const idx = BOOT_STEP_LABELS.indexOf(label)
        if (idx >= 0) setBootStep(idx)
        if (stage === 'ui-load') {
          window.setTimeout(() => setShowCta(true), 400)
        }
      })
      // 兜底：若 IPC 事件未送达，超时后仍显示按钮
      const fallbackTimer = window.setTimeout(() => setShowCta(true), 6000)
      return () => window.clearTimeout(fallbackTimer)
    }

    // 非桌面端（Web 模式）：纯 setTimeout 模拟启动进度
    const timers: number[] = []
    BOOT_STEP_LABELS.forEach((_, idx) => {
      if (idx === 0) return
      timers.push(window.setTimeout(() => setBootStep(idx), 700 * idx))
    })
    timers.push(window.setTimeout(() => setShowCta(true), 700 * BOOT_STEP_LABELS.length + 300))
    return () => { timers.forEach(window.clearTimeout) }
  }, [])

  return (
    <div className="nomi-ob__hero">
      <motion.div
        className="nomi-ob__orb"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
      />

      <motion.h1
        className="nomi-ob__title"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      >
        欢迎来到 Nomi
      </motion.h1>

      <motion.p
        className="nomi-ob__sub"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        从一段故事，到一支视频。<br />
        AI 帮你把剧本、画面、视频、剪辑全部串起来。<br />
        全程在你的电脑上跑，素材不离开本地。
      </motion.p>

      <motion.div
        className="nomi-ob__boot-label"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.6 }}
      >
        <motion.span
          key={`step-${bootStep}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          ▸ {BOOT_STEP_LABELS[bootStep]}
        </motion.span>
      </motion.div>

      <motion.button
        className="nomi-ob__cta"
        onClick={onContinue}
        disabled={!showCta}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: showCta ? 1 : 0, scale: showCta ? 1 : 0.92 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        whileHover={showCta ? { scale: 1.04 } : undefined}
        whileTap={showCta ? { scale: 0.98 } : undefined}
      >
        开始 →
      </motion.button>
    </div>
  )
}
