#!/usr/bin/env node
// IFEO Debugger: record and hold the real uninstaller before its first instruction.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const divider = process.argv.indexOf('--')
const stateIndex = process.argv.indexOf('--state')
if (divider < 0 || stateIndex < 0) throw new Error('IFEO gate requires --state <directory> -- <image> <original arguments>')
const dir = process.argv[stateIndex + 1]
const [originalImage, ...args] = process.argv.slice(divider + 1)
const image = path.join(dir, 'captured-uninstaller.exe')
const write = (name, value) => {
  const file = path.join(dir, name)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value))
  fs.renameSync(`${file}.tmp`, file)
}
try {
  fs.copyFileSync(originalImage, image)
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex')
  write('held.json', { originalImage, args, sha256, pid: process.pid })
  const deadline = Date.now() + 10 * 60_000
  while (!fs.existsSync(path.join(dir, 'release'))) {
    if (Date.now() > deadline) throw new Error('IFEO gate release timed out')
    await setTimeout(100)
  }
  // The runner removes IFEO before release. Preserve the raw NSIS argument tail, especially final _?=.
  const child = spawn(image, args, { windowsVerbatimArguments: true, stdio: 'ignore' })
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  write('finished.json', { exitCode })
  process.exitCode = exitCode ?? 1
} catch (error) {
  write('finished.json', { error: String(error), exitCode: 1 })
  process.exitCode = 1
}
