import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpendConfirmStore } from './spendConfirm'

// 确认卡上的清单复选框是受控的：显示的勾选状态只能来自卡里（pending）那一份行数据。
// 调用方（画布组框 / 列表分区头 / 分镜批量）只当观察者收到回调；以前它们各自在闭包里记勾选、行数据只传一次，
// 点了框就被弹回——必红：点一下之后，卡上读到的那一行必须翻转。
const rows = [
  { id: 'a', label: '镜 01', checked: true },
  { id: 'b', label: '镜 02', checked: true },
  { id: 'c', label: '镜 03', checked: false },
]

describe('spend confirm plan rows are controlled by the card', () => {
  beforeEach(() => useSpendConfirmStore.setState({ pending: null, queue: [] }))

  it('toggling a row flips what the card shows and tells the caller', () => {
    const seen = vi.fn()
    void useSpendConfirmStore.getState().requestConfirm({ title: 't', message: '', planRows: rows, onPlanToggle: seen })
    const store = useSpendConfirmStore.getState()
    store.togglePlanRow(rows[1], false)
    store.togglePlanRow(rows[2], true)
    const shown = useSpendConfirmStore.getState().pending?.planRows
    expect(shown?.map((row) => row.checked)).toEqual([true, false, true])
    expect(seen).toHaveBeenNthCalledWith(1, rows[1], false)
    expect(seen).toHaveBeenNthCalledWith(2, rows[2], true)
  })

  it('a locked row never flips', () => {
    const locked = [{ id: 'x', label: '镜 09', checked: false, disabled: true }]
    void useSpendConfirmStore.getState().requestConfirm({ title: 't', message: '', planRows: locked })
    useSpendConfirmStore.getState().togglePlanRow(locked[0], true)
    expect(useSpendConfirmStore.getState().pending?.planRows?.[0].checked).toBe(false)
  })
})
