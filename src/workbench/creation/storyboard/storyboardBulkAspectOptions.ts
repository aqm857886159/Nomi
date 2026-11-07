/** 同一份下拉值供批量条和持久化属性门使用；空串明确表示按模型默认。 */
export function storyboardBulkAspectOptions(derived: readonly string[] | null, current: string): Array<{ value: string; label: string }> {
  return [
    { value: '', label: '' },
    ...[...new Set([...(derived ?? []), ...(current ? [current] : [])])].filter(Boolean).map(value => ({ value, label: value })),
  ]
}
