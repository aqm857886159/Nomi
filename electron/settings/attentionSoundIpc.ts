import { dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { renameWithRetry } from '../jsonFile'
import { assertTrustedSender } from '../ipcSenderGuard'
import { logCrash } from '../crashLog'
import { MEDIA_DECODER_PROTOCOL_WHITELIST, probeMediaMetadata, runBoundedProcess } from '../export/mediaProbe'
import { resolveFfmpegPath } from '../export/ffmpegRunner'
import { playAttentionSound, stopAttentionSound } from '../attentionSoundPlayer'
import { ATTENTION_SOUND_LIMITS, type AttentionSoundImportResult } from '../shared/contracts/attentionSound'
import { customAttentionSoundPath, migrateAttentionSoundSettings, readAttentionSoundSettings, writeAttentionSoundSettings } from './attentionSoundSettings'

let importing = false
/** Validate the actual bytes locally, then normalize to the format every OS player accepts. */
export async function importAttentionSound(file: string): Promise<AttentionSoundImportResult> {
  if (importing) return { ok: false, reason: 'save-failed' }
  importing = true
  let temp: string | undefined
  const target = customAttentionSoundPath()
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > ATTENTION_SOUND_LIMITS.bytes || !/\.(wav|mp3|aiff|m4a)$/i.test(file)) {
      return { ok: false, reason: 'invalid' }
    }
    const metadata = await probeMediaMetadata(file, { timeoutMs: 5000 })
    const durationSeconds = metadata.durationSeconds
    if (!metadata.hasAudio || metadata.kind !== 'audio' || !durationSeconds || durationSeconds > ATTENTION_SOUND_LIMITS.seconds) {
      return { ok: false, reason: 'invalid' }
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    temp = await fs.mkdtemp(path.join(path.dirname(target), '.import-'))
    const output = path.join(temp, 'attention.wav')
    const ffmpeg = resolveFfmpegPath()
    if (!ffmpeg) return { ok: false, reason: 'invalid' }
    const result = await runBoundedProcess(ffmpeg, ['-nostdin', '-protocol_whitelist', MEDIA_DECODER_PROTOCOL_WHITELIST,
      '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-t', String(ATTENTION_SOUND_LIMITS.seconds), output],
    { timeoutMs: 10000, maxStdoutBytes: 1024, maxStderrBytes: 8192 })
    if (result.code !== 0) return { ok: false, reason: 'invalid' }
    const normalized = await probeMediaMetadata(output, { timeoutMs: 5000 })
    if (!normalized.durationSeconds) return { ok: false, reason: 'invalid' }
    stopAttentionSound()
    const backup = path.join(temp, 'previous.wav')
    const hadPrevious = await fs.copyFile(target, backup).then(() => true, () => false)
    await renameWithRetry(output, target)
    try {
      const settings = writeAttentionSoundSettings({ ...readAttentionSoundSettings(), custom: { name: path.basename(file), durationSeconds: normalized.durationSeconds } })
      return { ok: true, settings }
    } catch {
      if (hadPrevious) await fs.copyFile(backup, target)
      else await fs.rm(target, { force: true })
      return { ok: false, reason: 'save-failed' }
    }
  } catch { return { ok: false, reason: 'invalid' } }
  finally { importing = false; if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined) }
}

export function registerAttentionSoundIpc(): void {
  try { migrateAttentionSoundSettings() } catch (error) { logCrash('attention-sound:migration', error) }
  ipcMain.handle('nomi:settings:attention-sound-get', (event) => { assertTrustedSender(event); return readAttentionSoundSettings() })
  ipcMain.handle('nomi:settings:attention-sound-set', (event, value: unknown) => {
    assertTrustedSender(event)
    const current = readAttentionSoundSettings()
    const raw = value && typeof value === 'object' ? value : {}
    const next = writeAttentionSoundSettings({ ...current, ...raw, custom: current.custom })
    if (!next.enabled) stopAttentionSound()
    return next
  })
  ipcMain.handle('nomi:settings:attention-sound-pick', async (event) => {
    assertTrustedSender(event)
    const selection = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'aiff', 'm4a'] }] })
    if (selection.canceled || !selection.filePaths[0]) return { ok: false, reason: 'canceled' }
    return importAttentionSound(selection.filePaths[0])
  })
  ipcMain.handle('nomi:settings:attention-sound-reset', (event) => {
    assertTrustedSender(event)
    stopAttentionSound()
    return writeAttentionSoundSettings({ ...readAttentionSoundSettings(), custom: null })
  })
  ipcMain.handle('nomi:settings:attention-sound-preview', async (event) => { assertTrustedSender(event); return { ok: await playAttentionSound(true) } })
  ipcMain.handle('nomi:settings:attention-sound-stop', (event) => { assertTrustedSender(event); stopAttentionSound() })
}
