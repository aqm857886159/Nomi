import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { intakeConfigPath, intakeConfigured, intakeEndpoint, intakeToken, postIntake, resetIntakeConfigCache } from './intakeClient'

const ORIGINAL = { endpoint: process.env.NOMI_INTAKE_ENDPOINT, token: process.env.NOMI_INTAKE_TOKEN }

afterEach(() => {
  process.env.NOMI_INTAKE_ENDPOINT = ORIGINAL.endpoint
  process.env.NOMI_INTAKE_TOKEN = ORIGINAL.token
  if (ORIGINAL.endpoint === undefined) delete process.env.NOMI_INTAKE_ENDPOINT
  if (ORIGINAL.token === undefined) delete process.env.NOMI_INTAKE_TOKEN
  resetIntakeConfigCache()
})

describe('intake endpoint 解析', () => {
  it('没配就是 null，设置页据此显示「只在本机记录」', () => {
    delete process.env.NOMI_INTAKE_ENDPOINT
    expect(intakeEndpoint()).toBeNull()
    expect(intakeConfigured()).toBe(false)
  })

  it('明文 http 的**远端**当没配 —— 照发但不加密比降级更糟', () => {
    process.env.NOMI_INTAKE_TOKEN = 'token'
    for (const endpoint of ['http://intake.example', 'http://10.0.0.5:8787', 'http://127.0.0.1.evil.example', 'ftp://intake.example']) {
      process.env.NOMI_INTAKE_ENDPOINT = endpoint
      expect(intakeEndpoint(), endpoint).toBeNull()
    }
  })

  it('回环上的 http 放行：走查要往本机 mock 端点真发一次请求', () => {
    process.env.NOMI_INTAKE_TOKEN = 'token'
    for (const endpoint of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787']) {
      process.env.NOMI_INTAKE_ENDPOINT = endpoint
      expect(intakeEndpoint(), endpoint).toBe(endpoint)
      expect(intakeConfigured(), endpoint).toBe(true)
    }
  })

  it('尾斜杠剥干净，避免拼出 //v1/events', () => {
    process.env.NOMI_INTAKE_ENDPOINT = 'https://intake.example///'
    expect(intakeEndpoint()).toBe('https://intake.example')
  })

  it('端点有、令牌空 = 未配置（缺一个都发不出去）', () => {
    process.env.NOMI_INTAKE_ENDPOINT = 'https://intake.example'
    process.env.NOMI_INTAKE_TOKEN = '   '
    expect(intakeToken()).toBe('')
    expect(intakeConfigured()).toBe(false)
  })
})

describe('postIntake', () => {
  it('未配置时抛，不静默丢货', async () => {
    await expect(postIntake('/v1/events', { events: [] }, { endpoint: null, token: '' })).rejects.toThrow(/not configured/)
  })

  it('带 bearer、不带 cookie、路由拼在基址后面', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, ref: 'r1' }), { status: 200 }))
    const result = await postIntake('/v1/trajectories', { turn: 1 }, { fetch: fetch as never, endpoint: 'https://intake.example', token: 'tok' })
    expect(result).toEqual({ ref: 'r1' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://intake.example/v1/trajectories')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    // 带 cookie 就等于给了一个跨请求可关联的身份，而我们对用户说的是「匿名」。
    expect(init.credentials).toBe('omit')
    expect(init.body).toBe(JSON.stringify({ turn: 1 }))
  })

  it('反馈那条把编号带回来给用户引用', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'NF-0915-0042', ref: 'r2' }), { status: 200 }))
    const result = await postIntake('/v1/feedback', {}, { fetch: fetch as never, endpoint: 'https://intake.example', token: 'tok' })
    expect(result).toEqual({ id: 'NF-0915-0042', ref: 'r2' })
  })

  it('非 2xx 抛，让调用方入队重试', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 503 }))
    await expect(postIntake('/v1/events', {}, { fetch: fetch as never, endpoint: 'https://intake.example', token: 'tok' }))
      .rejects.toThrow(/HTTP 503/)
  })

  it('200 但回的不是 JSON（网关插了一页 HTML）算成功 —— 收到了，只是少一个把手', async () => {
    const fetch = vi.fn(async () => new Response('<html>ok</html>', { status: 200 }))
    await expect(postIntake('/v1/events', {}, { fetch: fetch as never, endpoint: 'https://intake.example', token: 'tok' }))
      .resolves.toEqual({})
  })

  it('回了数组或字符串也不炸，当空结果', async () => {
    for (const body of ['[]', '"done"', 'null']) {
      const fetch = vi.fn(async () => new Response(body, { status: 200 }))
      await expect(postIntake('/v1/events', {}, { fetch: fetch as never, endpoint: 'https://intake.example', token: 'tok' }))
        .resolves.toEqual({})
    }
  })

  it('超时会 abort（不许一个挂住的请求把后续都堵死）', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    await expect(postIntake('/v1/events', {}, { fetch: fetch as never, endpoint: 'https://intake.example', token: 'tok', timeoutMs: 1 }))
      .rejects.toThrow(/abort/i)
  })
})

// ── 出厂配置（W-01）──────────────────────────────────────────────────────────
// 这几条守的是 2026-09-17 那次静默出厂：装机版的 `process.env` 是用户桌面的环境，
// 里面永远没有这两个值，于是 0.21.0 出厂即「只在本机记录」。
describe('出厂烤进来的配置', () => {
  // 路径来自被测模块自己（`intakeConfigPath`），不在测试里抄一份——抄了就是第二个真相源。
  const bakedFile = intakeConfigPath()

  it('env 没定义时回落到打包时烤进去的那份', () => {
    delete process.env.NOMI_INTAKE_ENDPOINT
    delete process.env.NOMI_INTAKE_TOKEN
    withBaked({ version: 1, endpoint: 'https://intake.example', token: 'baked-token' }, () => {
      expect(intakeEndpoint()).toBe('https://intake.example')
      expect(intakeToken()).toBe('baked-token')
      expect(intakeConfigured()).toBe(true)
    })
  })

  it('env 只要**被定义**就赢，哪怕是空串 —— 走查靠它显式关掉出厂端点', () => {
    process.env.NOMI_INTAKE_ENDPOINT = ''
    process.env.NOMI_INTAKE_TOKEN = ''
    withBaked({ version: 1, endpoint: 'https://intake.example', token: 'baked-token' }, () => {
      expect(intakeEndpoint()).toBeNull()
      expect(intakeConfigured()).toBe(false)
    })
  })

  it('开发构建烤出来的是空配置 —— 开发版不发送', () => {
    delete process.env.NOMI_INTAKE_ENDPOINT
    delete process.env.NOMI_INTAKE_TOKEN
    withBaked({ version: 1, endpoint: '', token: '' }, () => {
      expect(intakeEndpoint()).toBeNull()
      expect(intakeConfigured()).toBe(false)
    })
  })

  function withBaked(config: unknown, body: () => void): void {
    const existed = fs.existsSync(bakedFile)
    const previous = existed ? fs.readFileSync(bakedFile) : null
    fs.mkdirSync(path.dirname(bakedFile), { recursive: true })
    fs.writeFileSync(bakedFile, JSON.stringify(config))
    resetIntakeConfigCache()
    try {
      body()
    } finally {
      if (previous) fs.writeFileSync(bakedFile, previous)
      else fs.rmSync(bakedFile, { force: true })
      resetIntakeConfigCache()
    }
  }
})
