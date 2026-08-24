import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { PRODUCTION_DRIVER_TEST_TIMEOUT_MS, waitForProduction } from './productionRunTestHelpers'

// 这一组守的是「测试挂了能不能看出卡在哪」——驱动型测试全靠 waitForProduction 推进，
// 它以前只抛一句 'waitFor timed out'，卡在方向门还是样片门还是审片全看不出来。

describe('waitForProduction 的失败信息', () => {
  it('条件已成立时直接返回，不空转', async () => {
    await expect(waitForProduction(() => true, 50)).resolves.toBeUndefined()
  })

  it('超时报错里带上「等的是哪个条件」（谓词源码）', async () => {
    const gateNeverOpens = () => false
    await expect(waitForProduction(gateNeverOpens, 30)).rejects.toThrow(/gateNeverOpens|\(\) => false/)
  })

  it('多行谓词压成一行，不把报错撑爆', async () => {
    let caught = ''
    try {
      await waitForProduction(() => {
        const status = 'running'
        return status === 'awaiting_rough_cut_review'
      }, 30)
    } catch (error) { caught = (error as Error).message }
    expect(caught).toContain('awaiting_rough_cut_review')
    expect(caught.split('\n')).toHaveLength(1)
  })

  it('给了 label 就用 label（谓词源码看不懂时的逃生口）', async () => {
    await expect(waitForProduction(() => false, 30, '样片门迟迟不开')).rejects.toThrow(/样片门迟迟不开/)
  })

  it('报出实际等待时长和期限，分得清「等满了」还是「早死了」', async () => {
    let caught = ''
    try { await waitForProduction(() => false, 40) } catch (error) { caught = (error as Error).message }
    expect(caught).toMatch(/after \d+ms/)
    expect(caught).toContain('deadline 40ms')
  })
})

describe('内层期限先炸的不变量', () => {
  // 单条测试路径上内层期限之和的当前最大值：productionShotGate「否决某镜」
  // = 5000 + 6000(批剧本) + 3000(批分镜) + 5000×4 = 34000ms。
  // 外层必须大于它，否则先炸的是外层，只会报「Test timed out in Nms」，
  // 看不出卡在哪个条件。改内层期限时把这个数一起重算。
  const LONGEST_INNER_CHAIN_MS = 34_000

  it('外层单测超时大于最长内层链，也大于 vitest 默认 5s', () => {
    expect(PRODUCTION_DRIVER_TEST_TIMEOUT_MS).toBeGreaterThan(LONGEST_INNER_CHAIN_MS)
    expect(PRODUCTION_DRIVER_TEST_TIMEOUT_MS).toBeGreaterThan(5_000)
  })

  it('没有测试文件再私造一份 waitFor（P1 加新必删旧的棘轮）', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const offenders = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.test.ts'))
      .filter((name) => /(async )?function waitFor\s*\(|const waitFor\s*=/.test(fs.readFileSync(path.join(dir, name), 'utf8')))
    expect(offenders).toEqual([])
  })
})
