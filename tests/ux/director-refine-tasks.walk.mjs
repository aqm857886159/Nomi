// 精修「选中才出」三条真实任务（设计卡 docs/plan/2026-10-04-director-refine-select-to-show.md ★1）——浏览器 devlab 的无头部分。
//
// 工程 = S1 oracle 计划 courtyard-standoff 经**现役编译器**编出的庭院对峙（与设计实验室、评测同一份），
// 编译在页面里做（Vite 直接服务 TS 模块），写进 devlab 的工程存档再重载——之后每一步都是真鼠标点真按钮，结果从工程存档读回来核对。
//   T1 把黑衣侍卫朝青衣女子挪近 1 米并转身面对她（原题「往门口挪」：这份工程里侍卫开场就站在院门口，见 T1 注释）
//   T2 把镜头 2 的机位（medium）改成 50mm 并进机位视角看构图
//   T3 把青衣女子的走路动作推迟 1 秒，再加一盏灯
// 每条任务数用户点了几下（拖动 / 输入另计），和设计卡里写的点击路径对账。
// 真 App（Electron + 真 Agent 面板）那一遍不在这里：pending-real-app，等用户不用电脑时由协调会话安排。
//
// 用法：node tests/ux/director-refine-tasks.walk.mjs；截图在 tests/ux/shots/director/refine-tasks/，必须人眼 Read 过。
import { addTrack, clickOrFail, expectVisible, launchDirectorLab, openAddMenu } from './_directorLab.mjs'

const lab = await launchDirectorLab({ name: 'refine-tasks', viewport: { width: 1280, height: 900 } })
const { page, check } = lab
const clicks = { T1: 0, T2: 0, T3: 0 }

/** 点一下并记账：任务里的每一次用户点击都走这里。 */
async function click(task, locator, label, options) {
  clicks[task] += 1
  await clickOrFail(locator, label, options)
}

/** 检查器里某个字段（标签文字 → 同一行的数字框）填值并回车。 */
async function fillField(label, value, nth = 0) {
  const field = page.getByTestId('director-inspector').getByText(label, { exact: true }).nth(nth).locator('..').locator('input[type="text"]').first()
  await field.fill(String(value))
  await field.press('Enter')
}

async function pickRow(task, name) {
  clicks[task] += 2 // 开「▤ ▾」+ 点行（收起浮层是为了不挡后面的点击，用户也可以直接点视口）
  await lab.pickInOutliner(name, `大纲·${name}`)
}

