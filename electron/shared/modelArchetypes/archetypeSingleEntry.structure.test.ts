// 「给模型和档，拿到已经按档收窄好的档案」只有一个入口（设计卡 docs/plan/2026-11-15-archetype-single-entry.md）。
// 这一类问题是「拿了档案却不收窄」：拿档案和按档收窄是两步，调用方可以只做第一步（发送口、Run 付费口、Agent 详情都漏过）。
// 这里让它写不出来或一写就红：
//   1. 生产代码（electron/ src/ 非测试）不准碰档案表本身——按 id 直接找、整表遍历、私有副本都算；
//   2. 「全部档」口（EVERY_VARIANT / everyBuiltInArchetype）的使用点是一张只减不增的名单；
//   3. 按档收窄（读 paramOverrides）只在入口一处；
//   4. 入口的档没有缺省值（类型层：少传编译不过）；
//   5. 同一组输入返回同一个对象（渲染层靠引用相等省重渲染）。
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVERY_VARIANT, resolveModelArchetype, rescopeArchetypeVariant } from './index'
import { MODEL_ARCHETYPES } from './builtInCatalog'
import { installVariantFixture, VARIANT_FIXTURE } from '../../parity/modeParamsVariantFixture'

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
const TABLE_ACCESS = /\b(?:getArchetypeById|MODEL_ARCHETYPES|SOURCE_BACKED_PROFILES|sourceBackedVideoProfiles|specializeArchetypeForVariant|resolveArchetypeForModel|builtInArchetypeById|profileFor|specializeForProvider)\b|modelArchetypes\/builtInCatalog/

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
  // 入口自己。
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

  it('入口目录里只有 index.ts 读档案表', () => {
    const offenders = production
      .filter((file) => file.startsWith(OWNER_DIR) && !file.endsWith('/index.ts') && !file.endsWith('/builtInCatalog.ts'))
      .filter((file) => /\b(?:getArchetypeById|MODEL_ARCHETYPES)\b|from ['"]\.\/builtInCatalog['"]/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('「全部档」口的使用点是一张只减不增的名单', () => {
    const users = production.filter((file) => /\b(?:EVERY_VARIANT|everyBuiltInArchetype)\b/.test(read(file))).sort()
    expect(users).toEqual(UNION_USERS)
  })

  it('按档收窄（读 paramOverrides）只在入口一处', () => {
    const offenders = production
      // 测试夹具（临时装一份改写、用完卸掉）不是读者。
      .filter((file) => !file.endsWith('/types.ts') && !file.endsWith('modelArchetypes/index.ts') && file !== 'electron/parity/modeParamsVariantFixture.ts')
      .filter((file) => /\.paramOverrides\b|\bparamOverrides\s*\?\.|\[\s*['"]paramOverrides['"]\s*\]/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('入口的档没有缺省值', () => {
    const source = readFileSync(`${OWNER_DIR}index.ts`, 'utf8')
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
