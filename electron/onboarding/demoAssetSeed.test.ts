// 跨进程约定的看门狗：示例成图的 clientId 清单住主进程（demoAssetSeed），分镜方案住渲染进程
// （src/workbench/onboarding/demoProject.ts）。两边一漂就会有节点拿不到成图、或有图落不到节点上，
// 而且是静默的——引导跑完只是「某几张空着」，没人报错。所以在这里钉死。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { DEMO_ASSET_FILES } from '../shared/onboardingDemoAssets'
import { buildDemoStoryboardPlan } from '../../src/workbench/onboarding/demoProject'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_DIR = path.join(REPO_ROOT, 'resources', 'onboarding-demo')

describe('引导示例成图', () => {
  it('clientId 清单与分镜方案完全一致', () => {
    const plan = buildDemoStoryboardPlan()
    const planIds = [
      ...plan.anchors.map((anchor) => anchor.id),
      ...plan.shots.map((shot) => `shot-${shot.index}`),
    ].sort()
    expect(Object.keys(DEMO_ASSET_FILES).sort()).toEqual(planIds)
  })

  it('每个 clientId 指向的随包图都真实存在', () => {
    for (const fileName of new Set(Object.values(DEMO_ASSET_FILES))) {
      expect(fs.existsSync(path.join(SOURCE_DIR, fileName)), `缺图：${fileName}`).toBe(true)
    }
  })

  it('resources/ 随包走——否则打包版读不到图（放 src/ 又会被 Vite 加哈希）', () => {
    // app.getAppPath()/resources 在 dev（仓库根）与打包版（app.asar 根）是同一条路径。
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      build?: { files?: string[] }
    }
    expect(pkg.build?.files ?? []).toContain('resources/**')
  })
})
