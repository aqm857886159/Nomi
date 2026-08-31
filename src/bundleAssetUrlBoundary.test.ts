// 结构保证：构建产物 URL 不得悄悄多出新的出现点（2026-07-30 根因修复的看门狗）。
//
// 背景：`new URL('./x.jpg', import.meta.url).href` 拿到的是**构建产物地址**——dev 下是
// dev server 的模块 URL（http://127.0.0.1:5273/src/...），打包版是带内容哈希的
// file://…/dist/assets/x-<hash>.jpg。这类值只在「当前这次构建、当前这台机器、当前这个环境」成立：
// 重新构建哈希就变、换环境协议就变、换机器路径就变。
// 引导示例项目曾把它写进节点结果 → 落盘进 project.json → 换成打包版打开即裂图 + CSP 拒载
// （见 docs/plan/2026-07-30-demo-asset-persisted-bundle-url.md）。
//
// 所以：这类 URL 只能**当场渲染**，绝不能进任何会持久化的状态。下面把现存出现点钉成白名单，
// 每条注明「为什么只渲染不落盘」。新增一处会红——那时请先回答：这个 URL 会不会被写进用户数据？
// 会 → 改走主进程落成项目资产（electron/onboarding/demoAssetSeed.ts 是范例）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url))

/** 只渲染、不持久化 → 允许直接用构建产物 URL。键 = 相对 src/ 的路径。 */
const RENDER_ONLY_ALLOWLIST: Record<string, string> = {
  'config/knownVendors.ts': '厂商 logo：只喂 <img src>，接入卡渲染完即弃，不进 catalog/项目文件。',
  'config/modelProviderIdentity.ts': '模型/厂商 logo：仅用于现有选择器当场渲染，不写入 catalog 或项目文件。',
  'workbench/generationCanvas/nodes/scene3d/scene3dConstants.ts':
    '假人 GLB / 动画 GLB：只喂 three 的 loader，不进节点结果，也不落项目。',
  'workbench/generationCanvas/nodes/scene3d/ueSpike/ue4MannequinRig.ts':
    'UE 人偶 GLB（3d-director-desk 收编 spike）：只喂 useGLTF 渲染，不进节点结果，也不落项目。',
  'lib/removeBackground.ts': 'Worker 脚本地址：new Worker 当场消费，不是资产 URL。',
}

const BUNDLE_ASSET_URL = /new URL\(\s*['"`][^'"`\n]+['"`]\s*,\s*import\.meta\.url\s*\)/

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    // 测试自己用 import.meta.url 定位仓库路径，与「资源 URL」无关。
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return [full]
  })
}

describe('构建产物 URL 的边界', () => {
  const offenders = collectSourceFiles(SRC_ROOT)
    .filter((file) => BUNDLE_ASSET_URL.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join('/'))
    .sort()

  it('只出现在「只渲染不落盘」白名单里', () => {
    expect(offenders).toEqual(Object.keys(RENDER_ONLY_ALLOWLIST).sort())
  })

  it('引导目录一处都没有（示例成图必须走主进程 seed 成项目资产）', () => {
    expect(offenders.filter((file) => file.startsWith('workbench/onboarding/'))).toEqual([])
  })
})
