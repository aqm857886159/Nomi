import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { pidAlive } from './uiDriverOptions.mjs'
import { reclaimUiIpcFiles, writeUiIpcFile } from './uiIpcFile.mjs'

const run = promisify(execFile)
const probe = new URL('./fixtures/uiIpcProbe.mjs', import.meta.url).href
const writer = new URL('./uiIpcFile.mjs', import.meta.url).href
const driver = fileURLToPath(new URL('./ui-driver.mjs', import.meta.url))
const client = fileURLToPath(new URL('./ui.mjs', import.meta.url))
const dir = makeTempDir('ui-ipc-publication-')
const ipc = name => path.join(dir, name)
const options = { env: { ...process.env, NOMI_UI_DIR: dir }, timeout: 10_000 }
const ui = action => run(process.execPath, ['--import', probe, client, action], options)
const launchArgs = ['--import', probe, driver, '--out', ipc('out')]
const withProbeNodeOptions = (env) => ({
  ...env,
  NODE_OPTIONS: [env.NODE_OPTIONS, `--import=${probe}`].filter(Boolean).join(' '),
})

let driverRun
let state
let ready
let response
let deadPid
let deadStage
let liveStage
let stageDirectory
let stageSymlink

beforeAll(async () => {
  // Kill a real writer while its complete state is staged but unpublished.
  const crash = run(process.execPath, ['--import', probe, '--input-type=module', '-e',
    `import { writeUiIpcFile } from ${JSON.stringify(writer)}
     writeUiIpcFile(process.argv[1], '{}')`, ipc('state.json')], {
    ...options, env: { ...options.env, NOMI_TEST_CRASH_AT_STATE: '1' },
  })
  // Windows reports forced termination as an exit code; the unpublished stage proves where it stopped.
  await expect(crash).rejects.toThrow()
  expect(fs.existsSync(ipc('state.json'))).toBe(false)
  deadPid = crash.child.pid
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

test('writeUiIpcFile rejects short writes before rename and removes the incomplete stage', () => {
  const stageDir = makeTempDir('ui-ipc-short-write-')
  const target = path.join(stageDir, 'req.json')
  const realWriteSync = fs.writeSync
  let calls = 0
  const writeSpy = vi.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset = 0, length = buffer.length - offset, position) => {
    calls += 1
    if (calls === 1) return realWriteSync(fd, buffer, offset, Math.min(4, length), position)
    return 0
  })
  try {
    expect(() => writeUiIpcFile(target, '{"action":"features","extra":"payload"}')).toThrow(/Short write/i)
    expect(fs.existsSync(target)).toBe(false)
    expect(fs.readdirSync(stageDir)).toEqual([])
  } finally {
    writeSpy.mockRestore()
  }
})

test('probe keeps the first-visible partial write even when a later atomic rename overwrites the target', async () => {
  const probeDir = makeTempDir('ui-ipc-probe-first-')
  const script = `
    import fs from 'node:fs'
    import path from 'node:path'
    import { writeUiIpcFile } from ${JSON.stringify(writer)}
    const dir = process.env.NOMI_UI_DIR
    fs.writeFileSync(path.join(dir, 'res.json'), '{"half":')
    writeUiIpcFile(path.join(dir, 'res.json'), '{"ok":true}')
    const halfStage = path.join(dir, '.half-state.tmp')
    fs.writeFileSync(halfStage, '{"half":')
    fs.renameSync(halfStage, path.join(dir, 'state.json'))
    writeUiIpcFile(path.join(dir, 'state.json'), '{"ok":true}')
  `
  await run(process.execPath, ['--import', probe, '--input-type=module', '-e', script], {
    ...options,
    env: { ...options.env, NOMI_UI_DIR: probeDir },
  })
  expect(fs.readFileSync(path.join(probeDir, 'res.json'), 'utf8')).toBe('{"ok":true}')
  const firstRes = fs.readFileSync(path.join(probeDir, 'first-res.json'), 'utf8')
  expect(firstRes).toBe('')
  expect(() => JSON.parse(firstRes)).toThrow()

  expect(fs.readFileSync(path.join(probeDir, 'state.json'), 'utf8')).toBe('{"ok":true}')
  const firstState = fs.readFileSync(path.join(probeDir, 'first-state.json'), 'utf8')
  expect(firstState).toBe('{"half":')
  expect(() => JSON.parse(firstState)).toThrow()
})

test('restart reclaims the killed writer’s stage when ownership is verifiable and preserves active and foreign entries', () => {
  expect(fs.existsSync(ipc(deadStage))).toBe(typeof process.getuid !== 'function')
  expect(fs.readFileSync(ipc(liveStage), 'utf8')).toBe('live')
  expect(fs.readFileSync(ipc('other-' + deadStage), 'utf8')).toBe('foreign')
  expect(fs.lstatSync(ipc(stageDirectory)).isDirectory()).toBe(true)
  if (process.platform !== 'win32') expect(fs.lstatSync(ipc(stageSymlink)).isSymbolicLink()).toBe(true)
})

