// 站位姿势预设的静态不变量守卫（配多视角渲染回归 tests/ux/staging-pose-shots.walk.mjs）。
// 渲染层证「姿势长得对/落地」；这里证「预设结构没漂移、骨骼名没拼错、工具枚举与预设单源一致」——
// 这些单测能在 push 前秒级抓住，不必等渲染。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MANNEQUIN_POSE_PRESETS, MANNEQUIN_POSE_SECTIONS, MANNEQUIN_DEFAULT_POSE } from './scene3dConstants'
import { STAGING_POSE_IDS } from './stagingVocab'

// 编辑器 section + 默认姿势里出现过的骨骼 = 已知合法骨骼集合。预设里的骨骼必须在此集合内，
// 否则 = 拼错的死骨骼名（applyMannequinSkeletonPose 静默忽略 → 姿势缺一块且无报错）。
function knownBones(): Set<string> {
  const bones = new Set<string>(Object.keys(MANNEQUIN_DEFAULT_POSE))
  for (const section of MANNEQUIN_POSE_SECTIONS) {
    const controls = section.controls ?? section.groups?.flatMap((group) => group.controls) ?? []
    for (const control of controls) bones.add(control.bone)
  }
  return bones
}

describe('staging pose presets', () => {
  it('恰好 13 个预设、id 唯一、与词汇表单源一致', () => {
    // 13 = 原 12 个 + 游戏式操控 C 键专用「半蹲」(crouch，区别于点击式深蹲 squat，见 scene3dConstants)。
    expect(MANNEQUIN_POSE_PRESETS).toHaveLength(13)
    const ids = MANNEQUIN_POSE_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(STAGING_POSE_IDS).toEqual(ids)
    // 深蹲与半蹲是两份独立数据源（P1/P4，不复用），两者都必须在库里。
    expect(ids).toContain('squat')
    expect(ids).toContain('crouch')
  })

  it('每个预设的骨骼名都是已知合法骨骼（防拼错=死骨骼静默丢失）', () => {
    const allowed = knownBones()
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      for (const bone of Object.keys(preset.pose ?? {})) {
        expect(allowed, `${preset.id} 用了未知骨骼 ${bone}`).toContain(bone)
      }
    }
  })

  it('旋转值是合理弧度（|角| ≤ π，无 NaN）——挡住误填角度单位', () => {
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      for (const [bone, rotation] of Object.entries(preset.pose ?? {})) {
        for (const value of rotation) {
          expect(Number.isFinite(value), `${preset.id}/${bone}`).toBe(true)
          expect(Math.abs(value), `${preset.id}/${bone} 超过 ±π，疑似把度当弧度`).toBeLessThanOrEqual(Math.PI + 0.001)
        }
      }
    }
  })

  it('工具 schema 的 pose 枚举与预设 id 不漂移（canvasTools 手抄镜像必须同步）', () => {
    // canvasTools.ts 在主进程、刻意手抄 pose 枚举避免拉 THREE 进主进程（见该文件注释）。
    // 手抄就会漂移——这里读源码文本对账，新增/改名预设而忘了同步工具枚举即红。
    const canvasToolsPath = fileURLToPath(new URL('../../../../../electron/ai/canvasTools.ts', import.meta.url))
    const source = readFileSync(canvasToolsPath, 'utf8')
    // 抓 pose 字段的 enum 数组（schema 里形如 pose: { type: 'string', enum: ['standing', ...] } 或 z.enum([...])）
    const match = source.match(/pose[\s\S]{0,120}?enum[\s(]*\[([\s\S]*?)\]/)
    expect(match, 'canvasTools.ts 里没找到 pose 枚举,schema 结构变了请更新本测试').not.toBeNull()
    const enumIds = (match?.[1] ?? '')
      .split(',')
      .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    expect(new Set(enumIds)).toEqual(new Set(STAGING_POSE_IDS))
  })

  it('pose-lab 全量截图脚本按预设数量自动分批（防新增姿势漏截图）', () => {
    const shotScriptPath = fileURLToPath(new URL('../../../../../scripts/pose-lab-shot-all.mjs', import.meta.url))
    const source = readFileSync(shotScriptPath, 'utf8')
    expect(source).toContain('MANNEQUIN_POSE_PRESETS')
    expect(source).toContain('presetIds.length')
    expect(source).toContain('from += batchSize')
    expect(source).not.toMatch(/全部\s+(12|13)\s+个预设/)
    expect(source).not.toMatch(/shoot\(view,\s*(0|4|8|12),/)
  })
})
