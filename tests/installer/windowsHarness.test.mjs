import fs from 'node:fs'
import { URL } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')
const runner = read('./windows-installer-scenarios.mjs')
const watcher = read('./dialog-watcher.ps1')

describe('Windows harness static execution contract (Mac has no PowerShell)', () => {
  it('routes all inline PowerShell and the -File watcher through the shared boundary', () => {
    expect(runner).toContain("from './powershell.mjs'")
    expect(runner).not.toContain(".toString('base64')")
    expect(runner).not.toContain("spawn('powershell.exe'")
    expect(runner).not.toContain("spawnSync('powershell.exe'")
    expect(watcher).toContain('powershell-boundary.ps1')
    expect(watcher).toContain('Invoke-NomiHarnessScript {')
  })
  it('never sets script-level SilentlyContinue or deletes files via PowerShell', () => {
    for (const source of [runner, watcher]) expect(source).not.toMatch(/\$ErrorActionPreference\s*=\s*['"]SilentlyContinue['"]/i)
    expect(runner).not.toMatch(/Remove-Item -LiteralPath (?:\$\{|\(Join-Path)/)
  })
})

// The real progress-only stderr from run 41008253991, copied byte-for-byte after
// the gh log timestamp prefix. Progress must never masquerade as an error.
// ErrorRecord fixture shape: Microsoft MS-PSRP §2.2.2.20 (checked 2026-10-30):
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-psrp/c527797a-d017-4755-8a81-9f58280a7135
// ConsoleHost stream framing:
// https://github.com/PowerShell/PowerShell/blob/master/src/Microsoft.PowerShell.ConsoleHost/host/msh/Serialization.cs
import { Buffer } from 'node:buffer'
import { encodedPowerShell, powerShellErrorText, powerShellFailure } from './powershell.mjs'

const xml = (body) => `#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">${body}</Objs>`

describe('PowerShell failure diagnostics', () => {
  it('reports exit 1 with no error text for the real progress-only CI stderr', () => {
    const stderr = read('./fixtures/powershell-progress.clixml')
    expect(powerShellErrorText(stderr)).toBe('')
    expect(powerShellFailure({ status: 1, stdout: '', stderr })).toBe('powershell exited 1: 没有错误原文、退出 1')
  })
  it('extracts the error stream, XML entities and UTF-16 escapes without progress noise', () => {
    const stderr = xml('<Obj S="progress"><MS><S N="Activity">Preparing modules</S></MS></Obj><S S="error">Get-Item : missing &lt;项目&gt; &amp; file_x000D__x000A_At line:1_x000D__x000A_literal _x005F_x0041_</S>')
    expect(powerShellErrorText(stderr)).toBe('Get-Item : missing <项目> & file\r\nAt line:1\r\nliteral _x0041_')
  })
  it('reads an ErrorRecord object and its invocation position', () => {
    const stderr = xml('<Obj S="error" RefId="0"><TN RefId="0"><T>System.Management.Automation.ErrorRecord</T><T>System.Object</T></TN><ToString>Cannot open file</ToString><MS><Obj N="Exception" RefId="1"><ToString>System.IO.IOException: Cannot open file</ToString><Props><S N="Message">Cannot open file</S></Props></Obj><Obj N="InvocationInfo" RefId="2"><Props><S N="PositionMessage">At line:4 char:2_x000D__x000A_+ Get-Item</S></Props></Obj></MS></Obj>')
    expect(powerShellErrorText(stderr)).toBe('Cannot open file\nAt line:4 char:2\r\n+ Get-Item')
  })
  it('keeps wrapper stdout even when stderr contains progress and keeps plain parser/spawn failures', () => {
    expect(powerShellFailure({ status: 1, stdout: '[NOMI_HARNESS_ERROR]\nmissing file\nAt line:4', stderr: read('./fixtures/powershell-progress.clixml') })).toBe('powershell exited 1: [NOMI_HARNESS_ERROR]\nmissing file\nAt line:4')
    expect(powerShellFailure({ status: 1, stderr: 'ParserError: missing brace' })).toContain('ParserError: missing brace')
    expect(powerShellFailure({ status: null, error: new Error('spawn ENOENT') })).toContain('spawn ENOENT')
  })
  it('wraps every encoded body in Stop, try/catch, explicit exits and marked original stdout diagnostics', () => {
    const wrapped = Buffer.from(encodedPowerShell('Get-Item missing'), 'base64').toString('utf16le')
    expect(wrapped).toContain("$ErrorActionPreference = 'Stop'")
    expect(wrapped).toContain('try {\n    & $Body\n    exit 0')
    expect(wrapped).toContain('} catch {')
    expect(wrapped).toContain("[Console]::Out.WriteLine('[NOMI_HARNESS_ERROR]')")
    expect(wrapped).toContain('[Console]::Out.WriteLine($_.Exception.Message)')
    expect(wrapped).toContain('[Console]::Out.WriteLine($_.InvocationInfo.PositionMessage)')
    expect(wrapped).toContain('exit 1')
    expect(wrapped).toContain('Invoke-NomiHarnessScript {\nGet-Item missing\n}')
    expect(wrapped).not.toMatch(/\$ErrorActionPreference\s*=\s*['"]SilentlyContinue/)
  })
  it('does not suppress the missing attributes or failed registry writes predicted by the review', () => {
    expect(runner).toContain('(Get-Item -LiteralPath $_ -Force).Attributes.ToString()')
    expect(runner).toContain('New-ItemProperty -LiteralPath $key')
    expect(runner).not.toContain('-ErrorAction SilentlyContinue')
    expect(runner).not.toMatch(/function powershell\(/)
    expect(runner.match(/\bpowershell\(/g)).toHaveLength(10)
    expect(runner).toContain('await watcherProcess.done')
    expect(runner).toContain('watcherResult.status !== 0')
    expect(runner).toContain('lock helper ended before release')
    expect(runner).toContain('!outcome.cleanupError')
  })
})
