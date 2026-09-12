import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); continue }
    if (/\.tsx$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 压在媒体上的那几层：它们在**两个主题里都是深色**（媒体的亮度和主题无关）。 */
const MEDIA_OVERLAY = /overlay-chip|nomi-scrim|media-veil/

describe('压在媒体上的字用不翻转的墨（--nomi-media-ink）', () => {
  /**
   * `--nomi-paper` 是**会随主题翻转**的纸面色：亮色主题下是白，暗色主题下是深色卡底（L 0.235）。
   * 而 scrim / overlay-chip / media-veil 在两个主题里都是深色——它们压的是媒体，媒体不跟着主题变。
   * 两者凑一起的后果只在暗色主题下出现：深字压深底。实测 `text-nomi-paper` 压
   * `overlay-chip-strong`，暗色下对比度 **1.18:1**——不是"不好看"，是看不见。
   *
   * `--nomi-media-ink`（两个主题都是纯白）就是为这件事存在的 token，
   * 2026-09-11 之前全仓只有 1 个消费者，另外 26 处都写着会翻转的 paper。
   * 亮色主题下两者同为白，所以这次替换**一个像素都没动**——它只修暗色那半。
   */
  it('没有任何一行把 text-/border-nomi-paper 和媒体浮层底色写在一起', () => {
    const offenders: string[] = []
    for (const file of walk(path.join(repoRoot, 'src'))) {
      if (file.endsWith('.test.tsx')) continue
      const relative = path.relative(repoRoot, file)
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (!MEDIA_OVERLAY.test(line)) return
        if (/text-nomi-paper|border-nomi-paper\//.test(line)) offenders.push(`${relative}:${index + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
