import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), read: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/application' } }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./settings/attentionSoundSettings', () => ({ readAttentionSoundSettings: mocks.read, customAttentionSoundPath: () => '/data/sounds/attention.wav' }))
import { defaultAttentionSoundPath, playAttentionSound, stopAttentionSound } from './attentionSoundPlayer'
let children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn> }>
beforeEach(() => {
  vi.useFakeTimers(); children = []; mocks.read.mockReturnValue({ custom: null })
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    children.push(child)
    return child
  })
})
afterEach(() => { stopAttentionSound(); vi.restoreAllMocks(); vi.useRealTimers() })
it('reserves a single voice before spawn completes and stops preview at two seconds', async () => {
  const pending = playAttentionSound(true)
  expect(await playAttentionSound()).toBe(false)
  children[0].emit('spawn')
  expect(await pending).toBe(true)
  vi.advanceTimersByTime(1999)
  expect(children[0].kill).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(children[0].kill).toHaveBeenCalledTimes(1)
  expect(defaultAttentionSoundPath()).toBe(path.join('/application', 'assets', 'sound', 'nomi-attention.wav'))
})
it('cancellation before spawn cannot leave a late player running', async () => {
  const pending = playAttentionSound(true)
  stopAttentionSound()
  children[0].emit('spawn')
  // Linux may attempt its second installed player; it must also fail without hanging this test.
  await Promise.resolve()
  if (children[1]) children[1].emit('error', new Error('missing'))
  expect(await pending).toBe(false)
  expect(children[0].kill).toHaveBeenCalled()
})
it('uses the imported WAV path as data and never shell-interpolates a filename', async () => {
  mocks.read.mockReturnValue({ custom: { name: 'a;$(secret).mp3' } })
  const pending = playAttentionSound()
  children[0].emit('spawn')
  expect(await pending).toBe(true)
  const [command, args, options] = mocks.spawn.mock.calls.at(-1)!
  expect(options.shell).not.toBe(true)
  expect(options.env.NOMI_ATTENTION_FILE).toBe('/data/sounds/attention.wav')
  if (command !== 'powershell.exe') expect(args).toEqual(['/data/sounds/attention.wav'])
})
it('Linux falls back from missing paplay to aplay; no installed player stays quiet', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'linux' })
  try {
    const pending = playAttentionSound()
    children[0].emit('error', new Error('ENOENT'))
    await Promise.resolve()
    expect(mocks.spawn.mock.calls.at(-1)?.[0]).toBe('aplay')
    children[1].emit('error', new Error('ENOENT'))
    expect(await pending).toBe(false)
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})
it('Windows SoundPlayer receives the WAV through an environment value', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    const pending = playAttentionSound()
    children[0].emit('spawn')
    expect(await pending).toBe(true)
    const [command, args, options] = mocks.spawn.mock.calls.at(-1)!
    expect(command).toBe('powershell.exe')
    expect(args.at(-1)).toContain('$env:NOMI_ATTENTION_FILE')
    expect(args.at(-1)).not.toContain('/application')
    expect(options.env.NOMI_ATTENTION_FILE).toBe(path.join('/application', 'assets', 'sound', 'nomi-attention.wav'))
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})
