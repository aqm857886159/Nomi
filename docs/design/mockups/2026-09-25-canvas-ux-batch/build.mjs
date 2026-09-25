// 把 index.html 里引用的 evidence/*.jpg 内联成 data URI，产出可直接发布成 Artifact 的单文件 dist/index.html。
// 用法：node docs/design/mockups/2026-09-25-canvas-ux-batch/build.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
const out = html.replace(/src="(evidence\/[^"]+\.jpg)"/g, (_, rel) => {
  const data = fs.readFileSync(path.join(dir, rel)).toString('base64')
  return `src="data:image/jpeg;base64,${data}"`
})
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
fs.writeFileSync(path.join(dir, 'dist', 'index.html'), out)
console.log(`dist/index.html ${(out.length / 1024).toFixed(0)} KB`)
