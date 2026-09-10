// Finish the already-paid, persisted film after a harness interruption. Every paid HTTP request is blocked.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ffprobe from '@ffprobe-installer/ffprobe'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from '../_launchApp.mjs'
import { expect, screenshotSettled } from '../_assert.mjs'
import { readProject } from '../agent-runtime-walk-support.mjs'
import { stationTimeout } from '../_station-budget.mjs'
import { completedExports } from './sweep-timeline.mjs'
const attempt = path.resolve(process.argv[2]), profile = path.join(attempt, 'profile'), file = path.join(attempt, 'report.json')
const report = JSON.parse(fs.readFileSync(file)), projectRoot = report.projectRoot
const original = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi/project.json'))), projectId = original.projectId ?? original.id
let launched, win
const payload = async () => (await readProject(win, projectId)).payload
const clips = p => p.timeline.tracks.flatMap(t => t.clips).filter(c => c.type === 'video').sort((a,b) => a.startFrame-b.startFrame)
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2))
const launch = async () => {
  const app = await launchNomiApp({ name: 'c71-resume-media', tempRoot: profile, userDataDir: path.join(profile, 'chromium'), settingsDir: path.join(profile, 'settings'), projectsDir: path.join(profile, 'projects'), settleMs: 0,
    env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_E2E_PRODUCTION_FIXTURE: '0' } })
  await app.app.evaluate(({ app: main }) => {
    const transport = process.mainModule.require(main.getAppPath() + '/dist-electron/appFetch.js')
    const block = async () => { throw Error('C71_RESUME_OUTBOUND_DISABLED') }
    transport.appFetch = block; globalThis.fetch = block
  })
  return app
}
async function step(id, action, run) {
  const row = { id, action, continuation: true, started: new Date().toISOString() }, began = performance.now()
  report.steps.push(row)
  try { await run(); row.result = 'assertions-passed'; row.screenshot = path.join(attempt, `${id}-resumed.png`); await screenshotSettled(win, { path: row.screenshot }) }
  catch (error) { row.result = 'failed'; row.diagnostic = String(error.message).slice(0, 1800); throw error }
  finally { row.seconds = (performance.now()-began)/1000; row.ended = new Date().toISOString(); save() }
}
try {
  launched = await launch(); win = launched.win
  const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  const project = projects.find(p => p.rootPath === projectRoot)
  if (!project || project.id !== projectId) throw Error('C71_RESUME_PROJECT_ID_MISMATCH')
  await win.locator(`[data-project-id="${project.id}"]`).click()
  await step('05', '恢复同一真实项目：切到生成画布、入轴并预览', async () => {
    await win.getByRole('button', { name: '生成', exact: true }).click()
    const nodes = (await payload()).generationCanvas.nodes.sort((a,b) => a.shotIndex-b.shotIndex)
    expect(nodes).toHaveLength(report.quote.shots); expect(nodes.every(n => n.status==='success' && n.result.url.startsWith('nomi-local://'))).toBe(true)
    for (const node of nodes) {
      if (clips(await payload()).some(c=>c.sourceNodeId===node.id)) continue
      const collapse=win.getByRole('button',{name:'收起画面小窗',exact:true}); if(await collapse.isVisible()) await collapse.click()
      await win.getByLabel('适应视图').first().click()
      const card=win.locator(`[data-node-id="${node.id}"]`); await card.click({position:{x:35,y:16}}); await card.locator('[aria-label*="加入时间轴"]').first().click()
      await expect.poll(async()=>clips(await payload()).some(c=>c.sourceNodeId===node.id)).toBe(true)
    }
    expect(clips(await payload()).map(c=>c.sourceNodeId)).toEqual(nodes.map(n=>n.id))
    await win.locator('[aria-label="工作区切换"]').getByText('预览',{exact:true}).click(); await win.locator('[aria-label="播放"]:visible').first().click()
    await expect.poll(()=>win.locator('.workbench-preview-player__video').first().evaluate(v=>v.readyState>=2 && v.currentTime>0)).toBe(true)
  })
  await step('06', '通过Nomi导出真实两镜MP4并完整解码', async()=>{
    await win.locator('[aria-label="导出 MP4"]').first().click()
    await expect.poll(()=>completedExports(projectRoot).length,{timeout:stationTimeout({turns:1,operations:0})}).toBe(1)
    const media=path.join(projectRoot,completedExports(projectRoot)[0])
    await expect.poll(()=>{try{execFileSync(ffprobe.path,['-v','error','-show_format',media],{stdio:'pipe'});return true}catch{return false}}).toBe(true)
    const probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',media],{encoding:'utf8'})),p=await payload()
    expect(Number(probe.format.duration)).toBeCloseTo(clips(p).at(-1).endFrame/p.timeline.fps,1)
    execFileSync(ffmpeg.path,['-v','error','-xerror','-i',media,'-f','null','-'],{stdio:'pipe'})
    report.export={path:media,sha256:createHash('sha256').update(fs.readFileSync(media)).digest('hex'),bytes:fs.statSync(media).size,probe}
    for(const [name,at] of [['first',0],['middle',Number(probe.format.duration)/2],['last',Number(probe.format.duration)-0.25]]) execFileSync(ffmpeg.path,['-v','error','-ss',String(at),'-i',media,'-frames:v','1',path.join(attempt,`${name}.png`)],{stdio:'pipe'})
  })
  await step('07','冷重启恢复已保存两镜资产与时间轴',async()=>{
    const before=await payload(); await launched.close(); launched=await launch();win=launched.win
    const after=await payload();expect(clips(after)).toEqual(clips(before));expect(after.generationCanvas.nodes.map(n=>n.result)).toEqual(before.generationCanvas.nodes.map(n=>n.result))
    await win.locator(`[data-project-id="${projectId}"]`).click();await win.locator('[aria-label="工作区切换"]').getByText('预览',{exact:true}).click();await expect(win.locator('.workbench-preview-player__video').first()).toBeVisible()
  })
  report.result='assertions-passed-after-harness-recovery-review-pending';report.recovery={paidCalls:0,outbound:'disabled',preservedFailure:'original stage05 remains in steps'}
}catch(error){report.result='media-recovery-failed';report.recoveryError=String(error.message).slice(0,2000);process.exitCode=1}
finally{await launched?.close();fs.rmSync(path.join(profile,'settings'),{recursive:true,force:true});save();console.log(JSON.stringify({result:report.result,evidence:attempt}))}
