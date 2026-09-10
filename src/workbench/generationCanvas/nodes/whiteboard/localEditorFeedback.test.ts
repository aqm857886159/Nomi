import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const resolve = (path: string) => new URL(path, import.meta.url)
const read = (path: string) => readFileSync(resolve(path), 'utf8')

// 就地反馈的登记表按文件路径钉：文件被改名/删掉时这条断言先红，避免守卫悄悄指向一个不存在的文件（2026-09-10 导演台 V2 把 scene3d 整个换掉时踩过）
const OWNERS = [
  'WhiteboardModal.tsx',
  'WhiteboardDrawingTool.tsx',
  '../director/panels/usePanoramaImport.tsx',
]

describe('local editing feedback ownership', () => {
  for (const file of OWNERS) {
    it(`${file} keeps failures in the real editor, without global toast`, () => {
      expect(existsSync(resolve(file)), `${file} is registered as a local feedback owner but no longer exists`).toBe(true)
      const source = read(file)
      expect(source).not.toMatch(/import .*\btoast\b.*from/)
      expect(source).toContain("level: 'inline'")
      expect(source).toContain('role="status"')
      expect(source).toContain('setFeedback(null)')
    })
  }
  it('panorama ratio warning already lives with its preview', () => {
    const source = read('../director/panels/inspector/SceneLayerInspector.tsx')
    expect(source).toContain("t('director.environment.nonStandardHint'")
    expect(source).not.toContain("t('director.environment.nonStandardImported'")
  })
})
