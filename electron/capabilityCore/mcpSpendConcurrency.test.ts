import { describe, expect, it, vi } from 'vitest'

import { createConfirmationBinding } from './mcpConfirmationBinding'

describe('MCP confirmation binding', () => {
  it('shares one in-flight confirmation for the same authority key', async () => {
    let resolve!: (value: boolean) => void
    const confirm = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
    const binding = createConfirmationBinding({ isConfirmed: (value: boolean) => value })

    const first = binding.run('challenge-1', confirm)
    const second = binding.run('challenge-1', confirm)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(binding.size()).toBe(1)
    resolve(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(binding.size()).toBe(1)
  })

  it('releases declined and failed confirmations so a later request can retry', async () => {
    const binding = createConfirmationBinding({ isConfirmed: (value: boolean) => value })
    await expect(binding.run('challenge-1', async () => false)).resolves.toBe(false)
    expect(binding.size()).toBe(0)

    await expect(binding.run('challenge-1', async () => { throw new Error('cancelled') }))
      .rejects.toThrow('cancelled')
    expect(binding.size()).toBe(0)
  })

  it('keeps anonymous confirmations independent and removes them after settlement', async () => {
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const binding = createConfirmationBinding({ isConfirmed: () => true })
    const first = binding.run('', () => new Promise<boolean>((resolve) => { releaseFirst = () => resolve(true) }))
    const second = binding.run('', () => new Promise<boolean>((resolve) => { releaseSecond = () => resolve(true) }))

    expect(binding.size()).toBe(2)
    releaseFirst()
    releaseSecond()
    await Promise.all([first, second])
    expect(binding.size()).toBe(0)
  })

  it('lets the authority release a confirmed binding after durable consumption', async () => {
    const binding = createConfirmationBinding({ isConfirmed: (value: boolean) => value })
    await binding.run('challenge-1', async () => true)
    expect(binding.size()).toBe(1)
    binding.release('challenge-1')
    expect(binding.size()).toBe(0)
  })
})
