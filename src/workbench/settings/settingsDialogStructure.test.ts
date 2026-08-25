import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const settingsSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/SettingsDialog.tsx'), 'utf8')
const aiModelsSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/AiModelsSection.tsx'), 'utf8')
const taskCenterSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/taskCenter/TaskCenterPanel.tsx'), 'utf8')
const studioSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/NomiStudioApp.tsx'), 'utf8')
const controllerSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/useSettingsDialogController.ts'), 'utf8')
const settingsDirectory = path.join(process.cwd(), 'src/workbench/settings')

// 这张表锁的是「别无意间改动了这几块」。**有意的、已拍板的改动就该更新基线**，
// 并在下面补一条正向断言说明改了什么——只挪哈希不加断言，等于把锁降级成橡皮图章。
// 2026-08-21：AiModelsSection 增加上传边界说明（KIE 视频优先、公共托管先提醒），故更新其哈希。
// 2026-08-25：同一块从「推销 KIE」改成「逐媒体类型说出当前真实通道 + 配置直达」，再次更新哈希；
//             对应正向断言见下面 reports the live upload channel per media kind 那条。
// 2026-08-26：D2 将设置页的目录/上传通道读取改为异步 IPC，更新该块的有意变更基线。
const MAIN_NON_MODEL_SECTION_SHA256 = {
  'ProjectLocationSection.tsx': 'ad37c2f07c403b60cf42385f4d93fce8e2ff494c934467c670a7ae4b8c8d5523',
  'AiModelsSection.tsx': '80a5182af0cf5410f337efbfcda7fc5c7967bf503e82315c4884724786425eb9',
  'AutomationPermissionsSection.tsx': 'a446648a2ffddad01efbbcc13b77192d99046d0ca3a74f674c89375720cd134c',
  'CanvasGestureSection.tsx': '51c9806c303e5a02a09c9184a38835b4d2d8cad3cd6bb3f56a2408c96264c571',
  'AboutSection.tsx': '7fb3e4bee88cf77f6df1217424a4b6130e27581b97de3c58f3c2e7b5bf4a545b',
} as const

