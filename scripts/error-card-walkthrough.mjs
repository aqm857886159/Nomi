// R13 真机走查（错误卡说的是不是人话 + 长文案会不会撑爆卡）：零 vendor 调用、零额度。
//
// 做法：先用 UI 建一个空白项目 + 两个节点并存盘 → 关掉 App → 直接改 .nomi/project.json 把这两个
// 节点写成失败态、error 塞**用户真机抓到的原始上游报文** → 重开 App 打开该项目 → 截图 + 打印
// 错误卡的真实 DOM 文案与几何。
//
// 为什么要seed而不是真跑：这两类失败一类要真人脸参考图撞火山方舟审核、一类要免费图床恰好挂掉，
// 都复现不稳定；而**我改的是分类器 + 文案**，错误字符串照抄用户截图里的原话即可保真。
//
// 用法：pnpm build 后 node scripts/error-card-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.error-card-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log('  📸 ' + name)
}

// 用户 2026-07-31 真机截图里的两条原始报文，一字不改。
const ARK_MODERATION_RAW =
  "Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::" +
  Buffer.from(
    JSON.stringify({
      category: 'input',
      httpStatus: 400,
      upstreamMsg:
        '{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image \'content[1]\' may contain real person. Request id: 0217854745934891b8c9f69a83502ac57f9e97e4a3cfb74b86bb8","param":"content[1]","type":"BadRequest"}}',
      vendorKey: 'sd-dawnloadai-com',
    }),
    'utf8',
  ).toString('base64') +
  ':: Provider request failed (HTTP 400) at sd-dawnloadai-com POST https://sd.dawnloadai.com:8443/api/v3/contents/generations/tasks: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image \'content[1]\' may contain real person.","param":"content[1]","type":"BadRequest"}}'

const UPLOAD_CHAIN_RAW =
  "Error invoking remote method 'nomi:tasks:run': Error: 所有免配置上传 host 都失败：litterbox.catbox.moe: 素材上传失败(HTTP 500): (无详情)；tmpfiles.org: fetch failed"

const isolatedSettings = path.join(os.tmpdir(), 'nomi-errcard-walk-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-errcard-walk-projects')
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })

const launch = (settleMs) =>
  launchNomiApp({ name: 'error-card', settingsDir: isolatedSettings, projectsDir: isolatedProjects, settleMs })

let failed = false

// ── 第 1 程：建项目 + 两个节点，让 App 自己把 schema 写盘 ──────────────────────
{
  const { app, win } = await launch()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)
  // 左缘点法收口在 ../tests/ux/_canvasRail.mjs：循环里拼中文 label 同样会在英文界面下落空。
  for (const kind of ['video', 'image']) {
    await addCanvasNodeFromRail(win, kind)
    await win.waitForTimeout(1000)
  }
  await shot(win, '01-seeded-nodes.png')
  await win.waitForTimeout(2500) // 等自动存盘
  await app.close().catch(() => {})
}

// ── 改盘：把两个节点写成失败态 ──────────────────────────────────────────────
const projectDirs = readdirSync(isolatedProjects, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(isolatedProjects, e.name))
const projectFile = projectDirs
  .flatMap((dir) => [path.join(dir, '.nomi', 'project.json'), path.join(dir, 'project.json')])
  .find((p) => existsSync(p))
if (!projectFile) {
  console.log('✗ 没找到 project.json，seed 失败；候选目录：' + projectDirs.join(', '))
  process.exit(1)
}
{
  const project = JSON.parse(readFileSync(projectFile, 'utf8'))
  const nodes = project.payload?.generationCanvas?.nodes || []
  if (nodes.length < 2) {
    console.log('✗ project.json 里只有 ' + nodes.length + ' 个节点，seed 失败')
    process.exit(1)
  }
  nodes[0].status = 'error'
  nodes[0].error = ARK_MODERATION_RAW
  nodes[1].status = 'error'
  nodes[1].error = UPLOAD_CHAIN_RAW
  writeFileSync(projectFile, JSON.stringify(project))
  console.log('  [seed] 已把 ' + path.basename(path.dirname(path.dirname(projectFile))) + ' 的两个节点写成失败态')
}

