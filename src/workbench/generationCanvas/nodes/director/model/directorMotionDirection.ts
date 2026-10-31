/** Product motion-direction predicate; offline evaluation imports this instead of world-axis rules. */
import type { MotionRecognition } from './directorEvalMeasurement'

export function motionDirectionMatches(direction: 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | undefined, motion: MotionRecognition): boolean {
  if (!direction) return true
  if (direction === 'left' || direction === 'right') {
    if (motion.move === 'track_left' || motion.move === 'track_right') return motion.move === `track_${direction}`
    if (direction === 'left') return motion.signedOrbitDeg < -1 || motion.yawDelta < -1 || motion.lateralTravel < -0.05
    return motion.signedOrbitDeg > 1 || motion.yawDelta > 1 || motion.lateralTravel > 0.05
  }
  if (direction === 'up') return motion.pitchDelta < -1 || motion.cameraDelta.y > 0.05
  if (direction === 'down') return motion.pitchDelta > 1 || motion.cameraDelta.y < -0.05
  if (direction === 'in') return motion.distanceDelta < -0.05 || motion.fovDelta < -0.5
  return motion.distanceDelta > 0.05 || motion.fovDelta > 0.5
}
