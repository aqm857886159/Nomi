import { MOVEMENT_CODES } from './scene3dConstants'
import type { PointerCaptureTarget, Scene3DMovementCode } from './scene3dSharedTypes'

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function pointerCaptureTarget(target: unknown): PointerCaptureTarget | null {
  return target && typeof target === 'object' ? target as PointerCaptureTarget : null
}

export function isMovementCode(code: string): code is Scene3DMovementCode {
  return MOVEMENT_CODES.has(code)
}

export function clearMovementKeyState(keys: Record<Scene3DMovementCode, boolean>): void {
  keys.KeyW = false
  keys.KeyA = false
  keys.KeyS = false
  keys.KeyD = false
  keys.ArrowUp = false
  keys.ArrowDown = false
  keys.ArrowLeft = false
  keys.ArrowRight = false
  keys.Space = false
  keys.ShiftLeft = false
  keys.ShiftRight = false
}

export function hasActiveMovementKey(keys: Record<Scene3DMovementCode, boolean>): boolean {
  return (
    keys.KeyW ||
    keys.KeyA ||
    keys.KeyS ||
    keys.KeyD ||
    keys.ArrowUp ||
    keys.ArrowDown ||
    keys.ArrowLeft ||
    keys.ArrowRight ||
    keys.Space ||
    keys.ShiftLeft ||
    keys.ShiftRight
  )
}
