import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { NOMI_DURATION_MS, NOMI_EASE } from '../../design/motion'
import { cn } from '../../utils/cn'
import type { BrowserCaptureFlyout } from './dialog/NomiBrowserDialogModel'

function finalScale({ sourceRect, targetRect }: BrowserCaptureFlyout): number {
  return Math.max(0.66, Math.min(0.92, targetRect.width / Math.max(1, sourceRect.width)))
}

export function BrowserCaptureFlyouts({ captureFlyouts, removeCaptureFlyout, className }: {
  captureFlyouts: readonly BrowserCaptureFlyout[]
  removeCaptureFlyout: (id: string) => void
  className: string
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {captureFlyouts.map((flyout) => (
        <motion.div
          key={flyout.id}
          data-browser-capture-flyout=""
          className={cn('pointer-events-none left-0 top-0 overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg', className)}
          initial={{
            x: flyout.sourceRect.left,
            y: flyout.sourceRect.top,
            width: flyout.sourceRect.width,
            height: flyout.sourceRect.height,
            opacity: 0.72,
            scale: 0.98,
          }}
          animate={reduce ? { opacity: 0 } : {
            x: [
              flyout.sourceRect.left,
              flyout.sourceRect.left,
              flyout.targetRect.left,
            ],
            y: [
              flyout.sourceRect.top,
              flyout.sourceRect.top,
              flyout.targetRect.top,
            ],
            width: [
              flyout.sourceRect.width,
              flyout.sourceRect.width,
              flyout.targetRect.width,
            ],
            height: [
              flyout.sourceRect.height,
              flyout.sourceRect.height,
              flyout.targetRect.height,
            ],
            opacity: [0.78, 1, 0.08],
            scale: [0.98, 1.02, finalScale(flyout)],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: NOMI_DURATION_MS.morph / 1000, times: [0, 0.18, 1], ease: NOMI_EASE.spatial }}
          onAnimationComplete={() => removeCaptureFlyout(flyout.id)}
          aria-hidden="true"
        >
          {flyout.mediaType === 'video' ? (
            <>
              <video src={flyout.url} muted playsInline className="block size-full bg-nomi-ink object-contain" />
              <span className="absolute right-1 top-1 rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro font-semibold leading-none text-nomi-paper shadow-nomi-sm">
                {t('browserAssets.video')}
              </span>
            </>
          ) : (
            <img src={flyout.url} alt="" draggable={false} className="block size-full object-contain" />
          )}
          <span className="absolute inset-0 rounded-nomi ring-1 ring-inset ring-nomi-paper/85" />
          <motion.span
            className="absolute inset-0 rounded-nomi bg-nomi-accent"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.28, 0] }}
            transition={{ duration: NOMI_DURATION_MS.spatial / 1000, times: [0, 0.28, 1], ease: NOMI_EASE.out }}
          />
        </motion.div>
      ))}
    </AnimatePresence>
  )
}
