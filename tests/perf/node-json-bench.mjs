#!/usr/bin/env node
// Generic subprocess adapter for non-UI instruments; metric policy belongs to the registry.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { readNodeMetricRuns } from '../../scripts/perf-scenarios-lib.mjs'

try {
  const { values, positionals } = parseArgs({ options: { instrument: { type: 'string' }, runs: { type: 'string' }, out: { type: 'string' } }, allowPositionals: true })
  const runs = Number(values.runs)
  if (!values.instrument || !values.out || !Number.isInteger(runs) || runs < 1) throw new Error('Use --instrument <node-script> --runs <count> --out <file> -- <instrument arguments>')
  if (positionals.some((arg) => /^(--runs|--out|--label)(=|$)/.test(arg))) throw new Error('Instrument arguments cannot override runs/out/label')
  const instrument = path.resolve(values.instrument), output = path.resolve(values.out)
  if (!fs.statSync(instrument).isFile()) throw new Error('Node instrument is not a file')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.rmSync(output, { force: true })
  const child = spawnSync(process.execPath, [instrument, ...positionals, '--runs', String(runs), '--out', output], { cwd: process.cwd(), env: process.env, stdio: 'inherit', timeout: 30 * 60 * 1000 })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Node instrument exited ${child.status}${child.signal ? ` (${child.signal})` : ''}`)
  let payload
  try { payload = JSON.parse(fs.readFileSync(output, 'utf8')) }
  catch (error) { throw new Error(`Invalid instrument JSON: ${error.message}`) }
  readNodeMetricRuns(payload, Object.keys(payload.metrics ?? {}), runs)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
