// 旧工程（2026-10-07 前存的 x-bot 人偶）打开即迁成 UAL —— 施工计划 docs/plan/2026-10-07-director-ual-mannequin.md §9 真实任务 ②。
// 真实任务：把仓库 fixture（走路 / 坐姿 + 手调骨骼 + 姿态关键帧 / 跪与坐地 / 上传的 Mixamo 角色）当成已存工程打开
//           （上传角色那条在浏览器实验室里取不到模型，走查里去掉，「不碰」由 characterRigMigration.test 验）
//           → 看到迁移提示、人都在原位并带着对应动作 → 只看一眼就退出：存档一个字不变
//           → 重新打开、改一笔（挪走路的人）→ 自动保存落成版本 3 / rig ual / UAL 骨名 → 刷新重开：不再提示、姿势一样。
// 用法：node tests/ux/director-ual-migration.walk.mjs（先开着 `vite --port 5175` 走热路径）
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, expectVisible, launchDirectorLab, repoRoot } from './_directorLab.mjs'

const FIXTURE = path.join(repoRoot, 'src/workbench/generationCanvas/nodes/director/model/__fixtures__/legacy-xbot-project.v2.json')
const KEY = 'nomi:director-lab:project'
// 上传角色那一条（nomi-asset:// 在浏览器实验室里取不到，会报页面错误）只留在单测里验「不碰」，走查里去掉
const fixtureProject = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
fixtureProject.scenes[0].objects = fixtureProject.scenes[0].objects.filter((object) => object.id !== 'uploaded')
const fixtureText = JSON.stringify(fixtureProject)

const lab = await launchDirectorLab({ name: 'ual-migration', viewport: { width: 1600, height: 900 } })
const { page, check } = lab
const stored = () => page.evaluate((key) => window.localStorage.getItem(key), KEY)
const reopen = async () => {
  await expectVisible(page.getByTestId('director-pip'), '导演台没起来')
  await page.waitForFunction(() => Boolean(window.__nomiDirectorE2E))
}
const waitCharacters = (ids) => page.waitForFunction((list) => list.every((id) => window.__nomiDirectorE2E?.orientationByName('DEF-head', id)), ids)
const headOf = (id) => lab.bridge('orientationByName', 'DEF-head', id)
try {
  await page.evaluate(([key, text]) => window.localStorage.setItem(key, text), [KEY, fixtureText])
  await page.reload({ waitUntil: 'commit' })
  await reopen()
  await expectVisible(page.getByText('人偶已换成新的默认人偶', { exact: false }).first(), '打开旧工程没有迁移提示')
  const toastText = await page.getByText('人偶已换成新的默认人偶', { exact: false }).first().innerText()
  check('迁移提示说清近似动作与丢弃的细节姿势数', toastText.includes('4 处') && toastText.includes('3 处'), toastText)
  await waitCharacters(['walker', 'sitter', 'kneeler'])
  await page.waitForTimeout(1500)
  await lab.snap('migrated-open')
  const sitterHead = await headOf('sitter')
  const walkerHead = await headOf('walker')
  check('坐着的人坐着（头比站着的走路人低 25cm 以上）', walkerHead.position[1] - sitterHead.position[1] > 0.25, `${walkerHead.position[1].toFixed(3)} vs ${sitterHead.position[1].toFixed(3)}`)
  check('人在原位（走路人 x≈-1、坐着的人 x≈1）', Math.abs(walkerHead.position[0] + 1) < 0.3 && Math.abs(sitterHead.position[0] - 1) < 0.3, `walker x=${walkerHead.position[0].toFixed(2)} sitter x=${sitterHead.position[0].toFixed(2)}`)
  await page.waitForTimeout(2500)
  check('只打开不改：2.5s 后存档仍是原文（自动保存没写）', (await stored()) === fixtureText)

  // 退出（顶栏 ← → 退出确认）：没改过就不写回
  await clickOrFail(page.getByRole('button', { name: '退出导演台' }).first(), '顶栏·退出导演台')
  await clickOrFail(page.getByRole('button', { name: '退出', exact: true }), '退出确认·退出')
  await expectVisible(page.getByRole('button', { name: 'reopen director' }), '退出后没回到实验室首页')
  check('只看一眼就退出：存档仍是原文', (await stored()) === fixtureText)

  // 重开 → 改一笔：大纲选走路的人，检查器 X 改成 -1.5
  await page.reload({ waitUntil: 'commit' })
  await reopen()
  await waitCharacters(['walker', 'sitter', 'kneeler'])
  await lab.pickInOutliner('走路的人', '大纲·走路的人')
  const x = page.getByTestId('director-inspector').getByText('X', { exact: true }).locator('..').locator('input[type="text"]').first()
  await x.fill('-1.5')
  await x.press('Enter')
  await lab.waitScene("s.objects.find(o => o.id === 'walker').position.x === -1.5", '改动自动保存')
  const saved = JSON.parse(await stored())
  const savedObjects = Object.fromEntries(saved.scenes[0].objects.map((object) => [object.id, object]))
  check('改一笔后落盘：版本 3、内置人偶 rig = ual', saved.version === 3 && ['walker', 'sitter', 'kneeler'].every((id) => savedObjects[id].rig === 'ual'), `v${saved.version}`)
  check('落盘的手调骨骼是 UAL 骨名、值原样', JSON.stringify(savedObjects.sitter.boneRotations) === JSON.stringify({ 'DEF-upper_armL': { x: 30, y: -12.5, z: 4 }, 'DEF-forearmR': { x: 0, y: 45, z: 0 }, 'DEF-head': { x: -10, y: 20, z: 0 } }), JSON.stringify(savedObjects.sitter.boneRotations))
  await lab.snap('after-edit')

  // 刷新重开：不再提示、坐着的人姿势与迁移当场一样
  await page.reload({ waitUntil: 'commit' })
  await reopen()
  await waitCharacters(['walker', 'sitter', 'kneeler'])
  await page.waitForTimeout(1500)
  check('已迁移工程重开不再提示', (await page.getByText('人偶已换成新的默认人偶', { exact: false }).count()) === 0)
  const sitterAgain = await headOf('sitter')
  const drift = Math.hypot(...sitterAgain.position.map((value, index) => value - sitterHead.position[index]))
  check('重开后坐着的人头位置与迁移当场一致（< 1cm）', drift < 0.01, `${(drift * 100).toFixed(2)}cm`)
  await lab.snap('reopened')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
  await lab.snap('journey-failed')
} finally {
  await lab.finish()
}
