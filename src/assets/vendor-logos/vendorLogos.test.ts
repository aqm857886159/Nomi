import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const here = path.join(process.cwd(), 'src/assets/vendor-logos')
const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

/** 从登记表源码里抽 `name: new URL('./file.png', …)`，不 import 组件（vitest 跑在 node 环境，无打包器）。 */
function registryEntries(): Array<{ name: string; file: string }> {
  const source = read('src/assets/vendor-logos/index.ts')
  return [...source.matchAll(/^\s{2}(\w+): new URL\('\.\/([\w.-]+)', import\.meta\.url\)\.href,$/gm)]
    .map((match) => ({ name: match[1], file: match[2] }))
}

describe('vendor logo registry', () => {
  it('登记表与资产目录严格一一对应（多一张没人用、少一张就是碎图）', () => {
    const entries = registryEntries()
    expect(entries.length).toBeGreaterThan(0)
    const registered = entries.map((entry) => entry.file).sort()
    const onDisk = fs.readdirSync(here).filter((name) => name.endsWith('.png')).sort()
    expect(registered).toEqual(onDisk)
  })

  it('一个品牌一块牌子：没有两个登记名指向同一张图', () => {
    const files = registryEntries().map((entry) => entry.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('即梦与豆包是两个产品，不许再共用一块牌子', () => {
    const identity = read('src/config/modelProviderIdentity.ts')
    // 旧 bug 的确切形状：一条正则同时匹配 doubao 和 dreamina。
    expect(identity).not.toMatch(/doubao[^\n]*dreamina|dreamina[^\n]*doubao/)
    expect(identity).toContain('VENDOR_LOGOS.dreamina')
    expect(identity).toContain('VENDOR_LOGOS.doubao')
  })

  it('品牌图只有 VendorLogoImage 一个渲染口（否则 dark:invert 这类规矩必然漏抄）', () => {
    const roots = ['src/config', 'src/design', 'src/ui', 'src/workbench']
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const relative = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(relative)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          // 注释里举反例是允许的（本组件的文件头就写着旧写法），扫的是真代码。
          const source = read(relative).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
          if (/<img[^>]*src=\{[^}]*[Ll]ogo/.test(source)) offenders.push(relative)
        }
      }
    }
    for (const root of roots) walk(root)
    expect(offenders).toEqual([])
  })

  it('单色标（透明底深色笔画）必须登记进反相名单，否则暗色模式看不见', () => {
    const source = read('src/assets/vendor-logos/index.ts')
    expect(source).toMatch(/MONOCHROME_LOGO_NAMES[^\n]*=\s*\[[^\]]*'apimart'[^\]]*'elevenlabs'[^\]]*'runway'/)
    expect(read('src/design/vendorLogoImage.tsx')).toContain("isMonochromeVendorLogo(src) && 'dark:invert'")
  })
})
