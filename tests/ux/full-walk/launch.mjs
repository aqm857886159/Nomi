// 一条剧本的起点：核心冒烟那只夹具（同一套建项目 / 起 App / 从项目库打开）+ 出网闸 + 九条铁律的监视器。
//
// 不另起一套启动器：项目怎么造、App 怎么起、依赖怎么备，全走 `tests/ux/core-smoke/fixture.mjs`（R1：不做并行版）。
// 这里只多挂三样：出网闸（egress.mjs）、夹具的「按真实请求报用量」档（铁律 8 要它）、监视器。
//
// 变体（「乱用」那一档）与语言由跑器经环境变量指派；单跑剧本时缺省 base / zh-CN。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { repoRoot } from '../_launchApp.mjs'
import { launchCoreSmoke } from '../core-smoke/fixture.mjs'
import { standingBackgroundResponders } from './brain.mjs'
import { startEgressWatch } from './egress.mjs'
import { createInvariantMonitor } from './monitor.mjs'
import { startUploadRelay } from './uploadRelay.mjs'

/** 窗口放屏幕外、不抢焦点的主进程模块（`offscreen: true` 的剧本装它）。 */
const OFFSCREEN_MODULE = path.join(repoRoot, 'tests', 'ux', 'full-walk', 'offscreenWindow.cjs')

export function readPlaybookEnvironment(env = process.env) {
  return {
    variant: env.NOMI_FULL_WALK_VARIANT || 'base',
    locale: env.NOMI_FULL_WALK_LOCALE === 'en' ? 'en' : env.NOMI_FULL_WALK_LOCALE === 'zh-CN' ? 'zh-CN' : null,
    runDir: env.NOMI_FULL_WALK_RUN_DIR || null,
    // 取证的 run 钉死明暗：App 默认按本地时间「天黑自动暗」，同一份证据白天夜里拍出来就不是同一个主题，改前 / 改后并排时对不上。
    colorScheme: env.NOMI_FULL_WALK_COLOR_SCHEME === 'light' ? 'light' : env.NOMI_FULL_WALK_COLOR_SCHEME === 'dark' ? 'dark' : null,
  }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

/** 本机此刻有几个 Nomi / Electron 进程（只数，不碰）。 */
function countNomiProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      return out.split('\n').filter((line) => /^"(nomi|electron)\.exe"/i.test(line.trim())).length
    }
    const out = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' })
    return out.split('\n').filter((line) => /(^|\/)(nomi|electron)$/i.test(line.trim())).length
  } catch {
    return 0
  }
}

/**
 * 机器上有别的 Nomi / 走查实例在跑时，等它结束再起（任务规矩：不关别人的进程）。
 * 走查本身用隔离资料目录、允许多实例，不会互相踩；等是为了不和别人的走查抢同一台机器的 CPU / 窗口焦点。
 */
async function waitForOtherNomiToExit({ pollMs = 10_000, maxWaitMs = 30 * 60_000 } = {}) {
  const started = Date.now()
  let count = countNomiProcesses()
  while (count > 0) {
    const waited = Date.now() - started
    if (waited > maxWaitMs) throw new Error(`机器上一直有 ${count} 个 Nomi / Electron 进程（等了 ${Math.round(waited / 60_000)} 分钟），按规矩不关别人的进程，这一条剧本不起`)
    console.log(`[full-walk] 机器上有 ${count} 个 Nomi / Electron 进程在跑，等它们结束（已等 ${Math.round(waited / 1000)}s）`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    count = countNomiProcesses()
  }
}

/**
 * @param {object} options
 * @param {string} options.id                剧本 id（与 catalog.mjs 登记的一致）
 * @param {(helpers) => object} [options.seed] 项目里自带的最少节点（同 launchCoreSmoke）
 * @param {string[]} options.needs            同 core-smoke 的依赖登记表
 * @param {'zh-CN'|'en'} [options.locale]
 * @param {object} [options.fixtureOptions]   交给 createAgentRuntimeFixture 的额外档位
 * @param {Record<string,string>} [options.preferences]
 * @param {boolean} [options.offscreen] 窗口放到屏幕外、不抢焦点（走查在用户桌面上跑时不打扰他）
 * @param {Record<string,string>} [options.env] 额外的主进程环境变量（如 NOMI_WALK_URL_REDIRECTS：公网静态文件改投本机缓存）
 */
export async function startPlaybook({ id, seed = null, needs, locale = 'zh-CN', fixtureOptions = {}, preferences = {}, emptyViewport, offscreen = false, env = {} }) {
  const environment = readPlaybookEnvironment()
  const variant = environment.variant
  const effectiveLocale = environment.locale ?? locale
  const runDir = environment.runDir ?? path.join(repoRoot, 'tests', 'ux', 'shots', 'full-walk', `adhoc-${stamp()}`)
  const outputDir = path.join(runDir, `${id}--${variant}--${effectiveLocale}`)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  // 多个会话同时在这台机器上走查时，别人的 Nomi 可能一直在跑：显式声明「共用这台机器」就不等（仍然不碰别人的进程；走查用隔离资料目录，允许多实例）。
  if (process.env.NOMI_FULL_WALK_SHARE_MACHINE !== '1') await waitForOtherNomiToExit()
  const egress = await startEgressWatch({ logFile: path.join(outputDir, 'egress.jsonl') })
  const relay = await startUploadRelay()
  let smoke
  try {
    smoke = await launchCoreSmoke({
      name: `fw-${id}`,
      seed,
      needs,
      preferences: { ...(environment.colorScheme ? { 'nomi-color-scheme': environment.colorScheme } : {}), ...preferences },
      emptyViewport,
      locale: effectiveLocale,
      syntheticCredentialStorage: true,
      extras: {
        mainRequire: [...egress.mainRequire, ...(offscreen ? [OFFSCREEN_MODULE] : [])],
        env: { ...egress.env, ...relay.env, ...env },
        needsOptions: { fixture: { usage: 'measured', ...fixtureOptions } },
      },
    })
  } catch (error) {
    await egress.close()
    await relay.close()
    throw error
  }
  const fixture = smoke.needs.loopbackProvider
  if (fixture) standingBackgroundResponders(fixture)
  const monitor = createInvariantMonitor({
    playbook: id, variant, outputDir, getWin: () => smoke.win, app: smoke.app, fixture, egress,
    projectId: smoke.project.projectId, projectRoot: smoke.project.projectRoot, settingsDir: smoke.settingsDir,
    locale: effectiveLocale, mainLogTail: smoke.mainLogTail,
  })

  /** 收尾：监视器出报告 → 关 App → 关黑洞代理。退出码：0 = 走通且零违反；1 = 有违反（红）；2 = 剧本没走通（走查故障）。 */
  async function finish(error) {
    let report
    try {
      report = await monitor.finish({ error })
    } finally {
      await smoke.close().catch(() => undefined)
      await egress.close().catch(() => undefined)
      await relay.close().catch(() => undefined)
    }
    const harnessBroken = Boolean(error) || !report.completed || !report.egress.guardReady
    const exitCode = harnessBroken ? 2 : report.violations.length > 0 ? 1 : 0
    fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify({ playbook: id, variant, locale: effectiveLocale, exitCode, violations: report.violations.length, completed: report.completed }, null, 2))
    return exitCode
  }

  return { smoke, fixture, monitor, egress, outputDir, variant, locale: effectiveLocale, finish }
}
