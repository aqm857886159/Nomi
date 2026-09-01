import { describe, expect, it } from 'vitest'
import {
  buildLivePrefixes,
  buildTree,
  classify,
  collectFromSourceText,
  createCollected,
  createTree,
  isUsablePrefix,
  pluralBaseOf,
} from './check-i18n-dead-keys'
import type { DynamicPrefix } from './lib/i18nDynamicKeyPrefixes'

// 阳性对照优先(R17:加规则先验它会红)。
// 每个 case 都是「同一个键 + 不同的引用写法」——先确认没引用时报死,再确认某种写法能把它救活。
// 全部用内联样本,不碰真实词典:真实存量归棘轮基线管,这里回归的是**判定逻辑**。

const DICT = {
  settings: {
    tab: { models: '模型', appearance: '外观' },
    orphan: '没人引用的词条',
  },
  spend: { cost: { text_one: '{{count}} 次', text_other: '{{count}} 次' } },
  drawer: { network: { modeSystem: '系统', modeCustom: '自定义' } },
} as const

/** 跑一遍完整判定链:建树 → 采集源码引用 → 汇总动态前缀 → 判定。 */
function run(sources: Record<string, string>, registry: DynamicPrefix[] = []) {
  const tree = createTree()
  buildTree(DICT, '', tree)
  const collected = createCollected()
  for (const [fileName, text] of Object.entries(sources)) {
    collectFromSourceText(text, { fileName, isDictionary: false }, collected)
  }
  const livePrefixes = buildLivePrefixes(tree, collected, registry)
  const verdicts = classify(tree, collected, livePrefixes)
  return {
    dead: verdicts.filter((v) => v.tier === 'dead').map((v) => v.key),
    unreached: verdicts.filter((v) => v.tier === 'dynamic-unreached').map((v) => v.key),
  }
}

describe('i18n 死键判定', () => {
  it('阳性对照:谁都不引用的键报成 A 档死键', () => {
    const { dead } = run({ 'a.ts': 'export const x = 1' })
    expect(dead).toContain('settings.orphan')
    expect(dead).toContain('settings.tab.models')
  })

  it('规则①:键长在 t() 实参之外的常量里也算引用(正向门岗看不见的那类)', () => {
    // 这是 settings.tab.models 曾被粗扫误判成死键的真实形状:键住在 const 表里,t() 收到的是变量。
    const { dead } = run({
      'tabs.ts': `const TABS = [{ id: 'models', labelKey: 'settings.tab.models' }]
        export function render(t: (k: string) => string, i: number) { return t(TABS[i].labelKey) }`,
    })
    expect(dead).not.toContain('settings.tab.models')
    expect(dead).toContain('settings.tab.appearance') // 同族里没被引用的那个仍然报死
  })

  it('规则②:只出现在 `as \'literal\'` 类型位置的键也算引用', () => {
    const { dead } = run({
      'assert.tsx': "t(`settings.tab.${id}` as 'settings.tab.models')",
    })
    expect(dead).not.toContain('settings.tab.models')
    // 断言里那个字面量证明前缀 settings.tab. 是活的 → 同族兄弟降级为 B 档,不再是可删的 A 档。
    expect(dead).not.toContain('settings.tab.appearance')
  })

  it('规则③:模板前缀覆盖到的叶子降级为 B 档,不判死', () => {
    const { dead, unreached } = run({ 'dyn.tsx': 't(`settings.tab.${id}`)' })
    expect(dead).not.toContain('settings.tab.models')
    expect(unreached).toContain('settings.tab.models') // 前缀活但字面量池补不全 → 存疑,不删
    expect(dead).toContain('settings.orphan') // 前缀之外的仍照报
  })

  it('规则③:注册表前缀与源码模板等效', () => {
    const registry: DynamicPrefix[] = [{ prefix: 'settings.tab', why: '测试用' }]
    const { dead } = run({ 'a.ts': 'export const x = 1' }, registry)
    expect(dead).not.toContain('settings.tab.models')
    expect(dead).toContain('settings.orphan')
  })

  it('规则③ concat:注册表枚举后缀 → 精确记为引用,不扩散成整片覆盖', () => {
    const registry: DynamicPrefix[] = [
      { prefix: 'drawer.network.mode', kind: 'concat', suffixes: ['System'], why: '测试用' },
    ]
    const { dead } = run({ 'a.ts': 'export const x = 1' }, registry)
    expect(dead).not.toContain('drawer.network.modeSystem') // 枚举到了 → 活
    expect(dead).toContain('drawer.network.modeCustom') // 没枚举到 → 仍报死(concat 不扩散)
  })

  it('规则④:引用基名即撑活全部复数变体', () => {
    const { dead } = run({ 'plural.tsx': "t('spend.cost.text', { count: n })" })
    expect(dead).not.toContain('spend.cost.text_one')
    expect(dead).not.toContain('spend.cost.text_other')
  })

  it('词典文件里的译文值不算引用', () => {
    const tree = createTree()
    buildTree(DICT, '', tree)
    const collected = createCollected()
    // 假装这是词典文件:哪怕它内含 'settings.orphan' 这个字符串,也不能把自己救活。
    collectFromSourceText("export const zh = { k: 'settings.orphan' }", { fileName: 'src/i18n/locales/x.ts', isDictionary: true }, collected)
    const dead = classify(tree, collected, buildLivePrefixes(tree, collected, [])).filter((v) => v.tier === 'dead')
    expect(dead.map((v) => v.key)).toContain('settings.orphan')
  })
})

describe('前缀可用性闸(防垃圾 head 让门岗失效)', () => {
  const tree = createTree()
  buildTree(DICT, '', tree)
  const leaves = [...tree.leaves]

  it('单字母 head 不作数——否则 `a${x}` 会让整片命名空间被算作覆盖', () => {
    expect(isUsablePrefix('s', tree, leaves)).toBe(false)
    expect(isUsablePrefix('settings', tree, leaves)).toBe(false) // 无点、非 concat 形态
  })

  it('真实子树 + 尾点 = 可用', () => {
    expect(isUsablePrefix('settings.tab.', tree, leaves)).toBe(true)
  })

  it('concat 半词:父路径是子树且确有叶子以它开头 = 可用', () => {
    expect(isUsablePrefix('drawer.network.mode', tree, leaves)).toBe(true)
    expect(isUsablePrefix('drawer.network.nope', tree, leaves)).toBe(false)
  })

  it('指向不存在的子树 = 不可用(防假注册撑活一整片)', () => {
    expect(isUsablePrefix('settings.nonexistent.', tree, leaves)).toBe(false)
  })
})

describe('pluralBaseOf', () => {
  it('剥掉 CLDR 复数后缀', () => {
    expect(pluralBaseOf('a.b_one')).toBe('a.b')
    expect(pluralBaseOf('a.b_other')).toBe('a.b')
    expect(pluralBaseOf('a.b')).toBeNull()
  })
})
