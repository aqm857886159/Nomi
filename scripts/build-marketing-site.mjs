import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileAtomicSync } from './lib/atomicFile.mjs'
import { assertLocaleParity, shared } from './marketing/content.mjs'
import { assertFeaturesParity } from './marketing/features.mjs'
import { listHtmlFiles } from './marketing/html-scan.mjs'
import { assertLibraryCopyParity } from './marketing/library/copy.mjs'
import { loadSiteData } from './marketing/library/data.mjs'
import { renderSiteOutputs } from './marketing/pages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const runtimeFacts = Object.freeze({ ...shared, version: packageJson.version })
const checkOnly = process.argv.includes('--check')

assertLocaleParity()
assertLibraryCopyParity()
assertFeaturesParity()

// 生成物：首页、快速上手、三个库（数据来自 marketing/data/site-data.json），各一中一英。
// 「官网有哪些页面」只有一份 owner：marketing/pages.mjs 的 sitePages()（站点地图也读它，见 build-marketing-sitemap.mjs）。
const siteData = loadSiteData()
const allOutputs = renderSiteOutputs(siteData, runtimeFacts)
// 教程站页面（prebuilt）由 build-marketing-docs.mjs 写盘、由 --check 的 docs 构建核对；这里只把它们算进「应有页面」，不重写。
const outputs = allOutputs.filter(({ prebuilt }) => !prebuilt)

// 生成器不再产出的页面（模型退役、介绍删掉、页面改名）不能留在 marketing/ 里继续上线：
// --check 把它们报出来，生成时直接删掉（加新必删旧）。
const expected = new Set(allOutputs.map(({ relativePath }) => relativePath))
const orphans = listHtmlFiles(root).filter((relativePath) => !expected.has(relativePath))

if (checkOnly) {
  const stale = outputs
    .filter(({ relativePath, contents }) => {
      const target = path.join(root, relativePath)
      return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== contents
    })
    .map(({ relativePath }) => relativePath)
  if (stale.length) console.error(`Marketing site output is stale:\n${stale.map((item) => `- ${item}`).join('\n')}`)
  if (orphans.length) console.error(`Marketing site has pages the generator no longer produces (run pnpm run build:site to remove them):\n${orphans.map((item) => `- ${item}`).join('\n')}`)
  if (stale.length || orphans.length) {
    process.exitCode = 1
  } else {
    console.log('MARKETING SITE CHECK PASS')
  }
} else {
  for (const { relativePath, contents } of outputs) {
    const target = path.join(root, relativePath)
    writeFileAtomicSync(target, contents, { fsync: false })
    console.log(`Generated ${relativePath}`)
  }
  for (const relativePath of orphans) {
    fs.rmSync(path.join(root, relativePath))
    console.log(`Removed ${relativePath} (no longer generated)`)
  }
}
