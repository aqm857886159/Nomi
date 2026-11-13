import { expectAbsent, proveProbe } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'catalog-liveness', title: '模型目录活性', role: 'walk-catalog-liveness', cellWidth: 960, columns: 2,
  viewport: { width: 960, height: 760 },
  assertState: async (page, state, record) => {
    const note = page.getByText(uiText('zh-CN', 'onboardingProviders.modelControls.unlisted'), { exact: true })
    const more = page.getByRole('button', { name: uiText('zh-CN', 'onboardingProviders.modelControls.more'), exact: true })
    const remove = page.getByRole('button', { name: uiText('zh-CN', 'common.delete'), exact: true })
    const missing = page.getByRole('button', { name: 'DeepSeek V4 Flash', exact: true })
    const legacy = page.getByRole('button', { name: 'DeepSeek V3.1 Terminus', exact: true })
    if (await note.count() !== 1) record(`${state.id}: expected one unlisted note`)
    if (await more.count() !== 1) record(`${state.id}: legacy fold missing`)
    if (await remove.count() !== 1) record(`${state.id}: one-click deletion missing`)
    await missing.click()
    const toggle = page.getByRole('switch')
    const toggleLabel = page.locator(`label[for="${await toggle.getAttribute('id')}"]`)
    if (!await toggle.isChecked()) record(`${state.id}: missing from the list changed the user's enabled setting`)
    await toggleLabel.click()
    if (await toggle.isChecked()) record(`${state.id}: manual disable failed`)
    await toggleLabel.click()
    if (!await toggle.isChecked()) record(`${state.id}: manual enable failed`)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await more.click()
    if (await legacy.count() !== 1) record(`${state.id}: more did not reveal the legacy row`)
    const rowProof = await proveProbe(missing, '未列出型号存在')
    const noteProof = await proveProbe(note, '该型号带有未列出旁注')
    await remove.click()
    await expectAbsent(missing, { provenBy: rowProof, message: '删除移除型号行' })
    await expectAbsent(note, { provenBy: noteProof, message: '删除移除这行的旁注' })
  },
})
