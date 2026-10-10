import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, dialog: {}, ipcMain: {} }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: vi.fn() }))
vi.mock('../attentionSoundPlayer', () => ({ stopAttentionSound: vi.fn(), playAttentionSound: vi.fn() }))
import { importAttentionSound } from './attentionSoundIpc'
import { migrateAttentionSoundSettings, readAttentionSoundSettings, customAttentionSoundPath, writeAttentionSoundSettings } from './attentionSoundSettings'
import { resolveFfmpegPath } from '../export/ffmpegRunner'
import { runBoundedProcess, probeMediaMetadata } from '../export/mediaProbe'

const dirs: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))) })
it('imports every advertised format through real media tools; malformed/long/oversized input preserves prior selection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-sound-'))
  dirs.push(dir); vi.stubEnv('NOMI_SETTINGS_DIR', dir)
  const source = path.resolve('assets/sound/nomi-attention.wav')
  for (const format of ['wav', 'mp3', 'aiff', 'm4a']) {
    const input = path.join(dir, `original.${format}`)
    const encoded = await runBoundedProcess(resolveFfmpegPath()!, ['-i', source, input], { timeoutMs: 10000, maxStdoutBytes: 1024, maxStderrBytes: 64000 })
    expect(encoded.code).toBe(0)
    expect(await importAttentionSound(input)).toMatchObject({ ok: true, settings: { custom: { name: `original.${format}` } } })
    const metadata = await probeMediaMetadata(customAttentionSoundPath())
    expect(metadata.audioCodec).toBe('pcm_s16le')
  }
  const before = readAttentionSoundSettings()
  const beforeBytes = await fs.readFile(customAttentionSoundPath())
  const oversized = path.join(dir, 'oversized.wav')
  await fs.writeFile(oversized, Buffer.alloc(2 * 1024 * 1024 + 1))
  const malformed = path.join(dir, 'malformed.mp3')
  await fs.writeFile(malformed, 'not audio')
  const long = path.join(dir, 'long.wav')
  await runBoundedProcess(resolveFfmpegPath()!, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=11', long], { timeoutMs: 10000, maxStdoutBytes: 1024, maxStderrBytes: 64000 })
  for (const file of [oversized, malformed, long]) expect(await importAttentionSound(file)).toEqual({ ok: false, reason: 'invalid' })
  expect(readAttentionSoundSettings()).toEqual(before)
  expect(await fs.readFile(customAttentionSoundPath())).toEqual(beforeBytes)
  writeAttentionSoundSettings({ ...before, enabled: false })
  expect(readAttentionSoundSettings().enabled).toBe(false)
}, 30000)

it('migrates an existing opt-out once, then the new owner stays authoritative', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-sound-migrate-'))
  dirs.push(dir); vi.stubEnv('NOMI_SETTINGS_DIR', dir)
  await fs.writeFile(path.join(dir, 'automation-policy.json'), JSON.stringify({ notificationSound: false }))
  migrateAttentionSoundSettings()
  expect(readAttentionSoundSettings().enabled).toBe(false)
  writeAttentionSoundSettings({ enabled: true })
  migrateAttentionSoundSettings()
  expect(readAttentionSoundSettings().enabled).toBe(true)
})
it('accepts MP3 audio with embedded cover art and discards the picture during normalization', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-sound-cover-'))
  dirs.push(dir); vi.stubEnv('NOMI_SETTINGS_DIR', dir)
  const file = path.join(dir, 'cover.mp3')
  const encoded = await runBoundedProcess(resolveFfmpegPath()!, ['-i', path.resolve('assets/sound/nomi-attention.wav'),
    '-i', path.resolve('build/icon.png'), '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame',
    '-c:v', 'copy', '-id3v2_version', '3', '-disposition:v', 'attached_pic', file],
  { timeoutMs: 10000, maxStdoutBytes: 1024, maxStderrBytes: 64000 })
  expect(encoded.code).toBe(0)
  expect(await probeMediaMetadata(file)).toMatchObject({ hasAudio: true, kind: 'audio', streamCount: 2 })
  expect(await importAttentionSound(file)).toMatchObject({ ok: true })
  expect((await probeMediaMetadata(customAttentionSoundPath())).kind).toBe('audio')
})
