import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

const run = promisify(execFile)
const probe = new URL('./fixtures/uiIpcProbe.mjs', import.meta.url).href
const driver = fileURLToPath(new URL('./ui-driver.mjs', import.meta.url))
const client = fileURLToPath(new URL('./ui.mjs', import.meta.url))
const dir = makeTempDir('ui-ipc-publication-')
const ipc = name => path.join(dir, name)
const options = { env: { ...process.env, NOMI_UI_DIR: dir }, timeout: 10_000 }
const ui = action => run(process.execPath, ['--import', probe, client, action], options)
const launchArgs = ['--import', probe, driver, '--out', ipc('out')]
let driverRun
let state
let ready
let response
let deadStage
let liveStage
let stageDirectory
let stageSymlink

beforeAll(async () => {
  // Kill a real writer while its complete state is staged but unpublished.
  const writer = new URL('./uiIpcFile.mjs', import.meta.url).href
  const crash = run(process.execPath, ['--import', probe, '--input-type=module', '-e',
    `import { writeUiIpcFile } from ${JSON.stringify(writer)}
     writeUiIpcFile(process.argv[1], '{}')`, ipc('state.json')], {
    ...options, env: { ...options.env, NOMI_TEST_CRASH_AT_STATE: '1' },
  })
  // Windows reports forced termination as an exit code; the unpublished stage proves where it stopped.
  await expect(crash).rejects.toThrow()
  expect(fs.existsSync(ipc('state.json'))).toBe(false)
  const deadPid = crash.child.pid
  deadStage = fs.readdirSync(dir).find(name => name.includes(String(deadPid)) && name.endsWith('.tmp'))
  expect(deadStage).toBeTruthy()
  liveStage = deadStage.replace(String(deadPid), String(process.pid))
  stageDirectory = deadStage.replace(/[a-f0-9-]{36}\.tmp$/, randomUUID() + '.tmp')
  stageSymlink = deadStage.replace(/[a-f0-9-]{36}\.tmp$/, randomUUID() + '.tmp')
  fs.mkdirSync(ipc(stageDirectory))
  fs.writeFileSync(ipc(liveStage), 'live')
  fs.writeFileSync(ipc('other-' + deadStage), 'foreign')
  if (process.platform !== 'win32') fs.symlinkSync(ipc(liveStage), ipc(stageSymlink))
  driverRun = run(process.execPath, launchArgs, { env: options.env, timeout: 45_000, killSignal: 'SIGKILL' })
  // Surface startup failure immediately and always reap the child.
  await Promise.race([
    vi.waitFor(() => expect(fs.existsSync(ipc('ready'))).toBe(true), { timeout: 10_000 }),
    driverRun.then(() => { throw new Error('driver exited before ready') }),
  ])
  ready = fs.readFileSync(ipc('ready'), 'utf8')
  state = JSON.parse(fs.readFileSync(ipc('state.json'), 'utf8'))
  response = JSON.parse((await ui('features')).stdout)
})

afterAll(async () => {
  if (!driverRun) return
  try {
    if (fs.existsSync(ipc('ready'))) await ui('down')
  } finally {
    if (driverRun.child.exitCode === null) driverRun.child.kill('SIGKILL')
    await driverRun
  }
})

test.each(['req.json', 'res.json', 'state.json'])('%s is complete at its real publication', name => {
  const first = fs.readFileSync(ipc('first-' + name), 'utf8')
  expect(first, name + ' was visible before its content').not.toBe('')
  const expected = { 'req.json': { action: 'features' }, 'res.json': response, 'state.json': state }
  expect(JSON.parse(first)).toEqual(expected[name])
  expect(response.features.library).toBeTruthy()
  expect(state.driverPid).toBe(driverRun.child.pid)
})

test('restart reclaims the killed writer’s stage and preserves active and foreign entries', () => {
  expect(fs.existsSync(ipc(deadStage))).toBe(false)
  expect(fs.readFileSync(ipc(liveStage), 'utf8')).toBe('live')
  expect(fs.readFileSync(ipc('other-' + deadStage), 'utf8')).toBe('foreign')
  expect(fs.lstatSync(ipc(stageDirectory)).isDirectory()).toBe(true)
  if (process.platform !== 'win32') expect(fs.lstatSync(ipc(stageSymlink)).isSymbolicLink()).toBe(true)
})

test('driver publishes the supported version in ready', () => {
  expect(JSON.parse(ready)).toMatchObject({ ipcVersion: 2 })
})

test.each(['123', '{"ipcVersion":1}', '{'])('rejects ready %s before touching the mailbox', async marker => {
  fs.writeFileSync(ipc('ready'), marker)
  const journal = fs.readFileSync(ipc('out/commands.jsonl'), 'utf8')
  const receipt = fs.readFileSync(ipc('res.json'), 'utf8')
  try {
    await expect(ui('features')).rejects.toMatchObject({ stderr: expect.stringMatching(/IPC.*down.*up/s) })
    expect(fs.existsSync(ipc('req.json'))).toBe(false)
    expect(fs.readFileSync(ipc('out/commands.jsonl'), 'utf8')).toBe(journal)
    expect(fs.readFileSync(ipc('res.json'), 'utf8')).toBe(receipt)
  } finally {
    fs.writeFileSync(ipc('ready'), ready)
  }
})

test.each(['down', 'quit', 'stop'])('%s can stop a legacy peer while its receipt is incomplete', async action => {
  const legacy = makeTempDir('ui-ipc-legacy-')
  fs.writeFileSync(path.join(legacy, 'ready'), String(process.pid))
  const command = execFile(process.execPath, [client, action], {
    ...options, env: { ...options.env, NOMI_UI_DIR: legacy },
  })
  const exit = once(command, 'exit')
  try {
    const request = path.join(legacy, 'req.json')
    await vi.waitFor(() => expect(fs.existsSync(request)).toBe(true))
    expect(JSON.parse(fs.readFileSync(request, 'utf8'))).toEqual({ action: 'quit' })
    fs.writeFileSync(path.join(legacy, 'res.json'), '{')
    expect(await exit).toEqual([0, null])
  } finally {
    if (command.exitCode === null) command.kill()
  }
})
