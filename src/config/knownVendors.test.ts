/**
 * 跨层身份键不变量（plan §8.1 防漂移）：
 * 渲染层的「已知供应商」展示目录（KNOWN_VENDORS，只放 logo/话术）必须指向**真实被 seed 的内置 vendor**。
 * 三套名单（KNOWN_VENDORS 展示 / seed 身份+模型 / PROVIDER_PRESETS 手动接入端点）按层各司其职、不该合并，
 * 但身份键（vendorKey）必须对得上——否则展示卡指向不存在的 vendor，或有人 rename 了 seed key 致用户 key 认不上
 * （key 按 vendorKey 存钥匙串，见 [[never-wipe-user-data-on-update]]）。这条用机器钉死，replace 旧"三套对不上"靠人肉。
 */
import { describe, it, expect } from 'vitest'
import { KNOWN_VENDORS } from './knownVendors'
import { APIMART_VENDOR_SEED } from '../../electron/catalog/apimartVendor'
import { KIE_VENDOR_SEED } from '../../electron/catalog/kieSeedance'
import { MODELSCOPE_VENDOR_SEED } from '../../electron/catalog/modelscopeVendor'
import { VOLCENGINE_VENDOR_SEED, VOLCENGINE_SPEECH_VENDOR_SEED } from '../../electron/catalog/volcengineVendor'
import { DREAMINA_VENDOR_SEED } from '../../electron/catalog/dreaminaVendor'

// 单一来源：seedBuiltins.applyBuiltinSeeds 实际 seed 的 6 个内置 vendor（每个的 *_VENDOR_SEED.key）。
const SEEDED_BUILTIN_KEYS = new Set<string>([
  APIMART_VENDOR_SEED.key,
  KIE_VENDOR_SEED.key,
  MODELSCOPE_VENDOR_SEED.key,
  VOLCENGINE_VENDOR_SEED.key,
  VOLCENGINE_SPEECH_VENDOR_SEED.key,
  DREAMINA_VENDOR_SEED.key,
])

describe('KNOWN_VENDORS × seed 身份键不变量', () => {
  it('每个展示卡的 vendorKey 都指向真实被 seed 的内置 vendor（防展示指向幽灵 vendor / 防 rename 漂移）', () => {
    for (const v of KNOWN_VENDORS) {
      expect(SEEDED_BUILTIN_KEYS.has(v.vendorKey), `KNOWN_VENDORS「${v.vendorKey}」不在 seed 内置集 ${[...SEEDED_BUILTIN_KEYS].join(',')}`).toBe(true)
    }
  })

  it('展示目录无重复 vendorKey', () => {
    const keys = KNOWN_VENDORS.map((v) => v.vendorKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('dreamina 被 seed 但刻意不在 KNOWN_VENDORS（走专属 DreaminaMemberCard，非通用接入卡）', () => {
    expect(SEEDED_BUILTIN_KEYS.has('dreamina')).toBe(true)
    expect(KNOWN_VENDORS.some((v) => v.vendorKey === 'dreamina')).toBe(false)
  })
})
