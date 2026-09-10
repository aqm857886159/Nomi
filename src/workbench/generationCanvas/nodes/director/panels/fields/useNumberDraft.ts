/**
 * [INPUT]: React；显示值、精度与有效数值提交回调。
 * [OUTPUT]: useNumberDraft：数字输入共享草稿/提交/取消事件。
 * [POS]: fields 层；空白、取消、非法数字均不写工程，Enter/blur 只提交一次实际变化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import React from 'react'

export function useNumberDraft(value: number, digits: number, onCommit: (next: number) => void) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const pending = React.useRef<string | null>(null)
  React.useEffect(() => { pending.current = null; setDraft(null) }, [value])
  const update = (next: string | null) => { pending.current = next; setDraft(next) }
  return {
    value: draft ?? value.toFixed(digits),
    onFocus: () => update(value.toFixed(digits)),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(event.target.value),
    onBlur: () => {
      const text = pending.current
      update(null)
      if (text === null || !text.trim()) return
      const parsed = Number(text)
      if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') update(null)
      event.currentTarget.blur()
    },
  }
}