// ── 第 2 程：重开，看用户真正看到什么 ──────────────────────────────────────
{
  const { app, win } = await launch(2000)
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
    // 开屏停在项目库：最近项目卡上的「继续创作」进去。
    const recent = win.getByText('继续创作', { exact: true }).first()
    if (await recent.isVisible().catch(() => false)) {
      await recent.click()
      await win.waitForTimeout(3000)
    }
    const canvasTab = win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true })
    if (await canvasTab.isVisible().catch(() => false)) {
      await canvasTab.click()
      await win.waitForTimeout(2000)
    }
    await shot(win, '02-error-cards.png')
    // 单卡特写：整屏截图缩下来看不清文案有没有被裁，必须逐卡放大亲眼核（眼见链）。
    const cardEls = win.locator('[role="alert"][aria-label*="生成失败"]')
    for (let i = 0; i < (await cardEls.count()); i += 1) {
      await cardEls.nth(i).screenshot({ path: path.join(outDir, `03-card-${i + 1}.png`) })
      console.log(`  📸 03-card-${i + 1}.png`)
    }

    const cards = await win.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"][aria-label*="生成失败"]')).map((el) => {
        const box = el.getBoundingClientRect()
        const buttons = Array.from(el.querySelectorAll('button')).map((b) => ({
          label: (b.textContent || '').trim(),
          bottom: Math.round(b.getBoundingClientRect().bottom),
        }))
        // 横向溢出判据：上游原话常是一整串无空格 JSON/URL，不 break 就被切掉右半截。
        const paragraphs = Array.from(el.querySelectorAll('p'))
        return {
          aria: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim(),
          box: { w: Math.round(box.width), h: Math.round(box.height), bottom: Math.round(box.bottom) },
          // 撑爆判据：任何按钮的底边越过卡片底边 = 主动作被挤出可视区（长 hint 的真实风险）。
          overflow: buttons.some((b) => b.bottom > Math.round(box.bottom) + 1),
          clipped: paragraphs.filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => (p.textContent || '').slice(0, 40)),
          buttons,
        }
      }),
    )

    if (cards.length < 2) {
      console.log('  ✗ 只找到 ' + cards.length + ' 张错误卡（应为 2）')
      failed = true
    }
    for (const card of cards) {
      console.log('\n  ── 错误卡 ' + card.box.w + '×' + card.box.h + ' ──')
      console.log('  aria: ' + card.aria)
      console.log('  text: ' + card.text)
      console.log('  按钮: ' + card.buttons.map((b) => b.label).join(' | '))
      console.log('  撑爆: ' + card.overflow)
      if (card.overflow) {
        console.log('  ✗ 文案把动作按钮挤出卡片了')
        failed = true
      }
      if (card.clipped.length) {
        console.log('  ✗ 有段落横向溢出被切掉：' + card.clipped.join(' / '))
        failed = true
      }
    }
    const all = cards.map((c) => c.text).join('\n')
    const must = [
      ['参考图被内容安全挡了', '内容安全那条没走到新分类'],
      ['换一张参考图', '没告诉用户真正能做的事'],
      ['参考图没能送到服务商', '图床全挂那条没走到新分类'],
    ]
    for (const [needle, why] of must) {
      if (!all.includes(needle)) {
        console.log('  ✗ 缺「' + needle + '」——' + why)
        failed = true
      }
    }
    const mustNot = [
      ['参数不被接受', '审核拦截仍被说成参数错'],
      ['比例/尺寸', '仍在让用户去调比例（救不了）'],
      ['额度问题', '仍在甩锅给根本没被请求到的服务商'],
      ['invoking remote method', 'Electron IPC 包装前缀仍怼在用户脸上'],
    ]
    for (const [needle, why] of mustNot) {
      if (all.includes(needle)) {
        console.log('  ✗ 仍出现「' + needle + '」——' + why)
        failed = true
      }
    }
  } catch (error) {
    console.log('  ✗ 走查抛错: ' + String(error).slice(0, 400))
    failed = true
  } finally {
    await app.close().catch(() => {})
  }
}

console.log(failed ? '\n✗ 走查未通过' : '\n✓ 走查通过：两类失败都说人话、动作对、卡片没被撑爆')
process.exit(failed ? 1 : 0)