try {
  // ── 种工程：现役编译器编庭院对峙，写进 devlab 存档再重载 ──
  const seeded = await page.evaluate(async () => {
    const { compileDirectorPlan } = await import('/src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts')
    const { S1_ORACLE_PLANS } = await import('/evals/director/s1OraclePlans.ts')
    const compiled = compileDirectorPlan(S1_ORACLE_PLANS['courtyard-standoff'])
    if (!compiled.ok) return { ok: false, errors: compiled.errors }
    window.localStorage.setItem('nomi:director-lab:project', JSON.stringify(compiled.project))
    return { ok: true }
  })
  check('庭院对峙经现役编译器编出', seeded.ok, JSON.stringify(seeded))
  await page.reload({ waitUntil: 'commit' })
  await expectVisible(page.getByTestId('director-pip'), '重载后导演台没起来')
  await page.waitForFunction(() => Boolean(window.__nomiDirectorE2E), null)
  await expectVisible(page.getByTestId('director-topbar'), '精修顶栏没出来')
  check('空闲时右边没有属性卡', (await page.getByTestId('director-context-card').count()) === 0)
  await lab.snap('idle')

  const scene0 = await lab.scene()
  const byName = (scene, name) => scene.objects.find((object) => object.name === name)
  const guard0 = byName(scene0, '黑衣侍卫')
  const woman0 = byName(scene0, '青衣女子')
  const gate = byName(scene0, 'gate')
  check('夹具里有侍卫 / 女子 / 院门', Boolean(guard0 && woman0 && gate))

  // ── T1：侍卫朝女子挪近 1 米，转身面对她 ──
  await pickRow('T1', '黑衣侍卫')
  await expectVisible(page.getByTestId('director-context-card'), '选中侍卫后属性卡没出来')
  check('T1·属性卡标题是侍卫', (await page.getByTestId('director-context-card').innerText()).includes('黑衣侍卫'))
  // 侍卫在这一刻由轨迹驱动，检查器写着「只读（先插关键帧）」：先加关键帧
  const readOnly = (await page.getByTestId('director-inspector').getByText('只读（先插关键帧）').count()) > 0
  if (readOnly) await click('T1', page.getByTestId('director-timeline-header').getByRole('button', { name: /加关键帧/ }), '时间轴头·加关键帧')
  // 侍卫是轨迹驱动的：看「此刻在哪」要读检查器里的数（用户看到的）和 3D 包围盒（画面上的），不读工程里的基准位姿
  const center = async (id) => {
    const box = await lab.bridge('boundsByEntity', id)
    return box ? { x: (box.min[0] + box.max[0]) / 2, z: (box.min[2] + box.max[2]) / 2 } : null
  }
  const fieldValue = async (label) => Number(await page.getByTestId('director-inspector').getByText(label, { exact: true }).first().locator('..').locator('input[type="text"]').first().inputValue())
  const before = { x: await fieldValue('X'), z: await fieldValue('Z') }
  const before3d = await center(guard0.id)
  const womanAt = await center(woman0.id)
  // 庭院对峙里侍卫一开场就站在院门口（院门 (0, -7.7)），「往门口挪」在这份工程上无从谈起：改成朝女子走近 1 米再转身面对她
  const dx = womanAt.x - before.x, dz = womanAt.z - before.z
  const len = Math.hypot(dx, dz) || 1
  const target = { x: before.x + dx / len, z: before.z + dz / len }
  await fillField('X', target.x.toFixed(2))
  await fillField('Z', target.z.toFixed(2))
  const yaw = (Math.atan2(womanAt.x - target.x, womanAt.z - target.z) * 180) / Math.PI
  await fillField('水平', yaw.toFixed(1))
  await page.waitForTimeout(300)
  const after = { x: await fieldValue('X'), z: await fieldValue('Z'), yaw: await fieldValue('水平') }
  const after3d = await center(guard0.id)
  check('T1·检查器里位置朝女子挪了 1 米', Math.abs(Math.hypot(after.x - before.x, after.z - before.z) - 1) < 0.05, `(${before.x},${before.z}) → (${after.x},${after.z})`)
  check('T1·画面里侍卫也挪了约 1 米', Boolean(before3d && after3d) && Math.abs(Math.hypot(after3d.x - before3d.x, after3d.z - before3d.z) - 1) < 0.25, JSON.stringify({ before3d, after3d }))
  check('T1·侍卫转向女子', Math.abs(((after.yaw - yaw + 540) % 360) - 180) < 1, `水平 ${after.yaw} vs ${yaw.toFixed(1)}`)
  const guard1 = { position: { x: after3d?.x ?? target.x, z: after3d?.z ?? target.z } }
  check('T1·主体没被属性卡盖住', await (async () => {
    const point = await lab.bridge('projectPoint', guard1.position.x, 1, guard1.position.z)
    const card = await page.getByTestId('director-context-card').locator('> div').boundingBox()
    return Boolean(point && card) && point.x < card.x
  })())
  await lab.snap('t1-guard-moved')
  await click('T1', page.getByTestId('director-inspector-close'), '属性卡·×')
  check('T1·× 收卡', (await page.getByTestId('director-context-card').count()) === 0)

  // ── T2：medium 机位改 50mm，进机位视角 ──
  await pickRow('T2', 'medium')
  await click('T2', page.getByTestId('director-inspector').getByRole('option', { name: /^50mm/ }), '属性卡·50mm')
  // 选中机位 = 小窗自动切到它（store.select 写 previewCameraId）：不再需要小窗下拉那 2 下
  const pip = page.getByTestId('director-pip')
  check('T2·选中 medium 后小窗自动切到 medium', (await pip.getByLabel('预览机位').innerText()).includes('medium'))
  await click('T2', pip.getByRole('button', { name: '进入视角' }), '小窗·进入视角')
  await expectVisible(page.getByTestId('director-pov-hud'), '没进入机位视角')
  check('T2·进的是 medium 的视角', (await page.getByTestId('director-pov-hud').innerText()).includes('medium'))
  const camera = (await lab.scene()).cameras.find((item) => item.name === 'medium')
  check('T2·medium 是 50mm', Math.round(camera.focalLengthMm) === 50, `${camera.focalLengthMm}mm`)
  check('T2·小窗在左下（和导演视图同位）', await (async () => {
    const pip = await page.getByTestId('director-pip').boundingBox()
    const viewport = await page.getByTestId('director-viewport').boundingBox()
    return Boolean(pip && viewport) && viewport.y + viewport.height - (pip.y + pip.height) < 20 && pip.x - viewport.x < 20
  })())
  await lab.snap('t2-camera-pov-card-open')
  // 取景框右侧被属性卡盖住（K5 未做，单独排期）：收卡看全框
  await click('T2', page.getByTestId('director-inspector-close'), '属性卡·×（看全取景框）')
  check('T2·点击数 5（原 7）', clicks.T2 === 5, `${clicks.T2}`)
  await lab.snap('t2-camera-pov-full-frame')
  await clickOrFail(page.getByTestId('director-pov-hud').getByRole('button', { name: '退出机位' }), 'POV 卡·退出（收尾，不计入任务）')

  // ── T3：女子走路推迟 1 秒，再加一盏灯 ──
  clicks.T3 += 2 // 「＋ 添加轨道」+ 选女子（AI 工程没有轨道，S1 线修好后这两下省掉）
  await addTrack(lab, '青衣女子')
  const woman = (await lab.scene()).objects.find((object) => object.id === woman0.id)
  const walk = (woman.actionClips || []).find((clip) => /walk/.test(String(clip.actionPose)))
  check('T3·女子有走路片段', Boolean(walk), JSON.stringify((woman.actionClips || []).map((clip) => clip.actionPose)))
  if (walk) {
    await click('T3', page.getByTestId('director-timeline-lanes').locator(`[data-clip-id="${walk.id}"]`), '时间轴·走路片段')
    await expectVisible(page.getByTestId('director-context-card'), '按下片段后属性卡没出来')
    clicks.T3 += 1 // 点「开始」框
    await fillField('开始', (walk.startTime + 1).toFixed(1))
    await lab.waitScene(`(s.objects.find(o => o.id === '${woman0.id}').actionClips || []).some(c => c.id === '${walk.id}' && Math.abs(c.startTime - ${(walk.startTime + 1).toFixed(2)}) < 0.05)`, 'T3·走路推迟 1 秒')
    check('T3·走路片段开始推迟 1 秒', true)
  }
  const lightsBefore = (await lab.scene()).lights.length
  clicks.T3 += 3
  await openAddMenu({ page }, '灯光')
  await clickOrFail(page.getByRole('button', { name: '点光（全向光）' }), '灯光·点光')
  await lab.waitScene(`s.lights.length === ${lightsBefore + 1}`, 'T3·加了一盏灯')
  check('T3·加了一盏点光', true)
  await lab.snap('t3-walk-delayed-light-added')

  console.log(`  · 点击数：T1 ${clicks.T1} · T2 ${clicks.T2} · T3 ${clicks.T3}（拖动 / 输入另计）`)
  console.log('  · 真 App（Electron + 真 Agent 面板）那一遍：pending-real-app')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
