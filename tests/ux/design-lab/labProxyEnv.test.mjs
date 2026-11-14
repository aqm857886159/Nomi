// 本机带代理环境变量时，门岗起的子进程仍然探得到本机服务（2026-11-14）。
//
// 用的是 Playwright 的 webServer 自己探服务的那个函数（playwright-core 的 isURLAvailable），
// 在子进程里按门岗给的环境变量真探一次：起一个本机 http 服务，HTTP_PROXY 指向一个没人听的口。
// 不经 labChildEnv 时探测被「代理」截走、探不到；经过它就探得到。
import http from 'node:http'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { labChildEnv } from './labServer.mjs'

const requireFromHere = createRequire(import.meta.url)
const playwrightDir = requireFromHere.resolve('@playwright/test/package.json')
const coreBundle = createRequire(createRequire(playwrightDir).resolve('playwright/package.json')).resolve('playwright-core/lib/coreBundle')

const PROBE = `
const { utils } = require(process.argv[1])
utils.isURLAvailable(new URL(process.argv[2]), false, () => {}, () => {})
  .then((ok) => { process.stdout.write(ok ? 'up' : 'down') }, (error) => { process.stdout.write('error ' + error.message) })
`

let server
let origin
beforeAll(async () => {
  server = http.createServer((_request, response) => { response.end('ok') })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}/`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))

// 必须异步起子进程：本机服务就在这个进程里，同步等子进程会把它自己堵死、谁都探不到。
function probe(env) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['-e', PROBE, coreBundle, origin], { env, encoding: 'utf8', timeout: 30_000 }, (_error, stdout) => resolve(stdout))
  })
}

// 一个没人监听的口当「代理」：请求一旦被导过去就必然失败。
const FAKE_PROXY = 'http://127.0.0.1:9'
const proxied = () => {
  const env = { ...process.env, HTTP_PROXY: FAKE_PROXY, http_proxy: FAKE_PROXY, HTTPS_PROXY: FAKE_PROXY, https_proxy: FAKE_PROXY }
  delete env.NO_PROXY
  delete env.no_proxy
  return env
}

describe('门岗子进程的代理环境变量', () => {
  it('对照：带假代理、不补 NO_PROXY 时，Playwright 探不到本机服务（这正是误报的来路）', async () => {
    expect(await probe(proxied())).not.toBe('up')
  })

  it('经 labChildEnv 补上本机地址后，同样带着假代理也探得到', async () => {
    expect(await probe(labChildEnv(proxied()))).toBe('up')
  })

  it('和已有 NO_PROXY 合并，不覆盖、不重复', () => {
    const env = labChildEnv({ NO_PROXY: 'corp.example, localhost' })
    expect(env.NO_PROXY).toBe('corp.example,localhost,127.0.0.1')
    expect(env.no_proxy).toBe('corp.example,localhost,127.0.0.1')
    expect(labChildEnv({}).NO_PROXY).toBe('127.0.0.1,localhost')
  })
})