describe('settings dialog structure', () => {
  // 2026-08-12 由五 tab 扩到六 tab（用户拍板）。原五 tab 拍板为什么不再成立：
  // 定它那会儿「模型」= 几个 API key，塞进「AI 与模型」够用；现在多实例 ComfyUI + 自定义工作流
  // 已长成一个要整页的子系统。而原 ai tab 里的东西服务的是 MCP 代跑护栏（trustedHosts /
  // allowedProviders / maxSpend），不是「我的模型」——名不副实正是群里「改 api url 翻半天
  // 找不到」的根因，故拆出「模型」tab 并把原 tab 改名「AI 策略」。
  it('uses the approved six-tab information architecture', () => {
    for (const id of ["'file'", "'models'", "'ai'", "'automation'", "'general'", "'about'"]) {
      expect(settingsSource).toContain(`id: ${id}`)
    }
    // 模型的家 = 直接渲染既有 OnboardingDrawer，不为设置另写一份模型列表（P1 无并行实现）。
    expect(settingsSource).toContain('<OnboardingDrawer pageRequest={modelPageRequest} />')
    expect(settingsSource).toContain('<AiModelsSection')
    expect(settingsSource).toContain('<AutomationPermissionsSection')
    expect(settingsSource).toContain('sm:flex-row')
    expect(settingsSource).toContain('overflow-x-auto')
    expect(settingsSource).toContain('data-settings-tab-id={id}')
    expect(settingsSource).toContain('active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2')
    expect(settingsSource).toContain("'production-policy'")
    expect(aiModelsSource).toContain('data-settings-field="hard-budget"')
  })

  it('keeps notification policy in settings instead of duplicating it in task center', () => {
    expect(taskCenterSource).not.toContain('PrefToggle')
    expect(taskCenterSource).not.toContain('writeTaskCenterPrefs')
    expect(settingsSource).toContain('automationPolicy')
  })

  it('keeps model management in one settings host', () => {
    expect(studioSource).not.toContain('OnboardingFloatingPanel')
    expect(studioSource).not.toContain('modelCatalogOpened')
    expect(controllerSource).toContain("window.addEventListener('nomi-open-model-catalog'")
    expect(controllerSource).toContain("openSettings({ tab: 'models' })")
    // 2026-08-25：从「只切到模型 tab」升级成「可带 vendorKey 直达那家的 Key 输入页」。
    // 原样式为什么不再成立：用户点设置里的「去配置 KIE」后被丢在模型列表页，Kie.ai 那行当时
    // 连「上传」二字都不提，于是得出「Nomi 没配置 KIE 上传」——入口断在这里。
    expect(settingsSource).toContain('onOpenModelCatalog={(vendorKey) => {')
    expect(settingsSource).toContain("selectTab('models')")
    expect(settingsSource).toContain('setModelPageRequest((current) => ({ vendorKey, token: (current?.token ?? 0) + 1 }))')
  })

  it('keeps the origin/main frame and sidebar for every settings tab', () => {
    expect(settingsSource).toContain('data-settings-dialog')
    expect(settingsSource).toContain('data-settings-tab={tab}')
    expect(settingsSource).toContain('className="fixed inset-0 flex items-center justify-center bg-black/45 p-2 sm:p-6"')
    expect(settingsSource).toContain('max-w-[760px]')
    expect(settingsSource).toContain('sm:h-[min(560px,calc(100svh-48px))]')
    expect(settingsSource).toContain('sm:w-[196px]')
    expect(settingsSource).not.toContain('sm:max-w-[900px]')
    expect(settingsSource).not.toContain('sm:h-[min(540px')
    expect(settingsSource).not.toContain('sm:w-[184px]')
  })

  it('keeps main padding and single-column content outside the unpadded model workspace', () => {
    expect(settingsSource).toContain('data-settings-content')
    expect(settingsSource).toContain('data-settings-model-workspace')
    expect(settingsSource).toContain("tab === 'models' ? 'overflow-hidden p-0' : 'overflow-y-auto p-4 sm:p-6'")
    expect(settingsSource).toContain('flex h-full min-h-0 flex-col overflow-hidden')
    expect(settingsSource).not.toContain('data-settings-page-grid')
    expect(settingsSource).not.toContain('SETTINGS_TWO_COLUMN_GRID_CLASS')
    expect(settingsSource).not.toContain('min-[972px]')
    expect(fs.existsSync(path.join(settingsDirectory, 'settingsLayout.tsx'))).toBe(false)
  })

  // 「新建卡片默认模型」必须挂在 AI 策略页顶部，且与下方的「默认模型策略」（权限）分得开——
  // 同屏两个「默认模型」是用户拍板时明确点出的混淆点。
  it('mounts the new-card default model picker above the permission policy block', () => {
    expect(aiModelsSource).toContain('<DefaultGenerationModelsSection')
    expect(aiModelsSource.indexOf('<DefaultGenerationModelsSection'))
      .toBeLessThan(aiModelsSource.indexOf("data-settings-section=\"production-policy\""))
  })

  // 2026-08-25 用户拍板：这块从「推销 KIE」改成「说出现在实际走哪条通道」。
  // 旧形态（标题「视频参考上传：推荐 KIE（免费）」）为什么不再成立：它只是一句推荐，
  // 用户看完仍答不出「我配了没有 / 我的素材现在往哪传」——本次改动的起因就是用户据此
  // 误判成「Nomi 根本没接 KIE 上传」，而代码里早接好了，缺的只是他的 key 和这块可见性。
  it('reports the live upload channel per media kind instead of just recommending KIE', () => {
    expect(aiModelsSource).toContain('data-settings-upload-guidance')
    expect(aiModelsSource).toContain('data-upload-channel={channel.kind}')
    expect(aiModelsSource).toContain("settings.ai.upload.channel.title")
    expect(aiModelsSource).toContain("settings.ai.upload.channel.configure")
    expect(aiModelsSource).toContain("settings.ai.upload.anonymousPrompt")
    // 现状必须来自 main 的真解析器；渲染层一旦自己排优先级，这张卡迟早开始说谎。
    expect(aiModelsSource).toContain('assetTransport?.describeChannels()')
    // 「已接入」按它是否真的在收文件判，不按 key 存不存在判——否则徽章和下面的通道行会互相打架。
    expect(aiModelsSource).toContain("channels.some((channel) => channel.vendorKey === 'kie')")
    // 公开可访问的通道必须走警示样式，不能和私有链接长一样。
    expect(aiModelsSource).toContain("channel.visibility === 'public-anonymous'")
    expect(aiModelsSource).not.toContain('settings.ai.upload.kieTitle')
  })

  it('keeps all five non-model sections byte-for-byte at the origin/main baseline', () => {
    for (const [fileName, expectedHash] of Object.entries(MAIN_NON_MODEL_SECTION_SHA256)) {
      const source = fs.readFileSync(path.join(settingsDirectory, fileName))
      expect(createHash('sha256').update(source).digest('hex'), fileName).toBe(expectedHash)
    }
  })

  it('lets model subpages own their header without colliding with the dialog close action', () => {
    expect(settingsSource).not.toContain("{t('settings.tab.models')}</h2>")
    expect(settingsSource).toContain('data-settings-close')
    expect(settingsSource).toContain('[&_[data-model-settings-page]>header]:pr-14')
    expect(settingsSource).toContain('[&>div:not([data-model-settings-page])>:first-child]:pr-14')
  })

  it('keeps the lazy model workspace mounted after its first visit', () => {
    expect(settingsSource).toContain('modelsMounted')
    expect(settingsSource).toContain("if (nextTab === 'models') setModelsMounted(true)")
    expect(settingsSource).toContain("hidden={tab !== 'models'}")
    expect(settingsSource).toContain("style={{ display: tab !== 'models' ? 'none' : undefined }}")
    expect(settingsSource).toContain('<React.Suspense')
    expect(settingsSource).toContain('<OnboardingDrawer pageRequest={modelPageRequest} />')
  })
})
