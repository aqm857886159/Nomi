// 接收端的纯函数级测试：路由 / 认证 / 大小 / 编号 / 落盘布局。
// 用 node --test 跑（本机没装 wrangler，见 README），所以 R2 与 KV 各喂一个最小假实现。
// 这里刻意不测「wrangler dev 能不能起来」——那是部署步骤，不是代码判据。
import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../src/worker.mjs'

function fakeEnv({ token = 'dev-token', kv = true, bucket = true } = {}) {
  const puts = []
  const store = new Map()
  return {
    puts,
    env: {
      INTAKE_TOKEN: token,
      INTAKE_BUCKET: bucket ? { put: async (key, body, options) => { puts.push({ key, body, options }) } } : undefined,
      INTAKE_KV: kv
        ? {
          get: async (key) => store.get(key) ?? null,
          put: async (key, value) => { store.set(key, value) },
        }
        : undefined,
    },
  }
}

const post = (path, body, { token = 'dev-token', headers = {} } = {}) =>
  new Request(`https://intake.example/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

test('存活探针不泄露任何内部状态', async () => {
  const { env } = fakeEnv()
  const response = await worker.fetch(new Request('https://intake.example/'), env)
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.equal(text.trim(), 'nomi-feedback-intake')
  // 桶名、版本、条数都不许出现在探针里。
  assert.ok(!/bucket|version|count/i.test(text))
})

test('未知路由 404，GET 打到 POST 路由是 405', async () => {
  const { env } = fakeEnv()
  assert.equal((await worker.fetch(post('/v1/nope', {}), env)).status, 404)
  const get = new Request('https://intake.example/v1/feedback', { headers: { authorization: 'Bearer dev-token' } })
  assert.equal((await worker.fetch(get, env)).status, 405)
})

test('令牌不对一律 401，且在读 body 之前就拒', async () => {
  const { env, puts } = fakeEnv()
  for (const token of ['', 'wrong', 'dev-toke', 'dev-tokenn']) {
    const response = await worker.fetch(post('/v1/feedback', { summary: 'x' }, { token }), env)
    assert.equal(response.status, 401, `token=${JSON.stringify(token)} 应当 401`)
  }
  assert.equal(puts.length, 0, '认证失败不许落盘')
})

test('缺少 Authorization 头也是 401', async () => {
  const { env } = fakeEnv()
  const request = new Request('https://intake.example/v1/feedback', { method: 'POST', body: '{}' })
  assert.equal((await worker.fetch(request, env)).status, 401)
})

test('桶没绑 500 —— 静默丢数据比报错更糟', async () => {
  const { env } = fakeEnv({ bucket: false })
  assert.equal((await worker.fetch(post('/v1/feedback', { summary: 'x' }), env)).status, 500)
})

test('body 太大 413；content-length 撒谎也拦得住', async () => {
  const { env } = fakeEnv()
  const huge = JSON.stringify({ blob: 'x'.repeat(3 * 1024 * 1024) })
  assert.equal((await worker.fetch(post('/v1/feedback', huge), env)).status, 413)
  // 声明成 1 字节，实际三兆：实际长度必须再量一次。
  const lying = await worker.fetch(post('/v1/feedback', huge, { headers: { 'content-length': '1' } }), env)
  assert.equal(lying.status, 413)
})

test('不是 JSON 对象一律 400', async () => {
  const { env, puts } = fakeEnv()
  for (const body of ['not json', '[]', 'null', '"a string"', '42']) {
    assert.equal((await worker.fetch(post('/v1/events', body), env)).status, 400, `body=${body}`)
  }
  assert.equal(puts.length, 0)
})

test('反馈返回可引用编号，序号逐条递增，主键是 uuid', async () => {
  const { env, puts } = fakeEnv()
  const first = await (await worker.fetch(post('/v1/feedback', { summary: 'a' }), env)).json()
  const second = await (await worker.fetch(post('/v1/feedback', { summary: 'b' }), env)).json()
  assert.match(first.id, /^NF-\d{4}-\d{4}$/)
  assert.equal(Number(second.id.slice(-4)), Number(first.id.slice(-4)) + 1)
  assert.notEqual(first.ref, second.ref)
  // 落盘键用 uuid，不用编号：编号可能撞，uuid 不会（README 第 2 条）。
  assert.equal(puts.length, 2)
  for (const put of puts) assert.match(put.key, /^feedback\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.json$/)
  assert.notEqual(puts[0].key, puts[1].key)
})

test('KV 挂了反馈照样落盘，只是编号退化成随机', async () => {
  const { env, puts } = fakeEnv()
  env.INTAKE_KV = { get: async () => { throw new Error('kv down') }, put: async () => { throw new Error('kv down') } }
  const body = await (await worker.fetch(post('/v1/feedback', { summary: 'a' }), env)).json()
  assert.equal(body.ok, true)
  assert.match(body.id, /^NF-\d{4}-\d{4}$/)
  assert.equal(puts.length, 1, '编号只是把手，丢不得的是报告本身')
})

test('没绑 KV 也能收反馈', async () => {
  const { env, puts } = fakeEnv({ kv: false })
  const body = await (await worker.fetch(post('/v1/feedback', { summary: 'a' }), env)).json()
  assert.equal(body.ok, true)
  assert.equal(puts.length, 1)
})

test('事件不发编号，报接收条数', async () => {
  const { env, puts } = fakeEnv()
  const events = await (await worker.fetch(post('/v1/events', { events: [{ a: 1 }, { a: 2 }, { a: 3 }] }), env)).json()
  assert.equal(events.receipt, undefined)
  assert.equal(events.accepted, 3)
  assert.deepEqual(puts.map((put) => put.key.split('/')[0]), ['events'])
})

test('删掉的轨迹路由不再收（从没有发布版本发过）', async () => {
  const { env, puts } = fakeEnv()
  const response = await worker.fetch(post('/v1/trajectories', { turn: {} }), env)
  assert.notEqual(response.status, 200)
  assert.equal(puts.length, 0)
})

test('存下来的记录把客户端原文与到达元数据分开放，且不含身份信息', async () => {
  const { env, puts } = fakeEnv()
  const request = post('/v1/feedback', { summary: 'a', note: 'b' })
  request.headers.set('user-agent', 'Nomi/0.22.0')
  request.headers.set('cf-connecting-ip', '203.0.113.7')
  await worker.fetch(request, env)
  const record = JSON.parse(puts[0].body)
  assert.deepEqual(record.payload, { summary: 'a', note: 'b' })
  assert.equal(record.route, '/v1/feedback')
  assert.equal(record.schemaVersion, 1)
  assert.ok(record.receivedAt && record.ref && record.receipt)
  const serialized = puts[0].body
  assert.ok(!serialized.includes('203.0.113.7'), 'IP 不许落盘')
  assert.ok(!serialized.includes('Nomi/0.22.0'), 'User-Agent 不许落盘')
  assert.equal(puts[0].options.httpMetadata.contentType, 'application/json; charset=utf-8')
})
