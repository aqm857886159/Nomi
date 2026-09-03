// 钉住 vitest 让路策略（2026-09-03）。
//
// 这个东西的失败模式是**静默的**：算错了没人会发现——测试照样跑、照样绿，只是机器继续被压垮、
// 超载超时继续假装成代码问题。所以这里把两条最要命的性质钉死：
//   1) 独占时必须返回 null（= 不传 flag），否则 CI 单跑会被平白限速；
//   2) 各家分到的份额加起来不能超过核数，否则「让路」根本没让。
// 还有一条容易写反的：**先登记再数**。顺序反了两个同时启动的进程会互相看不见，各自开满——
// 那正是本脚本要解决的问题，却会以「测试全绿」的样子躲过去。
//
// 随 check:vitest-fair-share 一起跑（package.json 同一条 script）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { countLivePeers, fairShare, isAlive } from './vitest-fair-share.mjs'

test('独占时返回 null —— 不传 flag，vitest 默认原样保留（CI 单跑零影响）', () => {
  assert.equal(fairShare({ cores: 10, peers: 1 }), null)
  assert.equal(fairShare({ cores: 4, peers: 1 }), null)
  assert.equal(fairShare({ cores: 1, peers: 1 }), null)
})

test('并发时按核数均分', () => {
  assert.equal(fairShare({ cores: 10, peers: 2 }), 5)
  assert.equal(fairShare({ cores: 10, peers: 3 }), 3)
  assert.equal(fairShare({ cores: 10, peers: 5 }), 2)
  assert.equal(fairShare({ cores: 4, peers: 2 }), 2)
})

test('总份额不超核数 —— 「让路」的定义就是这条，破了等于没让', () => {
  const cores = 10
  for (const peers of [2, 3, 4, 5]) {
    const share = fairShare({ cores, peers })
    assert.ok(share * peers <= cores, `${peers} 个并发 × ${share} worker = ${share * peers} 超过 ${cores} 核`)
  }
})

test('下限 2：并发数极多时宁可轻微超订，也不让单跑慢到没法用', () => {
  assert.equal(fairShare({ cores: 10, peers: 20 }), 2)
  assert.equal(fairShare({ cores: 2, peers: 8 }), 2)
})

test('参数非法要抛，别静默算出个荒唐值', () => {
  assert.throws(() => fairShare({ cores: 0, peers: 1 }), /cores/)
  assert.throws(() => fairShare({ cores: 10, peers: 0 }), /peers/)
  assert.throws(() => fairShare({ cores: 2.5, peers: 1 }), /cores/)
})

test('countLivePeers 只数活着的，并顺手清掉死条目（崩溃后自愈，不需要过期时间）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fair-share-test-'))
  try {
    for (const pid of ['1001', '1002', '1003', 'not-a-pid']) fs.writeFileSync(path.join(dir, pid), 'x')
    const alive = new Set([1001, 1003])
    assert.equal(countLivePeers(dir, (pid) => alive.has(pid)), 2)
    // 死条目当场被清掉，不会一直把份额算大
    const left = fs.readdirSync(dir).sort()
    assert.deepEqual(left, ['1001', '1003', 'not-a-pid'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('countLivePeers 对不存在的注册表返回 0，不抛', () => {
  assert.equal(countLivePeers(path.join(os.tmpdir(), 'definitely-not-here-' + process.pid)), 0)
})

test('isAlive 认得自己、不认瞎编的 pid', () => {
  assert.equal(isAlive(process.pid), true)
  assert.equal(isAlive(2 ** 22), false)
})
