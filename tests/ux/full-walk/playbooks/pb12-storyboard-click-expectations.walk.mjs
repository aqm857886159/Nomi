#!/usr/bin/env node
// 剧本 PB12 · 铁律 ⑫「点了 = 以为的」：分镜表这一屏每个可点的地方各点一下。
//
// 每一下都走 `monitor.checkClickTarget`：点之前读一遍页面（每行显不显示、选没选中、透明度、跳过标记、画面格状态、
// 菜单 / 弹层、所有带 data-storyboard-* 标记的可见元素）和落盘项目，点之后再读一遍，拿 catalog.mjs 里登记的
// userExpectation 对照。判断只用这两份真实观察，不从代码推断；对不上的当场写进逃逸账本 candidate。
//
// 方案 §2 已知「点击选择后反而隐藏」：这里用通用的「点之前看得见、点之后看不见」比对去抓，不预设是哪个元素。
//
// 零花费：供应商是本机回环夹具，出网闸拦真实域名；窗口放在屏幕外、不抢焦点（offscreen），不打扰用户手上的活；
// 隔离资料目录，不连用户开着的 Nomi。
import { clickOrFail, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from '../../agent-runtime-fixture.mjs'
import { STORYBOARD_CLICK_TARGETS } from '../catalog.mjs'
import { uiText } from '../invariants.mjs'
import { readPlaybookEnvironment, startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const DESIGN = 'walk-sb-clicks'
const DOC = 'doc-1'
const shot = (index, prompt) => ({
  index, shotId: `shot-${index}`, shotKind: 'image', durationSec: 4, anchorIds: [], prompt,
  modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR,
})
// 英文那一档用英文写的方案：用户在英文界面里写的是英文，种中文进去只会让铁律 7 去抓我们自己种的字。
const english = readPlaybookEnvironment().locale === 'en'
const plan = {
  title: english ? 'Click walk' : '点击走查',
  profileKey: 'genre.short-drama',
  anchors: [],
  shots: english
    ? [shot(1, 'A fishing harbour at dawn, a small boat heads out'), shot(2, 'A crowded market at noon'), shot(3, 'A lighthouse at dusk, gulls circling')]
    : [shot(1, '清晨的渔港，一条小船出海'), shot(2, '正午的集市，人群熙攘'), shot(3, '黄昏的灯塔，海鸥盘旋')],
}

const pb = await startPlaybook({
  id: 'pb12-storyboard-click-expectations',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  offscreen: true,
  seed: () => ({
    nodes: [], groups: [], edges: [],
    payload: {
      workbenchDocuments: [{
        id: DOC, version: 1, title: plan.title, updatedAt: 10,
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: english ? 'A day by the sea.' : '一天里的海边。' }] }] },
      }],
      activeDocumentId: DOC,
      storyboardDesignsByDocumentId: {
        [DOC]: [{ id: DESIGN, documentId: DOC, title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
      },
    },
  }),
})
const { smoke, fixture, monitor, locale } = pb
const win = () => smoke.win
const editor = () => win().locator('[data-storyboard-editor="true"]:visible')
const row = (index) => editor().locator(`[data-storyboard-row="${index}"]`)
const images = () => fixture.images.filter((record) => record.path === '/v1/images/generations' || record.path?.includes('images'))
const targetOf = (id) => {
  const found = STORYBOARD_CLICK_TARGETS.find((entry) => entry.id === id)
  if (!found) throw new Error(`catalog.mjs 没有登记可点目标 ${id}`)
  return found
}

/** 页面此刻的样子：只读 DOM，不读组件内部状态。 */
async function readPage() {
  const page = await win().evaluate(() => {
    const visible = (element) => {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const opacity = (element) => {
      let value = 1
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) value *= Number(getComputedStyle(node).opacity || 1)
      return Math.round(value * 100) / 100
    }
    const inViewport = (element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    }
    const editorElement = [...document.querySelectorAll('[data-storyboard-editor="true"]')].find(visible)
    const rows = editorElement ? [...editorElement.querySelectorAll('[data-storyboard-row]')].map((element) => ({
      index: Number(element.getAttribute('data-storyboard-row')),
      visible: visible(element),
      selected: element.getAttribute('data-selected') === 'true',
      opacity: opacity(element),
      checkbox: element.querySelector('input[type="checkbox"]')?.checked ?? null,
      skipped: Boolean(element.querySelector('[data-storyboard-skip]')),
      frame: element.querySelector('[data-storyboard-frame]')?.getAttribute('data-storyboard-frame') ?? null,
      composerVisible: visible(element.querySelector('[data-storyboard-composer-bar]')),
    })) : []
    const markers = [...document.querySelectorAll('*')]
      .filter((element) => [...element.attributes].some((attribute) => attribute.name.startsWith('data-storyboard')))
      .filter(visible)
      .map((element) => [...element.attributes].filter((attribute) => attribute.name.startsWith('data-storyboard')).map((attribute) => `${attribute.name}=${attribute.value}`).join(' '))
    return {
      editorVisible: Boolean(editorElement),
      rows,
      menus: [...document.querySelectorAll('[data-storyboard-row-menu]')].filter(visible).map((element) => ({ row: element.getAttribute('data-storyboard-row-menu'), inViewport: inViewport(element) })),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map((element) => element.getAttribute('aria-label') || element.className.toString().slice(0, 60)),
      markers: [...new Set(markers)],
    }
  })
  const project = await monitor.readProject()
  const shots = project?.payload?.storyboardDesignsByDocumentId?.[DOC]?.find((design) => design.id === DESIGN)?.plan?.shots ?? []
  return { ...page, saved: shots.map((entry) => ({ index: entry.index, durationSec: entry.durationSec })), providerImages: images().length }
}

