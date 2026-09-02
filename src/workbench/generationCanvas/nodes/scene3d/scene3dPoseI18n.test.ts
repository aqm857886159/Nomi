// 人偶姿势面板的**文案必须真的走 i18n**。
//
// 为什么单独立这道:2026-09-01 反向死键门岗扫出 scene3d.inspector.pose*(共 40 条)零引用——
// 词条 zh+en 都齐、翻译也对,但 scene3dConstants 里把中文**写死**在 title/label 上,
// 面板渲染的是那份硬编码。后果是**英文界面下整片姿势面板显示中文**,而当时三道门岗都拦不住:
//   · check:i18n-key-parity 查 zh↔en 对称——两边都在,平衡;
//   · check:i18n 可见文案硬零——scene3dConstants.ts 当时在豁免名单里,理由写的是
//     「translated by scene3dInspector mappings」,可那个映射根本不存在(理由是假的);
//   · typecheck——写死中文是合法字符串,毫无异常。
// 于是这道从**数据层**把它钉住:每个 key 必须真的解析出译文,且英文侧不许残留汉字。
// 面板本身要真机看,见 tests/ux/scene3d-pose-click.walk.mjs。

import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { MANNEQUIN_POSE_PRESETS, MANNEQUIN_POSE_SECTIONS } from './scene3dConstants'

const HAN = /[一-鿿]/

/** 面板上会显示的全部 i18n key:分区标题 + 分组标题 + 每个控件标签 + 每个预设名。 */
function allPanelKeys(): string[] {
  const keys: string[] = []
  for (const section of MANNEQUIN_POSE_SECTIONS) {
    keys.push(section.titleKey)
    if (section.controls) {
      for (const control of section.controls) keys.push(control.labelKey)
    } else {
      for (const group of section.groups) {
        keys.push(group.titleKey)
        for (const control of group.controls) keys.push(control.labelKey)
      }
    }
  }
  for (const preset of MANNEQUIN_POSE_PRESETS) keys.push(`scene3d.inspector.posePreset.${preset.id}`)
  return keys
}

afterAll(async () => {
  await i18n.changeLanguage('zh-CN') // 别把语言状态漏给同进程里的其它用例
})

describe('3D 姿势面板文案走 i18n', () => {
  it('常量里不再留任何硬编码文案(只存 key)', () => {
    // 结构性防回归:类型上已经没有 label/title 字段了,这里再从值上确认一遍——
    // 万一有人「顺手」加回一个 label: '前倾',这条会红。
    for (const section of MANNEQUIN_POSE_SECTIONS) {
      expect(section.titleKey).toMatch(/^scene3d\.inspector\.pose/)
      expect(section).not.toHaveProperty('title')
    }
    for (const preset of MANNEQUIN_POSE_PRESETS) expect(preset).not.toHaveProperty('label')
  })

  it('每个 key 在中文词典里都解析得出译文(不是把 key 原样吐回来)', async () => {
    await i18n.changeLanguage('zh-CN')
    const unresolved = allPanelKeys().filter((key) => i18n.t(key) === key)
    expect(unresolved, `这些键在 zh-CN 词典里查不到:\n${unresolved.join('\n')}`).toEqual([])
  })

  it('英文界面下不残留汉字(这正是当年那个 bug)', async () => {
    await i18n.changeLanguage('en')
    const chinese = allPanelKeys()
      .map((key) => ({ key, value: i18n.t(key) }))
      .filter((entry) => entry.value === entry.key || HAN.test(entry.value))
    expect(
      chinese,
      `英文侧仍是中文/未解析:\n${chinese.map((e) => `${e.key} = ${e.value}`).join('\n')}`,
    ).toEqual([])
  })

  it('预设 id 与词条一一对应(键由 id 派生,漏一个就是原始 key 上屏)', async () => {
    await i18n.changeLanguage('en')
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      const key = `scene3d.inspector.posePreset.${preset.id}`
      expect(i18n.t(key), `预设 ${preset.id} 没有对应词条`).not.toBe(key)
    }
  })
})
