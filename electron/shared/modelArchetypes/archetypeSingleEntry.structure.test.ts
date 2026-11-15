// 「给模型和档，拿到已经按档收窄好的档案」只有一个入口（设计卡 docs/plan/2026-11-15-archetype-single-entry.md）。
// 这一类问题是「拿了档案却不收窄」：拿档案和按档收窄是两步，调用方可以只做第一步（发送口、Run 付费口、Agent 详情都漏过）。
// 这里让它写不出来或一写就红：
//   1. 生产代码（electron/ src/ 非测试）不准碰档案表本身——按 id 直接找、整表遍历、私有副本都算；
//      其中「谁可以 import 档案目录里的私有文件」由依赖规则管（.dependency-cruiser.mjs 的 archetype-* 三条，
//      静态 / 动态 import、require、再导出都算一条边，check:boundaries 跑），这份测试只管依赖规则看不见的：
//      符号名（私有副本、旧函数名）、按符号名限定使用者（sourceBackedVideoProfiles）、公开文件转出了什么。
//   2. 「全部档」口（EVERY_VARIANT / everyBuiltInArchetype）的使用点是一张只减不增的名单；
//   3. 按档收窄（读 paramOverrides）只在入口一处；
//   4. 入口的档没有缺省值（类型层：少传编译不过）；
//   5. 同一组输入返回同一个对象（渲染层靠引用相等省重渲染）。
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVERY_VARIANT, resolveModelArchetype, rescopeArchetypeVariant } from './index'
import { MODEL_ARCHETYPES } from './builtInCatalog'
import { installVariantFixture, VARIANT_FIXTURE } from '../../testSupport/modeParamsVariantFixture'

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full)
    return /\.(tsx?|mts)$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

const OWNER_DIR = 'electron/shared/modelArchetypes/'
const production = [...sources('electron'), ...sources('src')].map((file) => file.split(path.sep).join('/'))
const read = (file: string) => stripComments(readFileSync(file, 'utf8'))

/** 档案表本身的名字：在入口目录之外出现一次就是绕过入口。 */
const TABLE_ACCESS = /\b(?:getArchetypeById|MODEL_ARCHETYPES|SOURCE_BACKED_PROFILES|sourceBackedVideoProfiles|specializeArchetypeForVariant|resolveArchetypeForModel|builtInArchetypeById|profileFor|specializeForProvider)\b/

/** 视频档案的登记处（registry.ts 声明表、它自己的全目录方式 id 普查）——表的家，不是读者。 */
const TABLE_HOME = new Set(['electron/shared/videoCapabilities/registry.ts', 'electron/shared/videoCapabilities/index.ts'])

/**
 * 「全部档」口的生产使用点（只减不增；要加一处先改这张名单 = 评审看得见）。
 */
const UNION_USERS = [
  // 问的就是「任一档 / 全目录」：剥掉别的档留下的旧键、画档位轴、全目录有没有档案收这种参考、参考键普查、推广标记、改动碰到哪个参数键。
  'electron/shared/modelArchetypes/modeParams.ts',
  'src/workbench/generationCanvas/nodes/controls/useVariantAxisLiveOf.ts',
  'src/workbench/generationCanvas/agent/referenceEdgeCapability.ts',
  'electron/shared/modelArchetypes/referenceKeys.ts',
  'electron/providerAdapter/promotionMeta.ts',
  'src/workbench/generationCanvas/model/storyboardOverrides.ts',
  // 只问「这个模型有没有档案」，与哪一档无关。
  'src/ui/onboarding/CustomCallEditor.tsx',
  // 名单层一行一模型（没分档的菜单行说的也是任一档）。
  'electron/catalog/agentModelEntriesFromCatalog.ts',
  'src/workbench/generationCanvas/agent/availableModels.ts',
  'src/workbench/common/useDedupedModelSelect.ts',
  // 存不下档、今天读的是全部档的参数：按档给要先定「镜头记不记档 / 指纹分不分档」，下一刀（设计卡「下一刀」）。
  'electron/catalog/apimartModelHealth.ts',
  'src/workbench/creation/storyboard/shotRow/shotRowModel.ts',
  'src/ui/onboarding/ModelCapabilityEditor.tsx',
  'src/ui/onboarding/customCallScriptModes.ts',
  'src/ui/onboarding/modelCapabilityProjection.ts',
  // 入口自己（entry.ts 实现，index.ts 原样转出）。
  'electron/shared/modelArchetypes/entry.ts',
  'electron/shared/modelArchetypes/index.ts',
].sort()

