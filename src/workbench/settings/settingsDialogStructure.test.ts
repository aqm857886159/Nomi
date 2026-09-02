import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Structural assertions inspect code, not examples of the old implementation in comments.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const readCode = (file: string): string => stripComments(fs.readFileSync(file, 'utf8'))
const settingsSource = readCode(path.join(process.cwd(), 'src/workbench/settings/SettingsDialog.tsx'))
const aiModelsSource = readCode(path.join(process.cwd(), 'src/workbench/settings/AiModelsSection.tsx'))
const taskCenterSource = readCode(path.join(process.cwd(), 'src/workbench/taskCenter/TaskCenterPanel.tsx'))
const studioSource = readCode(path.join(process.cwd(), 'src/workbench/NomiStudioApp.tsx'))
const controllerSource = readCode(path.join(process.cwd(), 'src/workbench/settings/useSettingsDialogController.ts'))
const aboutSource = readCode(path.join(process.cwd(), 'src/workbench/settings/AboutSection.tsx'))
const automationSource = readCode(path.join(process.cwd(), 'src/workbench/settings/AutomationPermissionsSection.tsx'))
const settingsDirectory = path.join(process.cwd(), 'src/workbench/settings')

// 这张表锁的是「别无意间改动了这几块」。**有意的、已拍板的改动就该更新基线**，
// 并在下面补一条正向断言说明改了什么——只挪哈希不加断言，等于把锁降级成橡皮图章。
// 2026-08-21：AiModelsSection 增加上传边界说明（KIE 视频优先、公共托管先提醒），故更新其哈希。
// 2026-08-25：同一块从「推销 KIE」改成「逐媒体类型说出当前真实通道 + 配置直达」，再次更新哈希；
//             对应正向断言见下面 reports the live upload channel per media kind 那条。
// 2026-08-26：CanvasGestureSection 仅将 import 改为共享 utils 模块；下方锁定设置与两个画布同源。
// 2026-08-31：上传通道可见性同步覆盖 Nomi relay 的 public-provider 标记，更新 AiModelsSection 基线；
//             对应正向断言仍锁定实际渲染条件，避免只挪哈希掩盖配置入口变化。
// 2026-09-01：AboutSection 增加反馈与分享入口，更新其基线；对应正向断言见 AboutSection 自身的
//             dispatch 逻辑，避免把用户已拍板的入口误报为意外漂移。
// 2026-09-01：AutomationPermissionsSection 新增「自定义 MCP 客户端」卡（任意 MCP stdio 工具接入），
//             更新其基线；对应正向断言见下方 mounts the custom MCP client card 那条。
// 2026-09-01（二）：反馈与分享改为**内嵌在设置弹窗内**（原 dispatch+关设置 会冒成独立浮层，
//             用户反馈「点开变成独立框」）。AboutSection 现在切内嵌视图并渲染 FeedbackShareContent，
//             故再次更新其基线；对应正向断言见下方 embeds feedback and sharing inside the About section。
// 2026-09-02：这一屏的供应商名与模型名此前直连 provider.name / model.labelZh，英文界面上照原样
//             显示中文（实测 34 处，连词典里已有译文的「本地 ComfyUI」「可灵 3.0」也是中文——
//             说明缺的不是词条而是这条路没过翻译边界）。三处渲染点接上 translateModelDisplayText，
//             故更新 AiModelsSection 基线；对应正向断言见下方 translates vendor and model display
//             names through the model-display boundary。
const MAIN_NON_MODEL_SECTION_SHA256 = {
  'ProjectLocationSection.tsx': 'ad37c2f07c403b60cf42385f4d93fce8e2ff494c934467c670a7ae4b8c8d5523',
  'AiModelsSection.tsx': 'f05b4e11bdeb83ef04b6b40d84e4fdfe275de41e06511163c8ee1be87b3240c8',
  'AutomationPermissionsSection.tsx': '14c5602939d38da1d899efad4d0bf8c0ec0c1559519a9fe58eb252e9018bc497',
  'CanvasGestureSection.tsx': '3cf19ee35f686e76b54497ff668bb91245b00a6593bc5d5d6162a0d30c476c95',
  'AboutSection.tsx': 'b38e0e2265f29ca56da53595e4bb5886bd14799ea3a7f7f36797b33d46eda57f',
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

  // 2026-09-01：反馈与分享从「dispatch 全局事件 + 关设置 → 冒出独立浮层」改为**内嵌在设置弹窗内**
  // （获批样张 docs/design/mockups/2026-09-01-feedback-share-center*.png 画的就是它长在设置右栏里）。
  // 旧形态为什么是 bug：用户反馈「点开变成独立框，不在设置页面里」——那正是 dispatch+onClose 的产物。
  // 现在 About 区块在 about↔feedback 之间切视图、直接渲染 FeedbackShareContent，不再关设置、不再 dispatch。
  it('embeds feedback and sharing inside the About section instead of a detached dialog', () => {
    expect(aboutSource).toContain("t('about.feedbackShare')")
    // 入口切内嵌视图，不再 dispatch 全局事件、不再关掉设置弹窗。
    expect(aboutSource).toContain("setView('feedback')")
    expect(aboutSource).toContain('<FeedbackShareContent variant="embedded"')
    expect(aboutSource).not.toContain("window.dispatchEvent(new CustomEvent('nomi-open-feedback-share'))")
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
    expect(aiModelsSource).toContain(
      "channel.visibility === 'public-anonymous' || channel.visibility === 'public-provider'",
    )
    expect(aiModelsSource).not.toContain('settings.ai.upload.kieTitle')
  })

  // 2026-09-02：这一屏两份清单（允许的供应商 / 允许的模型）显示的是 catalog 里的原始展示名，
  // 那些中文是**刻意稳定的档案键**（老项目和 catalog 行持久化了它们），所以必须在渲染点过
  // translateModelDisplayText 才能变成英文。锁住这三处，是因为「忘了过边界」不会让任何测试变红——
  // 词典再全也没用，界面照样是中文（2026-09-02 走查在这屏抓到 34 处）。
  it('translates vendor and model display names through the model-display boundary', () => {
    expect(aiModelsSource).toContain("import { translateModelDisplayText } from '../../i18n/modelDisplayText'")
    // 供应商勾选行的标题。
    expect(aiModelsSource).toContain('{translateModelDisplayText(provider.name)}')
    // 模型勾选行的「模型名 · 供应商名」，两段都要过边界。
    expect(aiModelsSource).toContain('translateModelDisplayText(model.labelZh || model.modelKey)')
    expect(aiModelsSource).toContain('const providerName = translateModelDisplayText(')
    // 不许再出现直连原始字段的裸渲染。
    expect(aiModelsSource).not.toContain('<span className="truncate">{provider.name}</span>')
  })

  it('keeps all five non-model sections byte-for-byte at the origin/main baseline', () => {
    for (const [fileName, expectedHash] of Object.entries(MAIN_NON_MODEL_SECTION_SHA256)) {
      const source = fs.readFileSync(path.join(settingsDirectory, fileName), 'utf8').replaceAll('\r\n', '\n')
      expect(createHash('sha256').update(source).digest('hex'), fileName).toBe(expectedHash)
    }
  })

  // 2026-09-01：自动化页 MCP 二级页新增「自定义 MCP 客户端」卡——把「客户端身份」从硬编码三值
  // 泛化成可注册 profile 的入口。上面的哈希锁只防无意漂移，这条正向断言锁「接入入口真的挂上去了」。
  it('mounts the custom MCP client card in the automation MCP page', () => {
    expect(automationSource).toContain('CustomMcpClientCard')
    expect(automationSource).toContain('listCustomMcpProfiles')
    expect(automationSource).toContain('onToggleTrust={toggleHost}')
  })

  it('shares one gesture preference between settings and both canvases', () => {
    const sharedModule = path.join(process.cwd(), 'src/utils/canvasGesturePreference.ts')
    const consumers = [
      'src/workbench/settings/CanvasGestureSection.tsx',
      'src/ui/onboarding/workflowPage/WorkflowGraphCanvas.tsx',
      'src/workbench/generationCanvas/components/useCanvasViewportGestures.ts',
    ]
    for (const consumer of consumers) {
      const file = path.join(process.cwd(), consumer)
      const source = readCode(file)
      const preferenceImport = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]*canvasGesturePreference)['"]/)
      expect(preferenceImport?.[1], consumer).toContain('useCanvasGestureScheme')
      expect(path.resolve(path.dirname(file), `${preferenceImport?.[2]}.ts`), consumer).toBe(sharedModule)
    }
    expect(fs.existsSync(sharedModule)).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), 'src/workbench/generationCanvas/components/canvasGesturePreference.ts'))).toBe(false)
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
