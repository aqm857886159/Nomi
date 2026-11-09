// 视觉基线「哪台机器说了算」（2026-10-18）。
//
// 以前的校准单位是操作系统（calibratedPlatform: darwin），基线由谁的 Mac 录都算数，
// 合并路径上也没有任何一台机器比对——于是不同 Mac 录的图混在一起、界面改了没人重录，
// 用户本机一跑就是 97 张不符。现在校准单位是**一台机器**：CI 的 macOS 托管机
// （calibration.json 的 calibratedRunner）。它比对就硬拦；别的 Mac 只报告不阻断；
// 基线只从 CI 那次运行的产物取回（scripts/design-lab-accept.mjs），本机不录。
import { spawnSync } from 'node:child_process'

/** 「macOS 26.4.1」与「26.4」视为同一台机器：字体随小版本走，补丁版本不换字体。 */
export function majorMinor(version) {
  const match = /^(\d+)(?:\.(\d+))?/.exec(String(version ?? '').trim())
  return match ? `${match[1]}.${match[2] ?? '0'}` : ''
}

export function runnerIdentityFrom({ platform, arch, productVersion }) {
  if (platform !== 'darwin') return { platform, arch }
  return { platform, arch, osVersion: majorMinor(productVersion) }
}

export function currentRunnerIdentity() {
  if (process.platform !== 'darwin') return runnerIdentityFrom({ platform: process.platform, arch: process.arch })
  const result = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' })
  return runnerIdentityFrom({ platform: 'darwin', arch: process.arch, productVersion: result.stdout })
}

export function sameRunner(a, b) {
  return Boolean(a && b)
    && a.platform === b.platform
    && a.arch === b.arch
    && a.osVersion === b.osVersion
}

export function describeRunner(identity) {
  if (!identity) return '（未登记）'
  return identity.platform === 'darwin'
    ? `macOS ${identity.osVersion || '?'} ${identity.arch}`
    : `${identity.platform} ${identity.arch}`
}

/**
 * 这一趟视觉道怎么跑：
 * - `skip-platform`：不是 macOS，不比像素（字体栅格化不同，红的是平台不是设计）；
 * - `strict`：CI 上、机器与基准机一致，不符就红；
 * - `runner-drift`：CI 上、机器与基准机不一致（镜像升级或首次登记），照样比对、产出新图，判法同 strict，
 *   只是不符时多说一句「是镜像换了」；
 * - `advisory`：本机 Mac，比对并报告差异，不阻断——本机不是基准机，以 CI 为准。
 */
export function decideVisualMode({ identity, calibrated, ci }) {
  if (identity.platform !== 'darwin') return 'skip-platform'
  if (!ci) return 'advisory'
  return sameRunner(identity, calibrated) ? 'strict' : 'runner-drift'
}

/**
 * 跑完以后红不红（2026-11-06）。只看像素，不看机器版本号。
 *
 * 以前 `runner-drift` 哪怕像素全在容差内也判红，要人重录、改 calibratedRunner。GitHub 换 macOS 小版本
 * 是分批的，换代那几天同一个 `macos-26` 标签下 26.6 和 26.7 混着派活：基准机写哪个版本，另一半 PR
 * 都红，改登记也救不回来（11-06 两种机器上 154 张全在容差内，PR 照红）。原方案（docs/plan/
 * 2026-10-18-design-lab-macos-ci.md「残留风险」）要的是「版本不符且像素不符时，说清是镜像漂移、需要重录」，
 * 不是像素对了也拦。基准机登记仍留着：它说明基线是哪台机器录的，不符时用来点破原因。
 */
export function visualVerdict({ mode, pixelsPassed }) {
  if (pixelsPassed) return { exitCode: 0, kind: mode === 'runner-drift' ? 'pass-other-runner' : 'pass' }
  if (mode === 'advisory') return { exitCode: 0, kind: 'advisory-mismatch' }
  return { exitCode: 1, kind: mode === 'runner-drift' ? 'mismatch-other-runner' : 'mismatch' }
}

export function isCiEnvironment(env = process.env) {
  return env.CI === 'true' || env.GITHUB_ACTIONS === 'true'
}

/**
 * CI 产物里的新图 → 基线路径。Playwright 把不符或缺失的那一格写成
 * `test-results/<用例目录>/<屏>/<状态>-actual.png`；基线是 `__baselines__/<屏>/<状态>.png`。
 * 只认这一种形状，其余文件（-expected / -diff / trace）一律不碰。
 */
export function acceptPlan(artifactFiles, { screen } = {}) {
  const plan = []
  for (const file of artifactFiles) {
    const normalized = file.split('\\').join('/')
    const match = /(?:^|\/)test-results\/[^/]+\/([^/]+)\/([^/]+)-actual\.png$/.exec(normalized)
    if (!match) continue
    const [, screenId, stateId] = match
    if (screen && screenId !== screen) continue
    plan.push({ from: file, screen: screenId, state: stateId, to: `${screenId}/${stateId}.png` })
  }
  const seen = new Map()
  for (const entry of plan) {
    const previous = seen.get(entry.to)
    if (previous) throw new Error(`同一张基线有两张新图：${previous.from} 与 ${entry.from}`)
    seen.set(entry.to, entry)
  }
  return plan.sort((a, b) => a.to.localeCompare(b.to))
}