/** 设计实验室（devlab）只拿真实档案当样张数据、不进产品包，直接读表。 */
const NOT_SHIPPED = 'src/devlab/'

describe('档案只有一个入口', () => {
  it('入口目录之外的生产代码不碰档案表（按 id 找、整表遍历、私有副本）', () => {
    const offenders = production
      .filter((file) => !file.startsWith(OWNER_DIR) && !TABLE_HOME.has(file) && !file.startsWith(NOT_SHIPPED))
      .filter((file) => TABLE_ACCESS.test(read(file)))
    expect(offenders).toEqual([])
  })

  // 依赖规则只看文件边，管不到「同一个公开文件里只准谁用某个符号」：视频档案的整张登记表 sourceBackedVideoProfiles
  // 由 videoCapabilities/index.ts 转出，入口目录里的新文件 import 它就能整表遍历（验收反例 11）——按符号名守，入口目录里只有 builtInCatalog 能用。
  it('入口目录里只有 builtInCatalog.ts 用视频档案的整张登记表（依赖规则按文件边管不到符号）', () => {
    const offenders = production
      .filter((file) => file.startsWith(OWNER_DIR) && !file.endsWith('/builtInCatalog.ts'))
      .filter((file) => /\b(?:sourceBackedVideoProfiles|SOURCE_BACKED_PROFILES)\b/.test(read(file)))
    expect(offenders).toEqual([])
  })

  // 档案目录的公开文件（依赖规则里 ARCHETYPE_PUBLIC_FILES）只能转出公开文件和自写能力合同：
  // 否则「在 index.ts 里 export { 某档案常量 } from './gptImage2'」目录外就能经 index 拿到私有档案，依赖规则看不见。
  it('档案目录的公开文件不转出私有档案声明', () => {
    const config = readFileSync('.dependency-cruiser.mjs', 'utf8')
    const publicList = /ARCHETYPE_PUBLIC_FILES = Object\.freeze\(\[([^\]]*)\]/.exec(config)?.[1]
    expect(publicList, '.dependency-cruiser.mjs 里找不到 ARCHETYPE_PUBLIC_FILES').toBeTruthy()
    const publicFiles = [...publicList!.matchAll(/'(\w+)'/g)].map((match) => match[1])
    expect(publicFiles).toContain('entry')
    const allowedTargets = new Set([...publicFiles, 'customCapabilityContract'])
    const exported = publicFiles.flatMap((name) => {
      const source = read(`${OWNER_DIR}${name}.ts`)
      return [...source.matchAll(/\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]\.\/(\w+)['"]/g)].map((match) => `${name} -> ${match[1]}`)
    })
    expect(exported.length).toBeGreaterThan(0)
    expect(exported.filter((edge) => !allowedTargets.has(edge.split(' -> ')[1]))).toEqual([])
  })

  // 依赖规则管「目录外谁 import 哪个声明文件」，管不到目录内的公开文件 import 声明（验收反例 10 原样：referenceChannels 里 import ./viduQ3 自拼表），
  // 也管不到经 videoCapabilities/index.ts 转出的档案常量——按常量名守：点名某个档案常量（XXX_ARCHETYPE）的只能是声明文件本身、登记处和转出口。
  it('点名单个档案常量的文件只有声明文件、登记处和转出口', () => {
    const config = readFileSync('.dependency-cruiser.mjs', 'utf8')
    const list = (name: string) => [...(new RegExp(`${name} = Object\\.freeze\\(\\[([^\\]]*)\\]`).exec(config)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((match) => match[1])
    const publicByDir = new Map([[OWNER_DIR, list('ARCHETYPE_PUBLIC_FILES')], ['electron/shared/videoCapabilities/', list('VIDEO_PUBLIC_FILES')]])
    for (const files of publicByDir.values()) expect(files.length).toBeGreaterThan(5)
    const NAMED_CONSTANT = /\b(?!MODEL_ARCHETYPES\b)[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_ARCHETYPES?\b/
    const HOMES = new Set(['electron/shared/videoCapabilities/index.ts', 'electron/shared/videoCapabilities/registry.ts'])
    const offenders = production.filter((file) => NAMED_CONSTANT.test(read(file))).filter((file) => {
      if (HOMES.has(file) || file.startsWith(NOT_SHIPPED) || file.startsWith('electron/testSupport/')) return false
      const dir = [...publicByDir.keys()].find((prefix) => file.startsWith(prefix))
      if (!dir) return true
      const base = file.slice(dir.length).replace(/\.(?:tsx?|mts)$/, '')
      return publicByDir.get(dir)!.includes(base)
    })
    expect(offenders).toEqual([])
  })

  it('「全部档」口的使用点是一张只减不增的名单', () => {
    const users = production.filter((file) => /\b(?:EVERY_VARIANT|everyBuiltInArchetype)\b/.test(read(file))).sort()
    expect(users).toEqual(UNION_USERS)
  })

  it('按档收窄（读 paramOverrides）只在入口一处', () => {
    const offenders = production
      // 测试夹具（临时装一份改写、用完卸掉）不是读者。
      .filter((file) => !file.endsWith('/types.ts') && !file.endsWith('modelArchetypes/entry.ts') && file !== 'electron/testSupport/modeParamsVariantFixture.ts')
      .filter((file) => /\.paramOverrides\b|\bparamOverrides\s*\?\.|\[\s*['"]paramOverrides['"]\s*\]/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('入口的档没有缺省值', () => {
    const source = readFileSync(`${OWNER_DIR}entry.ts`, 'utf8')
    expect(source).toMatch(/export function resolveModelArchetype\(\s*model: ArchetypeModelLike \| null \| undefined,\s*options: Readonly<\{ variant: ArchetypeVariantPick \}>,?\s*\)/)
    expect(source).toMatch(/export type ArchetypeVariantRequest = Readonly<\{ variantId: unknown; modelId: unknown \}>;/)
    // 只给类型检查看（check:test-types），不真调：少传 = 编译不过。
    const typeOnly = (): void => {
      const model = { modelKey: 'veo3.1', vendorKey: 'apimart' }
      // @ts-expect-error 档必传：少传 options 编译不过
      resolveModelArchetype(model)
      // @ts-expect-error 档必传：options 里没有 variant 编译不过
      resolveModelArchetype(model, {})
      // @ts-expect-error 具体的一档两个键都要写
      resolveModelArchetype(model, { variant: { variantId: 'fast' } })
    }
    expect(typeof typeOnly).toBe('function')
  })
})

describe('入口按档收窄（真实内置档案）', () => {
  // 验收反例 8：入口里把档改坏（不认显式档 / 一律按默认档），只有测试夹具（临时装一份改写）会红，真实模型的快照不红——
  // 因为快照多数落在默认档上。这里逐个真实内置档案、逐档：入口给的参数必须就是这一档的改写结果（读 variants[].paramOverrides 自己算一遍）。
  it('每个带改写的真实档：入口给的就是改写后的参数，不是全集，也不是默认档的', () => {
    let narrowedVariants = 0
    let changedModes = 0
    let changedOnNonDefault = 0
    for (const profile of MODEL_ARCHETYPES) {
      const model = { modelKey: profile.identifierPatterns[0], vendorKey: null, meta: { archetypeId: profile.id } }
      const every = resolveModelArchetype(model, { variant: EVERY_VARIANT })!
      for (const variant of profile.variants ?? []) {
        const overrides = variant.paramOverrides
        if (!overrides) continue
        narrowedVariants += 1
        const got = resolveModelArchetype(model, { variant: { variantId: variant.id, modelId: undefined } })!
        expect(got.modes.map((mode) => mode.id), `${profile.id}/${variant.id}`).toEqual(every.modes.map((mode) => mode.id))
        for (const mode of every.modes) {
          const fn = overrides[mode.id] as ((params: typeof mode.params) => typeof mode.params) | undefined
          const expected = fn ? fn(mode.params) : mode.params
          const actual = got.modes.find((item) => item.id === mode.id)!.params
          expect(actual, `${profile.id}/${variant.id}/${mode.id}`).toEqual(expected)
          if (fn && JSON.stringify(expected) !== JSON.stringify(mode.params)) {
            changedModes += 1
            if (variant.id !== profile.defaultVariantId) changedOnNonDefault += 1
          }
        }
      }
    }
    // 防空转：真实目录里确实有改写、且改写确实改了参数（目录里没有任何一档改写时这条红，提醒回来看这份测试还守不守得住）。
    expect(narrowedVariants).toBeGreaterThan(0)
    expect(changedModes).toBeGreaterThan(0)
    // 不是默认档的档也有真改动：入口一律按默认档收窄时，这里才红得出来。
    expect(changedOnNonDefault).toBeGreaterThan(0)
  })
})

describe('同一组输入返回同一个对象', () => {
  const veo = { modelKey: 'veo3.1', vendorKey: 'apimart', meta: { archetypeId: 'veo-3-1-apimart' } }
  it('全部档 / 具体一档各自引用相等，换档回到同一份全集', () => {
    const every = resolveModelArchetype(veo, { variant: EVERY_VARIANT })
    expect(every).not.toBeNull()
    expect(resolveModelArchetype({ ...veo, meta: { ...veo.meta } }, { variant: EVERY_VARIANT })).toBe(every)
    const quality = resolveModelArchetype(veo, { variant: { variantId: 'quality', modelId: undefined } })
    expect(resolveModelArchetype(veo, { variant: { variantId: 'quality', modelId: undefined } })).toBe(quality)
    expect(rescopeArchetypeVariant(quality!, EVERY_VARIANT)).toBe(every)
  })

  it('每个内置档案、每一档：两次解析是同一个对象，收窄过的再换回全部档是同一份全集', () => {
    for (const profile of MODEL_ARCHETYPES) {
      const model = { modelKey: profile.identifierPatterns[0], vendorKey: null, meta: { archetypeId: profile.id } }
      const every = resolveModelArchetype(model, { variant: EVERY_VARIANT })!
      for (const variant of [undefined, ...(profile.variants ?? []).map((item) => item.id)]) {
        const pick = { variantId: variant, modelId: undefined }
        const once = resolveModelArchetype(model, { variant: pick })
        expect(resolveModelArchetype(model, { variant: { ...pick } }), `${profile.id}/${variant}`).toBe(once)
        expect(rescopeArchetypeVariant(once!, EVERY_VARIANT), `${profile.id}/${variant}`).toBe(every)
        expect(rescopeArchetypeVariant(every, pick), `${profile.id}/${variant}`).toBe(once)
      }
    }
  })

  it('测试夹具临时装上的改写会被看见、卸掉后回到原样（缓存不吃旧的改写）', () => {
    const model = { modelKey: VARIANT_FIXTURE.modelKey, vendorKey: 'apimart', meta: { archetypeId: VARIANT_FIXTURE.archetypeId } }
    const pick = { variantId: VARIANT_FIXTURE.variantId, modelId: undefined }
    const before = resolveModelArchetype(model, { variant: pick })!
    const restore = installVariantFixture()
    try {
      const during = resolveModelArchetype(model, { variant: pick })!
      expect(during).not.toBe(before)
      const t2v = during.modes.find((mode) => mode.id === VARIANT_FIXTURE.modeId)!
      expect(t2v.params.some((control) => control.key === VARIANT_FIXTURE.droppedKey)).toBe(false)
    } finally {
      restore()
    }
    expect(resolveModelArchetype(model, { variant: pick })).toBe(before)
  })
})
