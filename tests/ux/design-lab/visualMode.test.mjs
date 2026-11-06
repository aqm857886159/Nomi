import { makeTempDir } from '../../../scripts/_test-temp.mjs'
// 「哪台机器说了算」与「CI 产物怎么回到基线」（2026-10-18）。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { main as accept, withCalibratedRunner } from '../../../scripts/design-lab-accept.mjs'
import { acceptPlan, decideVisualMode, majorMinor, runnerIdentityFrom, sameRunner, visualVerdict } from './visualMode.mjs'

const CI_MAC = runnerIdentityFrom({ platform: 'darwin', arch: 'arm64', productVersion: '26.4.1\n' })

describe('基准机身份', () => {
  it('补丁版本不算换机器，小版本算', () => {
    expect(majorMinor('26.4.1')).toBe('26.4')
    expect(majorMinor('26')).toBe('26.0')
    expect(sameRunner(CI_MAC, runnerIdentityFrom({ platform: 'darwin', arch: 'arm64', productVersion: '26.4' }))).toBe(true)
    expect(sameRunner(CI_MAC, runnerIdentityFrom({ platform: 'darwin', arch: 'arm64', productVersion: '26.5' }))).toBe(false)
    expect(sameRunner(CI_MAC, { ...CI_MAC, arch: 'x64' })).toBe(false)
    expect(sameRunner(CI_MAC, null)).toBe(false)
  })
})

describe('这一趟视觉道怎么跑', () => {
  it('非 macOS 不比像素', () => {
    expect(decideVisualMode({ identity: { platform: 'linux', arch: 'x64' }, calibrated: CI_MAC, ci: true })).toBe('skip-platform')
  })
  it('CI 上机器一致才硬拦', () => {
    expect(decideVisualMode({ identity: CI_MAC, calibrated: CI_MAC, ci: true })).toBe('strict')
  })
  it('CI 上机器不一致（含首次登记为 null）照样比对', () => {
    expect(decideVisualMode({ identity: CI_MAC, calibrated: null, ci: true })).toBe('runner-drift')
    expect(decideVisualMode({ identity: CI_MAC, calibrated: { ...CI_MAC, osVersion: '26.3' }, ci: true })).toBe('runner-drift')
  })
})

describe('跑完红不红：只看像素，不看版本号', () => {
  // 11-06：同一个 macos-26 标签下 26.6 / 26.7 混着派活，两边 154 张全在容差内，以前照红。
  it('换了小版本的机器，像素全对就放行，并说明不用重录', () => {
    expect(visualVerdict({ mode: 'runner-drift', pixelsPassed: true })).toEqual({ exitCode: 0, kind: 'pass-other-runner' })
  })
  it('换了小版本的机器，像素不符照样红，并点破可能是镜像换了字体', () => {
    expect(visualVerdict({ mode: 'runner-drift', pixelsPassed: false })).toEqual({ exitCode: 1, kind: 'mismatch-other-runner' })
  })
  it('基准机上像素不符就红', () => {
    expect(visualVerdict({ mode: 'strict', pixelsPassed: false })).toEqual({ exitCode: 1, kind: 'mismatch' })
    expect(visualVerdict({ mode: 'strict', pixelsPassed: true })).toEqual({ exitCode: 0, kind: 'pass' })
  })
  it('本机不符只报告', () => {
    expect(visualVerdict({ mode: 'advisory', pixelsPassed: false })).toEqual({ exitCode: 0, kind: 'advisory-mismatch' })
  })
  it('CI 上任何模式，像素不符都不会被放行', () => {
    for (const mode of ['strict', 'runner-drift']) expect(visualVerdict({ mode, pixelsPassed: false }).exitCode).toBe(1)
  })
  it('本机 Mac 只报告不阻断——哪怕版本恰好相同，本机也不是基准机', () => {
    expect(decideVisualMode({ identity: CI_MAC, calibrated: { ...CI_MAC, osVersion: '26.5' }, ci: false })).toBe('advisory')
    expect(decideVisualMode({ identity: CI_MAC, calibrated: CI_MAC, ci: false })).toBe('advisory')
  })
})

