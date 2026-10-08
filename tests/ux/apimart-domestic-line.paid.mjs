#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实付费核对 · APIMart 国内线路真出一张图（2026-09-29：截图只能证明请求发去了哪，证明不了真能出图）。
//
// 在**打好的安装包**上跑：设置里把 APIMart 地址改成国内线路 https://api.apib.ai，用最便宜的 Z-Image Turbo
// 在画布上真生成一张。断言两件事：生成请求（提交 + 轮询）的主机是 api.apib.ai、改完地址后官方主域 0 次；
// 图真的落到节点上。花费不从 key 查——只按 APIMart 公开价目接口（免鉴权）算，并记下任务应答里带的计费字段。
//
// 护栏全走 tests/ux/_paidRun.mjs + _realProfile.mjs：CI 拒跑、没有 NOMI_SPEND_OK=1 拒跑、用户自己的 Nomi
// 开着拒跑；真实资料只按字节拷进临时副本（不解密、不打印 key），App 一关就删副本，跑完核对原库一个字节没变；
// 花钱面收窄到被授权的这一个模型。主进程出站只记账不拦截（apimart-line-netsim.cjs 的 RECORD_ONLY 档）。
//
// 用法：NOMI_SPEND_OK=1 node tests/ux/apimart-domestic-line.paid.mjs --packaged <Nomi.exe>
//       截图与记录写到 NOMI_WALK_OUT（默认仓库根 .apimart-line-paid/）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { assertPaidRunAllowed, lockSpendToModels } from './_paidRun.mjs'
import { removeRealCredentials, seedRealCredentials, seedRealModels } from './_realProfile.mjs'
import {
  DOMESTIC, NETSIM, PRIMARY, UI, closeSettings, generateOnce, healthSettled, modelsSectionText, netLog, openModels, repoRoot, saveAddress, takePackagedFlag,
} from '../../scripts/apimart-line-walk-steps.mjs'

const SCRIPT = 'tests/ux/apimart-domestic-line.paid.mjs'
const MODEL = { vendorKey: 'apimart', modelKey: 'z-image-turbo' }
const argv = process.argv.slice(2)
const PACKAGED = takePackagedFlag(argv)
if (!PACKAGED) throw new Error('这条核对只在打好的安装包上跑：--packaged <Nomi 可执行文件>')

