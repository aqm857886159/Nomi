import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

await walkDesignLabScreen({
  screen: 'catalog-liveness', title: '模型目录活性', role: 'walk-catalog-liveness', cellWidth: 960, columns: 2,
  outDir: process.env.NOMI_WALK_OUT ?? makeTempDir('design-lab-catalog-liveness'),
  viewport: { width: 960, height: 760 },
  assertState: async (page, state, record) => {
    const note = page.getByText(uiText('zh-CN', 'onboardingProviders.modelControls.unlisted'), { exact: true })
    const more = page.getByRole('button', { name: uiText('zh-CN', 'onboardingProviders.modelControls.more'), exact: true })
    const remove = page.getByRole('button', { name: uiText('zh-CN', 'common.delete'), exact: true })
    const missing = page.getByRole('button', { name: 'DeepSeek V4 Flash', exact: true })
    const listed = page.getByRole('button', { name: 'DeepSeek V4 Pro', exact: true })
    if (!(await expect(note).toHaveCount(1).then(() => true, () => false))) record(`${state.id}: expected one unlisted note`)
    // This sample contains current models only. The fold is reserved for explicit legacy rows.
    await expect(listed).toBeVisible()
    await expectAbsent(more, { provenBy: await proveProbe(listed, '当前目录型号已渲染') })
    if (!(await expect(remove).toHaveCount(1).then(() => true, () => false))) record(`${state.id}: one-click deletion missing`)
    await missing.click()
    const toggle = page.getByRole('switch')
    const toggleLabel = page.locator(`label[for="${await toggle.getAttribute('id')}"]`)
    if (!await toggle.isChecked()) record(`${state.id}: missing from the list changed the user's enabled setting`)
    await toggleLabel.click()
    if (await toggle.isChecked()) record(`${state.id}: manual disable failed`)
    await toggleLabel.click()
    if (!await toggle.isChecked()) record(`${state.id}: manual enable failed`)
    await page.locator('[data-model-settings-back]').click()
    const rowProof = await proveProbe(missing, '未列出型号存在')
    const noteProof = await proveProbe(note, '该型号带有未列出旁注')
    await remove.click()
    await expectAbsent(missing, { provenBy: rowProof, message: '删除移除型号行' })
    await expectAbsent(note, { provenBy: noteProof, message: '删除移除这行的旁注' })
    await expect(listed).toBeVisible()
  },
})