const rowOf = (snapshot, index) => snapshot.rows.find((entry) => entry.index === index)
/** 点之前看得见、点之后看不见的那些东西（方案 §2「点了反而隐藏」用这个抓，不预设是谁）。 */
const vanished = (before, after) => before.markers.filter((marker) => !after.markers.includes(marker) && !/data-storyboard-generate-state|data-storyboard-frame=|data-storyboard-row-menu=/.test(marker))
/** 其余行有没有被这一下改动（选中除外——单击选另一行，原来选中的那行取消选中是正常的）。 */
const othersChanged = (before, after, index) => before.rows.filter((entry) => entry.index !== index).filter((entry) => {
  const next = rowOf(after, entry.index)
  return !next || next.visible !== entry.visible || next.opacity !== entry.opacity || next.skipped !== entry.skipped || next.frame !== entry.frame
}).map((entry) => entry.index)

/** 镜头数变了（多出 / 少了一镜）——任何一下都不该顺手改镜头数。 */
const countChange = (before, after) => (after.rows.length === before.rows.length ? '' : `；镜头数从 ${before.rows.length} 变成了 ${after.rows.length}`)

function describeRow(entry) {
  if (!entry) return '这一行不见了'
  const parts = [entry.selected ? '选中了' : '没有选中']
  if (!entry.visible) parts.push('整行看不见了')
  if (entry.opacity < 1) parts.push(`整行变淡到 ${Math.round(entry.opacity * 100)}%`)
  if (entry.skipped) parts.push('被标成「本次跳过」')
  if (!entry.composerVisible) parts.push('底栏看不见了')
  return parts.join('，')
}

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await monitor.step('切到创作页，从侧栏点开这份分镜方案', async () => {
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="creation"]').first(), '顶栏「创作」')
    const item = win().locator(`[data-storyboard-id="${DESIGN}"]`).first()
    await expect(item, '侧栏里有这份分镜方案').toBeVisible({ timeout: stationTimeout() })
    await clickOrFail(item, '侧栏选中分镜方案')
    await expect(editor().locator('[data-storyboard-row]'), '三镜').toHaveCount(3, { timeout: stationTimeout() })
  }, { surfaces: ['*'], critical: true })
  await monitor.screenshot('01-storyboard-initial')

  // ── 行的空白处 ──
  await monitor.checkClickTarget(targetOf('sb-row-blank'), {
    observe: readPage,
    act: async () => {
      const box = await row(2).boundingBox()
      if (!box) throw new Error('第 2 镜的行量不到位置')
      // 行首竖条下面那一截是行自己（不是按钮 / 输入框）：点那里就是「点这一行的空白处」。
      await row(2).click({ position: { x: 6, y: box.height - 6 } })
      await win().waitForTimeout(400)
    },
    judge: (before, after) => {
      const target = rowOf(after, 2)
      const gone = vanished(before, after)
      const others = othersChanged(before, after, 2)
      const ok = Boolean(target?.selected) && target.visible && target.opacity === 1 && gone.length === 0 && others.length === 0 && after.rows.length === before.rows.length
      return { ok, actual: `第 2 镜${describeRow(target)}${countChange(before, after)}${others.length ? `；第 ${others.join('、')} 镜也变了` : ''}${gone.length ? `；这些东西不见了：${gone.slice(0, 6).join('、')}` : ''}` }
    },
  })

  // ── 画面格左上角的镜号 ──
  await monitor.checkClickTarget(targetOf('sb-shot-number'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(row(3).locator('[data-storyboard-select="3"]').first(), '第 3 镜的镜号')
      await win().waitForTimeout(400)
    },
    judge: (before, after) => {
      const target = rowOf(after, 3)
      const gone = vanished(before, after)
      const generated = after.providerImages > before.providerImages
      const ok = Boolean(target?.selected) && target.visible && target.opacity === 1 && !generated && gone.length === 0 && after.rows.length === before.rows.length
      return { ok, actual: `第 3 镜${describeRow(target)}${countChange(before, after)}${generated ? '；还发了一次生成' : ''}${gone.length ? `；这些东西不见了：${gone.slice(0, 6).join('、')}` : ''}` }
    },
  })

  // ── 行首的「⋯」：打开 → 在窗口里 → 点别处关上 ──
  let menuWhileOpen = null
  await monitor.checkClickTarget(targetOf('sb-row-more'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(row(1).locator('[data-storyboard-row-menu-trigger="1"]').first(), '第 1 镜行首的「⋯」')
      await win().waitForTimeout(300)
      menuWhileOpen = await readPage()
      await monitor.screenshot('click-sb-row-more-open')
      // 点别处：点第 1 镜画面格右上角（菜单开在「⋯」下方，盖不到这一角）。这一下既要把菜单关上，
      // 也要照样落到画面格上（选中第 1 镜）——菜单开着时不许吞掉用户对缩略图的点击。
      const frameBox = await row(1).locator('[data-storyboard-frame-media]').first().boundingBox()
      if (!frameBox) throw new Error('量不到第 1 镜的画面格')
      await win().mouse.click(frameBox.x + frameBox.width - 8, frameBox.y + 8)
      await win().waitForTimeout(300)
    },
    judge: (_before, after) => {
      const menu = menuWhileOpen?.menus.find((entry) => entry.row === '1')
      const closed = !after.menus.some((entry) => entry.row === '1')
      const landed = Boolean(rowOf(after, 1)?.selected)
      const ok = Boolean(menu) && menu.inViewport && closed && landed
      return { ok, actual: !menu ? '没有弹出菜单' : `弹出了菜单${menu.inViewport ? '，整块在窗口里' : '，有一部分出了窗口'}；点第 1 镜画面格之后菜单${closed ? '关上了' : '还开着'}，这一下${landed ? '照样选中了第 1 镜' : '没有落到画面格上'}` }
    },
  })

  // 菜单若还开着，像用户一样再点一次「⋯」把它收起来（这一下不是被测动作）——不收的话它盖着第 1 镜的画面格，
  // 后面点缩略图会点进菜单里（第一次跑就这样点中了「复制镜头」）。
  await monitor.step('再点一次第 1 镜的「⋯」把菜单收起（复原）', async () => {
    if (await win().locator('[data-storyboard-row-menu="1"]').isVisible().catch(() => false)) {
      await clickOrFail(row(1).locator('[data-storyboard-row-menu-trigger="1"]').first(), '第 1 镜行首的「⋯」（收起）')
    }
    await expect(win().locator('[data-storyboard-row-menu="1"]'), '菜单收起了').toHaveCount(0, { timeout: stationTimeout() })
  }, { surfaces: ['*'] })

  // ── 底栏「时长」格：选一个新值 ──
  let picked = null
  await monitor.checkClickTarget(targetOf('sb-param-duration'), {
    observe: readPage,
    act: async () => {
      const trigger = row(2).locator(`[data-storyboard-composer-bar] [aria-label="${uiText(locale, 'storyboardEditor.row.stayHint')}"]`).first()
      await clickOrFail(trigger, '第 2 镜底栏的时长格')
      const dropdown = win().locator('[data-nomi-select-dropdown]:visible').last()
      await expect(dropdown, '时长下拉展开了').toBeVisible({ timeout: stationTimeout() })
      const options = dropdown.locator('[role="option"]')
      const labels = await options.allInnerTexts()
      const index = labels.findIndex((label) => /\d/.test(label) && Number(label.match(/\d+/)?.[0]) !== 4)
      if (index < 0) throw new Error(`时长下拉里没有 4 秒以外的选项：${labels.join(' / ')}`)
      picked = { label: labels[index].trim(), seconds: Number(labels[index].match(/\d+/)[0]) }
      await options.nth(index).click()
      // 等它落盘（自动保存有节拍）；等不到就按落盘里的真实值判，不在这里放水。
      await expect.poll(async () => (await readPage()).saved.find((entry) => entry.index === 2)?.durationSec, { timeout: stationTimeout() }).toBe(picked.seconds).catch(() => undefined)
    },
    judge: (before, after) => {
      // 胶囊上的字看截图；这里核落盘值（用户以为「存下来的也是新值」）。
      const saved = after.saved.find((entry) => entry.index === 2)?.durationSec
      const otherSaved = after.saved.filter((entry) => entry.index !== 2).map((entry) => entry.durationSec)
      const othersSame = otherSaved.every((value, offset) => value === before.saved.filter((entry) => entry.index !== 2)[offset]?.durationSec)
      const ok = Boolean(picked) && saved === picked.seconds && othersSame
      return { ok, actual: picked ? `选了「${picked.label}」，存下来的第 2 镜时长是 ${saved ?? '（没读到）'} 秒${othersSame ? '' : '；别的镜的时长也变了'}` : '下拉里没选成' }
    },
  })

  // ── 行首的小方框 ──
  await monitor.checkClickTarget(targetOf('sb-row-checkbox'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(row(3).locator('input[type="checkbox"]').first(), '第 3 镜行首的小方框')
      await win().waitForTimeout(400)
    },
    judge: (before, after) => {
      const target = rowOf(after, 3)
      const gone = vanished(before, after)
      const ok = Boolean(target?.selected) && target.visible && target.opacity === 1 && !target.skipped && gone.length === 0 && after.rows.length === before.rows.length
      return { ok, actual: `勾上之后第 3 镜${describeRow(target)}${countChange(before, after)}${gone.length ? `；这些东西不见了：${gone.slice(0, 6).join('、')}` : ''}` }
    },
  })
  // 收回「本次跳过」，免得它影响后面的生成（这一下不是被测动作）。
  await monitor.step('把第 3 镜的小方框取消勾选（复原）', async () => {
    const box = row(3).locator('input[type="checkbox"]').first()
    if (await box.isChecked().catch(() => false)) await clickOrFail(box, '第 3 镜行首的小方框（取消）')
  }, { surfaces: ['*'] })

  // ── 这一行的「生成」 ──
  await monitor.checkClickTarget(targetOf('sb-row-generate'), {
    observe: readPage,
    act: async () => {
      await monitor.consentStoryboardRows([1], { label: '第 1 镜行内「生成」' })
      await clickOrFail(row(1).locator('[data-storyboard-composer-bar] [data-storyboard-generate-state]').first(), '第 1 镜行内的「生成」', { noWaitAfter: true })
      await expect.poll(() => images().length, { message: '供应商收到第 1 镜的请求', timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThanOrEqual(1)
      await expect(row(1).locator('[data-storyboard-frame="done"]'), '第 1 镜生成完、画面格换成结果').toBeVisible({ timeout: stationTimeout({ operations: 4 }) }).catch(() => undefined)
    },
    judge: (before, after) => {
      const sent = after.providerImages - before.providerImages
      const others = othersChanged(before, after, 1)
      const dialogs = after.dialogs.length - before.dialogs.length
      const ok = sent === 1 && others.length === 0 && dialogs <= 0 && ['generating', 'done'].includes(rowOf(after, 1)?.frame)
      return { ok, actual: `供应商收到 ${sent} 次请求；第 1 镜画面格是「${rowOf(after, 1)?.frame}」${others.length ? `；第 ${others.join('、')} 镜也变了` : '；别的镜没动'}${dialogs > 0 ? '；还弹出了一个对话框' : ''}` }
    },
  })
  await monitor.settle('第 1 镜生成完')

  // ── 已生成镜头的缩略图：单击 ──
  await monitor.checkClickTarget(targetOf('sb-thumbnail-done'), {
    observe: readPage,
    act: async () => {
      const media = row(1).locator('[data-storyboard-frame="done"] [data-storyboard-frame-media]').first()
      await expect(media, '第 1 镜已经有结果缩略图').toBeVisible({ timeout: stationTimeout() })
      const box = await media.boundingBox()
      if (!box) throw new Error('量不到缩略图')
      // 点缩略图中间偏下（避开左上角的镜号、右下角的时长角标）。用 locator 点：被别的东西盖住时 Playwright 会报，不会点进别人身上。
      await media.click({ position: { x: box.width / 2, y: box.height * 0.6 } })
      await win().waitForTimeout(800)
    },
    judge: (before, after) => {
      const opened = after.dialogs.length > before.dialogs.length
      const ok = opened && after.rows.length === before.rows.length
      return { ok, actual: opened ? `打开了「${after.dialogs.at(-1)}」${countChange(before, after)}` : `单击之后什么也没打开（第 1 镜${describeRow(rowOf(after, 1))}${countChange(before, after)}）` }
    },
  })
  await win().keyboard.press('Escape').catch(() => undefined)
  await monitor.screenshot('99-final')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb12 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
