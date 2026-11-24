import { expect, it, vi } from 'vitest'
import { exitDurationMs, NOMI_DURATION_MS } from '../../design/motion'
import { BrowserCaptureFlyouts } from './BrowserCaptureFlyouts'

vi.mock('framer-motion', () => ({ AnimatePresence: 'div', motion: { div: 'div', span: 'span' }, useReducedMotion: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('runs the full capture morph before requesting removal and gives the exit its own shorter fade', () => {
  const removeCaptureFlyout = vi.fn()
  const sourceRect = { left: 10, top: 20, width: 180, height: 120 }
  const targetRect = { left: 300, top: 50, width: 96, height: 64 }
  const flyouts = BrowserCaptureFlyouts({
    captureFlyouts: [{ id: 'capture', url: 'capture.png', mediaType: 'image', sourceRect, targetRect }],
    removeCaptureFlyout,
    className: 'absolute',
  })
  const [capture] = flyouts.props.children
  expect(capture.props.animate.x).toEqual([sourceRect.left, sourceRect.left, targetRect.left])
  expect(capture.props.transition.duration).toBe(NOMI_DURATION_MS.morph / 1000)
  expect(capture.props.exit).toMatchObject({ opacity: 0, transition: { duration: exitDurationMs(NOMI_DURATION_MS.morph) / 1000 } })
  capture.props.onAnimationComplete()
  expect(removeCaptureFlyout).toHaveBeenCalledWith('capture')
})
