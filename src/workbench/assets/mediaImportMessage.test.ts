import { describe, expect, it, beforeEach } from 'vitest'
import i18n from '../../i18n'
import { mediaImportRejectionMessage } from './mediaImportMessage'
import { admitMediaImport } from '../../../electron/shared/contracts/mediaImportPolicy'

// 2026-09-17 走查 W-09 / W-18 的回归：
//   · 拖一个 .txt 进画布，弹出的解释是「音频与 3D 在画布上没有节点可落」，还带着内部词 archetype；
//   · 同一句在英文界面下破折号之后整段是中文。
describe('准入拒绝 → 人话', () => {
  beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

  it('认不出是什么的文件（.txt）不许套用这个面的收窄理由', () => {
    const admission = admitMediaImport('generation-canvas', { kind: null, sizeBytes: 64 }, null)
    expect(admission.ok).toBe(false)
    if (admission.ok) return
    expect(admission.reason).toBe('unsupported-kind')
    if (admission.reason !== 'unsupported-kind') return
    // 收窄理由解释的是「这个面为什么比全集窄」，它对一个连种类都判不出的文件不成立。
    expect(admission.narrowedBecause).toBeNull()
    const message = mediaImportRejectionMessage('9月12日(1).txt', admission)
    expect(message).toContain('9月12日(1).txt')
    expect(message).not.toContain('音频')
    expect(message).not.toContain('导演台')
  })

  it('任何出站文案都不许带内部词 archetype', () => {
    const admission = admitMediaImport('generation-canvas', { kind: 'audio', sizeBytes: 64 }, null)
    if (admission.ok) throw new Error('音频不该能落画布')
    expect(JSON.stringify(admission)).not.toContain('archetype')
    expect(mediaImportRejectionMessage('a.mp3', admission)).not.toContain('archetype')
  })

  it('英文界面下整句都是英文——那半句中文来自一个写死的中文理由，现在改成从 accepted 派生', async () => {
    const admission = admitMediaImport('generation-canvas', { kind: 'audio', sizeBytes: 64 }, null)
    if (admission.ok) throw new Error('音频不该能落画布')
    await i18n.changeLanguage('en')
    const message = mediaImportRejectionMessage('song.mp3', admission)
    expect(message).toContain('song.mp3')
    // 一个汉字都不许有：这正是 W-18 的判据（破折号之后整段中文，英文用户看不懂）。
    expect(message).not.toMatch(/[一-鿿]/)
    await i18n.changeLanguage('zh-CN')
  })
})
