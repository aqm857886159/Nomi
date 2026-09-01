// 边界测试：目录只读时，「改模型」这一页必须在用户动手**之前**告诉他改不了。
//
// 背景（2026-09-01）：盘上目录格式比本构建新时，主进程 fail-closed 拒绝一切写回（防静默降级，
// 行为正确）。但这个状态原先只以异常形式存在——渲染层约一半的写入点根本没 catch，于是
// 「启用连接 / 存密钥 / 改地址 / 增删模型」点了没反应且没有任何解释，就是一堆哑控件。
// 真机复现过：拿真实 catalog（22 家 / 151 个模型）把 version 抬高，设置页整页零提示。
//
// 与 codexDirectionSeparation.test.ts 同策略用源码扫描而非组件测试：本仓无 @testing-library/react，
// 且这里要防的正是「有人顺手把提示删了 / 把它挪进 bridgeMissing 的 else 里」这类结构性回退。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8')

describe('目录只读必须在模型设置页显性告知', () => {
  it('数据层从主进程 health 派生只读态，且读它失败不连累主目录', () => {
    const src = read('useOnboardingDrawerCatalog.ts')
    expect(src).toContain('modelCatalog.health()')
    expect(src).toContain('catalogReadOnly')
    // 版本号必须来自 health，不在渲染层重算版本比较（否则又是第二份真相源）。
    expect(src).toContain('health.diskVersion')
    expect(src).toContain('health.appVersion')
    // health 的 try 必须独立于主目录读取那个 try：合并进去的话，health 一抛错
    // 就会走主 catch 把 models 清空——整页模型消失，比没提示更糟。
    const healthAt = src.indexOf('modelCatalog.health()')
    const listModelsAt = src.indexOf('modelCatalog.listModels()')
    expect(healthAt).toBeGreaterThan(-1)
    expect(listModelsAt).toBeGreaterThan(healthAt)
    // 两者之间必须存在一次 catch，证明中间断开了。
    expect(src.slice(healthAt, listModelsAt)).toMatch(/catch/)
  })

  it('设置页渲染只读条，且排在 bridgeMissing 之前（不进它的 if/else 链）', () => {
    const src = read('ModelSettingsHome.tsx')
    expect(src).toContain('data-model-home-catalog-read-only')
    // 关键结构：只读条必须在 bridgeMissing 分支之前独立渲染。挪进 else 会让它在
    // loading 阶段被吞掉，而那正是用户最早开始点东西的时刻。
    const readOnlyAt = src.indexOf('data-model-home-catalog-read-only')
    const bridgeAt = src.indexOf('bridgeMissing ? (')
    expect(readOnlyAt).toBeGreaterThan(-1)
    expect(bridgeAt).toBeGreaterThan(readOnlyAt)
  })

  it('文案走 i18n，且不把主进程那句英文原样甩给用户', () => {
    const src = read('ModelSettingsHome.tsx')
    expect(src).toContain('onboardingProviders.drawer.catalogReadOnlyTitle')
    expect(src).toContain('onboardingProviders.drawer.catalogReadOnlyBody')
    // 主进程的 Error.message 是给日志和开发者看的，不是给用户看的。
    expect(src).not.toContain('refusing to write')
    expect(src).not.toContain('read-only to avoid silent downgrade')
  })

  it('两个版本号由 health 传入渲染，不写死在组件里', () => {
    const src = read('ModelSettingsHome.tsx')
    expect(src).toContain('diskVersion: catalogReadOnly.diskVersion')
    expect(src).toContain('appVersion: catalogReadOnly.appVersion')
  })

  it('中英文案都说清「改不了」和「怎么办」，不是一句干巴巴的状态', () => {
    const locales = fs.readFileSync(path.join(dir, '../../i18n/locales/onboardingProviders.ts'), 'utf8')
    // 取**捕获组**，不是完整匹配串——用 /g + [1] 会拿到第二个整段（含 key 前缀），
    // 那样断言看着绿其实没验到英文本身，正是这次要防的假绿。
    const bodies = [...locales.matchAll(/catalogReadOnlyBody:\s*\n?\s*'([^']+)'/g)].map((m) => m[1])
    expect(bodies).toHaveLength(2) // zh-CN 一条、en 一条，缺一说明 key parity 漏了
    const [zh, en] = bodies

    for (const body of bodies) {
      expect(body).toContain('{{diskVersion}}')
      expect(body).toContain('{{appVersion}}')
    }
    // 必须有出路，不能只报状态。
    expect(zh).toMatch(/更新/)
    expect(zh).toMatch(/存不上|不会生效/)
    expect(en).toMatch(/[Uu]pdate/)
    expect(en).toMatch(/not be saved|no effect/)
    // 英文那条必须真是英文（防两边填成同一份中文）。
    expect(en).not.toMatch(/[一-龥]/)
  })
})
