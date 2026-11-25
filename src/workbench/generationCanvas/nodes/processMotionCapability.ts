import type { ProcessMotionCapability } from '../../../design/motion'

export { readBrowserMotion as readProcessMotionCapability, type ProcessMotionCapability } from '../../../design/motion'

/** Pure admission policy shared by the UI and real-renderer performance scenarios. */
export function shouldReduceProcessMotion({ renderer, prefersReducedMotion }: ProcessMotionCapability): boolean {
  return prefersReducedMotion || renderer === null || /swiftshader|llvmpipe|software/i.test(renderer)
}