describe('CI 产物 → 基线', () => {
  // 形状抄自 2026-10-18 本机真实跑出的 test-results 目录。
  const files = [
    'test-results/design-lab.visual-design-l-999c4-ry-default（项目库主入口，全仓仅此-3-张）/primitives-actions/pa-04-action-card-actual.png',
    'test-results/design-lab.visual-design-l-999c4-ry-default（项目库主入口，全仓仅此-3-张）/primitives-actions/pa-04-action-card-expected.png',
    'test-results/design-lab.visual-design-l-999c4-ry-default（项目库主入口，全仓仅此-3-张）/primitives-actions/pa-04-action-card-diff.png',
    'test-results/design-lab.visual-design-l-83002-ow-menu-·-B5b/storyboard-batch/sbb-b5-04-row-menu-actual.png',
    'test-results/design-lab.visual-design-l-83002-ow-menu-·-B5b/error-context.md',
    'outputs/design-lab/runner.json',
  ]
  it('只取 -actual.png，落到 <屏>/<状态>.png', () => {
    expect(acceptPlan(files).map((entry) => entry.to)).toEqual([
      'primitives-actions/pa-04-action-card.png',
      'storyboard-batch/sbb-b5-04-row-menu.png',
    ])
  })
  it('--screen 只取那一屏', () => {
    expect(acceptPlan(files, { screen: 'storyboard-batch' }).map((entry) => entry.to)).toEqual(['storyboard-batch/sbb-b5-04-row-menu.png'])
  })
  it('同一张基线出现两张新图时拒绝，不猜哪张对', () => {
    expect(() => acceptPlan([
      'test-results/a/screen/x-actual.png',
      'test-results/b/screen/x-actual.png',
    ])).toThrow(/两张新图/)
  })
})

describe('design-lab:accept', () => {
  it('只改 calibratedRunner 那一行，其余原样', () => {
    const text = '{\n  "pendingApprovalScreens": {},\n  "calibratedRunner": null,\n  "viewport": { "width": 1440 }\n}\n'
    const next = withCalibratedRunner(text, CI_MAC)
    expect(JSON.parse(next).calibratedRunner).toEqual(CI_MAC)
    expect(next.replace(/^ {2}"calibratedRunner": .*$/m, '')).toBe(text.replace(/^ {2}"calibratedRunner": .*$/m, ''))
  })

  it('下载产物 → 替换基线 → 登记基准机', () => {
    const root = makeTempDir('nomi-design-lab-accept-')
    const paths = {
      baselineRoot: path.join(root, '__baselines__'),
      calibrationFile: path.join(root, 'calibration.json'),
      downloadRoot: path.join(root, 'outputs'),
    }
    fs.mkdirSync(path.join(paths.baselineRoot, 'settings'), { recursive: true })
    fs.writeFileSync(path.join(paths.baselineRoot, 'settings/s-01.png'), 'old')
    fs.writeFileSync(path.join(paths.baselineRoot, 'settings/s-02.png'), 'untouched')
    fs.writeFileSync(paths.calibrationFile, '{\n  "calibratedRunner": null,\n  "viewport": {}\n}\n')
    const download = (runId, dir) => {
      expect(runId).toBe('123')
      fs.mkdirSync(path.join(dir, 'test-results/case/settings'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'test-results/case/settings/s-01-actual.png'), 'new')
      fs.writeFileSync(path.join(dir, 'test-results/case/settings/s-01-diff.png'), 'diff')
      fs.mkdirSync(path.join(dir, 'outputs/design-lab'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'outputs/design-lab/runner.json'), JSON.stringify(CI_MAC))
      return 0
    }
    const lines = []
    expect(accept(['--run', '123'], { log: (line) => lines.push(line), download, paths })).toBe(0)
    expect(fs.readFileSync(path.join(paths.baselineRoot, 'settings/s-01.png'), 'utf8')).toBe('new')
    expect(fs.readFileSync(path.join(paths.baselineRoot, 'settings/s-02.png'), 'utf8')).toBe('untouched')
    expect(JSON.parse(fs.readFileSync(paths.calibrationFile, 'utf8')).calibratedRunner).toEqual(CI_MAC)
    expect(lines.join('\n')).toContain('取回 1 张新基线')
  })

  it('没给运行号或下载失败 → 非零退出，什么都不动', () => {
    const root = makeTempDir('nomi-design-lab-accept-fail-')
    const paths = { baselineRoot: path.join(root, 'b'), calibrationFile: path.join(root, 'c.json'), downloadRoot: path.join(root, 'o') }
    expect(accept([], { log: () => {}, paths })).toBe(1)
    expect(accept(['--run', '9'], { log: () => {}, download: () => 1, paths })).toBe(1)
    expect(fs.existsSync(paths.baselineRoot)).toBe(false)
  })
})
