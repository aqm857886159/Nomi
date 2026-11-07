import { DOMParser } from '@xmldom/xmldom'
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { URL } from 'node:url'

export const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']
const boundary = fs.readFileSync(new URL('./powershell-boundary.ps1', import.meta.url), 'utf8')

export function encodedPowerShell(script) {
  return Buffer.from(`${boundary}\nInvoke-NomiHarnessScript {\n${script}\n}`, 'utf16le').toString('base64')
}

// CLIXML strings: XML entities are decoded by xmldom, then PowerShell's UTF-16 escapes.
// Official ErrorRecord shape: MS-PSRP 2.2.2.20; string/stream framing: ConsoleHost Serialization.cs.
const decodeString = (value) => value.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
export function powerShellErrorText(stderr = '') {
  return String(stderr).replace(/#< CLIXML\s*([\s\S]*?<\/Objs>)/g, (_, xml) => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    return Array.from(doc.documentElement.childNodes).filter((node) => node.nodeType === 1 && node.getAttribute('S').toLowerCase() === 'error').map((node) => {
      if (node.localName === 'S') return decodeString(node.textContent)
      const strings = Array.from(node.getElementsByTagName('S'))
      const message = strings.find((item) => item.getAttribute('N') === 'Message')
      const position = strings.find((item) => item.getAttribute('N') === 'PositionMessage')
      const text = message?.textContent || node.getElementsByTagName('ToString')[0]?.textContent || node.textContent
      return decodeString([text, position?.textContent].filter(Boolean).join('\n'))
    }).join('\n')
  }).trim()
}

export function powerShellFailure(result, label = 'powershell') {
  const details = [result.error?.message || result.error, result.stdout?.trim(), powerShellErrorText(result.stderr)].filter(Boolean).join('\n')
  return `${label} exited ${result.status}: ${details || `没有错误原文、退出 ${result.status}`}`
}

export function powershell(script) {
  const result = spawnSync('powershell.exe', [...POWERSHELL, '-EncodedCommand', encodedPowerShell(script)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0 || result.error) throw new Error(powerShellFailure(result))
  return result.stdout.trim()
}

/** Capture before readiness is awaited; close includes the final stderr/stdout chunks. */
export function spawnPowerShell(args) {
  const child = spawn('powershell.exe', [...POWERSHELL, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const result = { status: null, stdout: '', stderr: '', error: null, closed: false }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { result.stdout += chunk })
  child.stderr.on('data', (chunk) => { result.stderr += chunk })
  child.once('error', (error) => { result.error = error })
  const done = new Promise((resolve) => child.once('close', (code) => {
    result.status = code
    result.closed = true
    resolve(result)
  }))
  return { child, result, done }
}
