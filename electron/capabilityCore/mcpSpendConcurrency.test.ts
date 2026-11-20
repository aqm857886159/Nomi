import { describe, expect, it, vi } from 'vitest'

import { createConfirmationBinding } from './mcpConfirmationBinding'

describe('MCP confirmation binding', () => {
  it('shares one in-flight confirmation for the same authority key', async () => {
    let resolve!: (value: boolean) => void
    const confirm = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
    const binding = createConfirmationBinding<boolean>()

    const first = binding.run('challenge-1', confirm)
    const second = binding.run('challenge-1', confirm)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(binding.size()).toBe(1)
    resolve(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    // 问完就摘：「批过没有、用掉没有」由主进程的生成门主人判，这里不记结果。
    expect(binding.size()).toBe(0)
  })

  it('releases declined and failed confirmations so a later request can retry', async () => {
    const binding = createConfirmationBinding<boolean>()
    await expect(binding.run('challenge-1', async () => false)).resolves.toBe(false)
    expect(binding.size()).toBe(0)

    await expect(binding.run('challenge-1', async () => { throw new Error('cancelled') }))
      .rejects.toThrow('cancelled')
    expect(binding.size()).toBe(0)
  })

  it('keeps anonymous confirmations independent and removes them after settlement', async () => {
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const binding = createConfirmationBinding<boolean>()
    const first = binding.run('', () => new Promise<boolean>((resolve) => { releaseFirst = () => resolve(true) }))
    const second = binding.run('', () => new Promise<boolean>((resolve) => { releaseSecond = () => resolve(true) }))

    expect(binding.size()).toBe(2)
    releaseFirst()
    releaseSecond()
    await Promise.all([first, second])
    expect(binding.size()).toBe(0)
  })

  it('a confirmed answer is not remembered: the next request runs the confirmation again', async () => {
    const binding = createConfirmationBinding<boolean>()
    const confirm = vi.fn(async () => true)
    await binding.run('challenge-1', confirm)
    await binding.run('challenge-1', confirm)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(binding.size()).toBe(0)
  })
})
