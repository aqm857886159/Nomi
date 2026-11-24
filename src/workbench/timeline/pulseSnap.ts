import { NOMI_DURATION_MS, NOMI_EASE_VARS, shouldReduceMotion } from '../../design/motion'

export function pulseSnap(node: HTMLElement | null): void {
  if (!node?.animate || shouldReduceMotion()) return
  node.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }], {
    duration: NOMI_DURATION_MS.micro,
    easing: NOMI_EASE_VARS['--nomi-ease-out'],
  })
}