const guard = assertPaidRunAllowed(SCRIPT)
const out = path.resolve(process.env.NOMI_WALK_OUT || path.join(repoRoot, '.apimart-line-paid'))
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const log = path.join(out, 'network.jsonl')
const root = makeTempDir('nomi-apimart-line-paid-')
const dirs = { settingsDir: path.join(root, 'settings'), userDataDir: path.join(root, 'user-data'), projectsDir: path.join(root, 'projects') }
const t = UI['zh-CN']
const report = { script: SCRIPT, build: { packaged: PACKAGED, version: null }, model: `${MODEL.vendorKey}/${MODEL.modelKey}`, checks: [], shots: [] }
const check = (id, ok, detail) => {
  report.checks.push({ id, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${id} ${detail}`)
}
const shot = async (win, name) => {
  const file = path.join(out, name)
  await win.screenshot({ path: file })
  report.shots.push(file)
  return file
}
/** 这一段里真的发出去的请求（记账档只记 origin + path、状态码、带没带 key；从不记 key）。 */
const realRequests = (since = 0) => netLog(log).slice(since).filter((entry) => entry.kind === 'real' || entry.kind === 'real-failed')

let app
let failure
try {
  seedRealCredentials(dirs)
  const seeded = seedRealModels({ ...dirs, models: [MODEL] })
  const launched = await launchNomiApp({
    name: 'apimart-line-paid', tempRoot: root, ...dirs, executablePath: PACKAGED,
    mainRequire: [NETSIM], initialLocalStorage: { 'nomi:locale:v1': 'zh-CN' },
    env: { NOMI_NETSIM_LOG: log, NOMI_NETSIM_RECORD_ONLY: '1' },
    settleMs: 2500,
  })
  app = launched.app
  const { win } = launched
  report.build.version = await app.evaluate(({ app: mainApp }) => mainApp.getVersion())
  if (!netLog(log).some((entry) => entry.kind === 'netsim-loaded' && entry.mode === 'record-only')) {
    throw new Error('记账没在主入口之前装上——看不见请求发去哪，就不花这笔钱')
  }
  report.disabledUnauthorizedModels = await lockSpendToModels(win, seeded)

  // ① 设置 → 模型 → 已接入的 APIMart → 地址改成国内线路 → 保存
  await openModels(win, t)
  await win.locator('[data-model-home-connection="apimart"]').click()
  await healthSettled(win)
  await shot(win, '01-real-card-before.png')
  const error = await saveAddress(win, t, DOMESTIC)
  await healthSettled(win)
  await shot(win, '02-real-card-address-domestic.png')
  report.cardAfterAddress = (await modelsSectionText(win)).split('\n').slice(0, 12).join(' | ')
  check('地址改成国内线路', !error && (await modelsSectionText(win)).includes(DOMESTIC), error ? `保存报错：${error}` : `地址行显示 ${DOMESTIC}，没有报错`)

  // ② 画布上用 Z-Image Turbo 真生成一张
  await closeSettings(win)
  const mark = netLog(log).length
  const startedAt = Date.now()
  let generateError = ''
  try {
    await generateOnce(win, t, { model: /Z-Image Turbo/, prompt: '一只橘猫坐在窗台上晒太阳，水彩风格', timeout: 240_000 })
  } catch (caught) {
    generateError = String(caught?.message || caught).split('\n')[0].slice(0, 300)
  }
  report.generationSeconds = Math.round((Date.now() - startedAt) / 1000)
  await shot(win, '03-real-image-on-node.png')
  const traffic = realRequests(mark)
  const submits = traffic.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/v1/images/generations'))
  const polls = traffic.filter((entry) => entry.method === 'GET' && /\/v1\/tasks\//.test(entry.url))
  const primaryHits = traffic.filter((entry) => entry.url.startsWith(PRIMARY))
  report.traffic = traffic
  check('生成请求的主机是 api.apib.ai', submits.length === 1 && submits[0].url === `${DOMESTIC}/v1/images/generations` && polls.length > 0
    && polls.every((entry) => entry.url.startsWith(`${DOMESTIC}/v1/tasks/`)) && primaryHits.length === 0,
  `提交 ${submits.map((entry) => `${entry.url}（${entry.status}）`).join('、') || '（没有）'}；轮询 ${polls.length} 次都在 ${DOMESTIC}；官方主域 ${primaryHits.length} 次`)
  const landed = await win.evaluate(() => [...document.querySelectorAll('[data-node-id] img')].some((img) => img.complete && img.naturalWidth > 200))
  const resultHosts = [...new Set(polls.flatMap((entry) => Object.entries(entry.reply ?? {}).filter(([key]) => key.endsWith('.host')).map(([, host]) => host)))]
  report.resultImageHosts = resultHosts
  check('图真的落到了节点上', !generateError && landed, generateError ? `没出图：${generateError}` : `出图用了约 ${report.generationSeconds} 秒；结果图在 ${resultHosts.join('、') || '（应答里没摘到）'}`)
  report.billingFieldsInReplies = polls.concat(submits).map((entry) => Object.fromEntries(Object.entries(entry.reply ?? {}).filter(([key]) => /cost|credit|price|quota|consum/i.test(key))))
    .filter((fields) => Object.keys(fields).length)
} catch (caught) {
  failure = caught
} finally {
  await app?.close().catch(() => undefined)
  // App 已关：凭据副本当场删掉（目录一族 + Windows 的 Local State），再核对原库一个字节没变，最后整个临时目录删掉。
  report.credentialCopyRemoved = removeRealCredentials(dirs)
  try { guard.assertRealProfileUntouched(); report.realProfileUntouched = true } catch (caught) { report.realProfileUntouched = false; failure ??= caught }
  fs.rmSync(root, { recursive: true, force: true })
}

// 花费：APIMart 公开价目接口（免鉴权，不碰 key）。实扣 = model_price × actual_discount%（2026-09-24 真 key 实测与之分毫不差）。
try {
  const response = await fetch(`${DOMESTIC}/api/pricing/model?model=${MODEL.modelKey}`, { signal: AbortSignal.timeout(20_000) })
  report.pricing = { from: `${DOMESTIC}/api/pricing/model?model=${MODEL.modelKey}`, status: response.status, body: await response.json() }
} catch (caught) {
  report.pricing = { error: String(caught?.message || caught) }
}
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2))
console.log(`\n被测构建：${PACKAGED}（版本 ${report.build.version ?? '未知'}）；凭据副本已删：${report.credentialCopyRemoved}；原库没动：${report.realProfileUntouched}`)
if (failure) {
  console.error(failure)
  process.exit(1)
}
process.exit(report.checks.every((entry) => entry.ok) ? 0 : 1)
