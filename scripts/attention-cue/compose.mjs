#!/usr/bin/env node
// Original deterministic cues: change the score/timbre below, then rerun this file.
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const sound = {
  sampleRate: 48000,
  tonicMidi: 60,
  scale: [0, 2, 4, 7, 9], // do re mi sol la (anhemitonic pentatonic)
  harmonics: [1, 0.24, 0.08],
  attack: 0.009,
  decay: 0.24,
  release: 0.18,
  gain: 0.36,
}
export const scores = {
  a: { degrees: [2, 3, 5], onsets: [0, 0.32, 0.68], lengths: [0.65, 0.65, 1.12], duration: 1.9 },
  b: { degrees: [0, 2, 1, 0], onsets: [0, 0.32, 0.64, 1.00], lengths: [0.65, 0.65, 0.65, 1.12], duration: 2.25 },
  c: { degrees: [0, 3, 5], onsets: [0, 0.24, 0.52], lengths: [0.6, 0.6, 1.08], duration: 1.7 },
}

export function compose(score, voice = sound) {
  const count = Math.round(score.duration * voice.sampleRate)
  const wav = Buffer.alloc(44 + count * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(voice.sampleRate, 24)
  wav.writeUInt32LE(voice.sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(count * 2, 40)
  const frequencies = score.degrees.map((degree) => {
    const midi = voice.tonicMidi + voice.scale[degree % voice.scale.length] + 12 * Math.floor(degree / voice.scale.length)
    return 440 * 2 ** ((midi - 69) / 12)
  })
  for (let i = 0; i < count; i++) {
    let sample = 0
    frequencies.forEach((frequency, note) => {
      const t = i / voice.sampleRate - score.onsets[note]
      const length = score.lengths[note]
      if (t < 0 || t >= length) return
      const attack = Math.min(1, t / voice.attack)
      const release = Math.min(1, (length - t) / voice.release)
      voice.harmonics.forEach((amplitude, harmonic) => {
        // Higher partials decay faster, like a gently struck wooden bar.
        sample += amplitude * Math.sin(2 * Math.PI * frequency * (harmonic + 1) * t)
          * Math.exp(-t * (1 + harmonic * 0.65) / voice.decay) * attack * release
      })
    })
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample * voice.gain)) * 32767), 44 + i * 2)
  }
  return wav
}

// This script is also imported by the verification test; importing does not write files.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = new URL('./candidates/', import.meta.url)
  mkdirSync(output, { recursive: true })
  for (const [name, score] of Object.entries(scores)) {
    const wav = compose(score)
    const destination = name === "b" ? new URL("../../assets/sound/nomi-attention.wav", import.meta.url) : new URL(`${name}.wav`, output)
    mkdirSync(new URL(".", destination), { recursive: true })
    writeFileSync(destination, wav)
    console.log(`${name}: ${score.duration}s, ${wav.length} bytes`)
  }
}
