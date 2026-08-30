export type ResultStackPlacement = 'left' | 'right'

export function resolveResultStackPlacement({
  leftSpace,
  rightSpace,
  requiredSpace,
}: {
  leftSpace: number
  rightSpace: number
  requiredSpace: number
}): ResultStackPlacement {
  if (rightSpace >= requiredSpace) return 'right'
  if (leftSpace >= requiredSpace) return 'left'
  return rightSpace >= leftSpace ? 'right' : 'left'
}