test('reclaimUiIpcFiles preserves dead-PID stages when process.getuid is unavailable or mismatches owner', () => {
  const reclaimDir = makeTempDir('ui-ipc-reclaim-uid-')
  const orphan = path.join(reclaimDir, `.nomi-ui-ipc-p${deadPid}-${randomUUID()}.tmp`)
  fs.writeFileSync(orphan, '{"orphan":true}')
  const stat = fs.lstatSync(orphan)
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'getuid')
  try {
    Object.defineProperty(process, 'getuid', { value: undefined, configurable: true, writable: true })
    expect(reclaimUiIpcFiles(reclaimDir)).toEqual([])
    expect(fs.existsSync(orphan)).toBe(true)

    Object.defineProperty(process, 'getuid', { value: () => stat.uid + 1, configurable: true, writable: true })
    expect(reclaimUiIpcFiles(reclaimDir)).toEqual([])
    expect(fs.existsSync(orphan)).toBe(true)
  } finally {
    if (originalDescriptor) Object.defineProperty(process, 'getuid', originalDescriptor)
    else delete process.getuid
  }
  if (typeof process.getuid === 'function') {
    expect(reclaimUiIpcFiles(reclaimDir)).toEqual([path.basename(orphan)])
    expect(fs.existsSync(orphan)).toBe(false)
  }
})

test('real ui.mjs up verifies ready ipcVersion and spawned driverPid', async () => {
  const upDir = makeTempDir('ui-ipc-real-up-')
  const upOut = path.join(upDir, 'out')
  const upEnv = withProbeNodeOptions({ ...process.env, NOMI_UI_DIR: upDir })
  let spawnedPid = null
  try {
    const started = await run(process.execPath, [client, 'up', '--out', upOut], { env: upEnv, timeout: 15_000 })
    expect(started.stdout).toContain('READY')
    const upReady = JSON.parse(fs.readFileSync(path.join(upDir, 'ready'), 'utf8'))
    const upState = JSON.parse(fs.readFileSync(path.join(upDir, 'state.json'), 'utf8'))
    const lockPid = Number(fs.readFileSync(path.join(upDir, 'instance.lock'), 'utf8').trim())
    spawnedPid = upReady.driverPid
    expect(upReady).toMatchObject({ ipcVersion: 2, driverPid: lockPid })
    expect(upState.driverPid).toBe(lockPid)
    expect(spawnedPid).not.toBe(process.pid)
    expect(pidAlive(spawnedPid)).toBe(true)

    await run(process.execPath, [client, 'down'], { env: upEnv, timeout: 15_000 })
    expect(pidAlive(spawnedPid)).toBe(false)
    spawnedPid = null
  } finally {
    if (spawnedPid && pidAlive(spawnedPid)) {
      try {
        await run(process.execPath, [client, 'down'], { env: upEnv, timeout: 10_000 })
      } catch {
        try { process.kill(spawnedPid, 'SIGKILL') } catch { /* already gone */ }
      }
    }
  }
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

test.each(['down', 'quit', 'stop'])('%s waits for the instance.lock holder to exit even when its receipt is incomplete', async action => {
  const legacy = makeTempDir('ui-ipc-legacy-')
  const lockPath = path.join(legacy, 'instance.lock')
  const readyPath = path.join(legacy, 'ready')
  const reqPath = path.join(legacy, 'req.json')
  const resPath = path.join(legacy, 'res.json')
  const receiptWrittenPath = path.join(legacy, 'receipt-written')
  const releasePeerPath = path.join(legacy, 'release-peer')
  const peerScript = `
    import fs from 'node:fs'
    import path from 'node:path'
    const dir = process.argv[1]
    fs.writeFileSync(path.join(dir, 'instance.lock'), String(process.pid), { flag: 'wx' })
    fs.writeFileSync(path.join(dir, 'ready'), String(process.pid))
    const req = path.join(dir, 'req.json')
    const res = path.join(dir, 'res.json')
    const written = path.join(dir, 'receipt-written')
    const release = path.join(dir, 'release-peer')
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    while (!fs.existsSync(req)) await sleep(20)
    fs.writeFileSync(res, '{')
    fs.writeFileSync(written, '1')
    while (!fs.existsSync(release)) await sleep(20)
    process.exit(0)
  `
  const peer = execFile(process.execPath, ['--input-type=module', '-e', peerScript, legacy], { timeout: 20_000 })
  let peerExitedAt = null
  const peerExit = once(peer, 'exit').then((result) => {
    peerExitedAt = Date.now()
    return result
  })
  let command = null
  let commandExited = false
  let commandExitedAt = null
  try {
    await vi.waitFor(() => {
      expect(fs.existsSync(lockPath)).toBe(true)
      expect(fs.existsSync(readyPath)).toBe(true)
    })
    expect(Number(fs.readFileSync(lockPath, 'utf8').trim())).toBe(peer.pid)

    command = execFile(process.execPath, [client, action], {
      ...options, env: { ...options.env, NOMI_UI_DIR: legacy },
    })
    const commandExit = once(command, 'exit').then((result) => {
      commandExited = true
      commandExitedAt = Date.now()
      return result
    })

    await vi.waitFor(() => expect(fs.existsSync(receiptWrittenPath)).toBe(true))
    expect(JSON.parse(fs.readFileSync(reqPath, 'utf8'))).toEqual({ action: 'quit' })
    expect(fs.readFileSync(resPath, 'utf8')).toBe('{')

    // Keep the lock holder alive past multiple down() poll ticks: down must NOT return early on res.json.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(peer.exitCode).toBeNull()
    expect(commandExited).toBe(false)

    fs.writeFileSync(releasePeerPath, 'go')
    expect(await peerExit).toEqual([0, null])
    expect(await commandExit).toEqual([0, null])
    expect(commandExitedAt).toBeGreaterThanOrEqual(peerExitedAt)
    expect(pidAlive(peer.pid)).toBe(false)
  } finally {
    if (peer.exitCode === null) peer.kill('SIGKILL')
    if (command && command.exitCode === null) command.kill('SIGKILL')
    await peerExit.catch(() => {})
  }
})
