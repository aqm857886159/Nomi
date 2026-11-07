// 设计实验室 · 屏「导演视图（3D-BOX）」的取景台与夹具。
//
// 2026-10-04 用户拍板：导演视图的样张不再手写 HTML——**样张就是生产组件本身**。这一屏每一格渲染的是
// 现役 `DirectorEditor`（默认面就是 `DirectorViewShell`，精修是同一个编辑器里的另一面），
// 右侧是现役 Agent 面板（v4 实验室的 `ShellStage`：真投影 store + 真 shell）。这里**一行界面 JSX 都不写**，
// 只给三样东西：
//   · 数据：courtyard-standoff 那份 S1 oracle 计划（`evals/director/s1OraclePlans.ts`）交给现役编译器编出来的工程，
//     与评测、真机注入的是同一份——画面上的「青衣女子 / 黑衣侍卫」、镜头窗、实测景别全是 derive 出来的；
//   · 桥：导演台既有的 E2E 取证桥开关（只用来读「角色挂上没有」，不写任何东西）；
//   · 用户动作：点第 2 张镜头卡 / 点「精修」，走的是界面上那两颗真按钮，不往 store 里塞状态。
// 等待：3D 场景是异步落定的（角色 GLB、动作片段），格子在轻量外壳里登记一个就绪持有（labReadyHold），场景真落定才释放。
// 这个模块只经 director3dboxLazyStage 动态加载：导演台模块图里有模块级的人偶 GLB 预取（CharacterEntity 的
// useGLTF.preload），静态 import 会让实验室**每一屏**都去拉、去解析它，别的屏的动效截图跟着变（2026-10-04 实测
// process-feedback 三格因此稳定翻红）。
import React, { type JSX } from 'react'
import i18n from '../../../i18n'
import type { AppLocale } from '../../../i18n'
import DirectorEditor from '../../../workbench/generationCanvas/nodes/director/DirectorEditor'
import { compileDirectorPlan } from '../../../workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler'
import { applyDirectorPlanEdits, canonicalDirectorPlan, directorPlanRevision } from '../../../../electron/shared/director/planPatch'
import { parseDirectorPlan, type DirectorPlan } from '../../../../electron/shared/director/directorPlanSchema'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY, DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from '../../../workbench/generationCanvas/nodes/director/model/directorNodeMeta'
import type { DirectorPreviewFailure } from '../../../workbench/generationCanvas/nodes/director/model/directorPreviewState'
import type { DirectorPreviewStatus } from '../../../../electron/shared/director/directorPreviewStatus'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { createDirectorStore } from '../../../workbench/generationCanvas/nodes/director/model/directorStore'
import { registerDirectorSession } from '../../../workbench/generationCanvas/nodes/director/directorSessionRegistry'
import { createEditorShotFocusSession } from '../../../workbench/generationCanvas/nodes/director/directorShotFocusSession'
import { summarizeDirectorShots } from '../../../workbench/generationCanvas/nodes/director/model/directorShotSummaries'
import type { DirectorProject } from '../../../workbench/generationCanvas/nodes/director/model/directorTypes'
import type { DirectorE2EBridge } from '../../../workbench/generationCanvas/nodes/director/scene/E2EBridge'
import { assistantPaneWidth } from '../../../workbench/assistantWidthBounds'
import { S1_ORACLE_PLANS } from '../../../../evals/director/s1OraclePlans'
import { ShellStage, labAssistantItem, labHostState, labToolItem, labUserItem } from '../v4/agentPanelV4LabHost'
import { SHELL_TOPBAR_HEIGHT } from '../../../ui/app-shell/shellGeometry'
import type { Director3dBoxFixture, LabDrive, LabStep } from './director3dboxCell'
/** 右侧 Agent 面板宽：与 v4 实验室同一取值，导演视图占的画布宽因此与真机 1280 窗口一致（≈858）。 */
const AGENT_PANEL_WIDTH = 390

type ProjectFixture = Exclude<Director3dBoxFixture, 'empty'>
const PLAN_ID: Record<ProjectFixture, string> = { courtyard: 'courtyard-standoff', 'courtyard-after': 'courtyard-standoff', chase: 'police-chase' }
// 节点标题是画布节点的数据（用户起的名字），不是界面文案：多镜格用样张里那个工程名，空工程用新建导演台节点的默认名
const FIXTURE_TITLE: Record<ProjectFixture, Record<AppLocale, string>> = {
  courtyard: { 'zh-CN': '古装庭院对峙', en: 'Courtyard standoff' },
  'courtyard-after': { 'zh-CN': '古装庭院对峙', en: 'Courtyard standoff' },
  chase: { 'zh-CN': '夜街追车', en: 'Night street chase' },
}

/** 导演台节点在画布上的 id：编辑器经它登记会话，「正在改：镜头 N」读这个节点上的计划修订号与镜头名。 */
const LAB_DIRECTOR_NODE_ID = 'lab-director-3dbox'
type CourtyardFixture = { plan: DirectorPlan; project: DirectorProject }
const courtyardCache = new Map<ProjectFixture, CourtyardFixture>()
/**
 * 现役编译器把 oracle 计划编成工程；编不出来就当场抛（夹具坏了要红，不许悄悄换成空工程）。
 * courtyard-after：同一份计划经现役补丁应用器把第 2 镜改成特写，再编——与 Agent 交补丁走同一个应用器。
 */
function courtyardFixture(kind: ProjectFixture): CourtyardFixture {
  const cached = courtyardCache.get(kind)
  if (cached) return cached
  const parsed = parseDirectorPlan(S1_ORACLE_PLANS[PLAN_ID[kind]])
  if (!parsed.success) throw new Error(`director3dbox lab: ${PLAN_ID[kind]} 计划不合法`)
  let plan = canonicalDirectorPlan(parsed.data)
  if (kind === 'courtyard-after') {
    const second = plan.shots[1]?.id
    const patched = second ? applyDirectorPlanEdits(plan, [{ op: 'replace', path: `/shots/${second}/size`, value: '特写' }]) : null
    if (!patched?.ok) throw new Error('director3dbox lab: 第 2 镜补丁不成立')
    plan = patched.plan
  }
  const compiled = compileDirectorPlan(plan)
  if (!compiled.ok) throw new Error(`director3dbox lab: ${PLAN_ID[kind]} 编译失败：${compiled.errors.join('; ')}`)
  const fixture = { plan, project: compiled.project }
  courtyardCache.set(kind, fixture)
  return fixture
}

/** 画布上放一个带计划正本的导演台节点（stage_shot 建出来的节点就长这样）：编辑器经它登记会话。 */
/** 导演节点上的预演处于哪一态（「出成片」主按钮的几种样子）；none = 没出过预演。 */
export type LabPreview = DirectorPreviewStatus | Extract<DirectorPreviewFailure, 'too_long'>

function labPreviewMeta(preview: LabPreview, revision: string): Record<string, unknown> {
  if (preview === 'none') return {}
  const status = preview === 'too_long' ? 'failed' : preview
  return { [DIRECTOR_PREVIEW_META_KEY]: {
    status, revision, updatedAt: 1,
    ...(preview === 'too_long' ? { reason: 'too_long' } : preview === 'failed' ? { reason: 'capture_failed' } : {}),
    ...(preview === 'ready' ? { videoUrl: 'nomi-local://asset/lab/preview.mp4', attach: 'video_ref' } : {}),
  } }
}

function installCanvasNode(fixture: CourtyardFixture | null, preview: LabPreview = 'none'): void {
  const revision = fixture ? directorPlanRevision(fixture.plan) : ''
  const node = fixture ? ({
    id: LAB_DIRECTOR_NODE_ID, kind: DIRECTOR_NODE_KIND, title: '', position: { x: 0, y: 0 },
    meta: { [DIRECTOR_PROJECT_META_KEY]: fixture.project, [DIRECTOR_PLAN_META_KEY]: { plan: fixture.plan, revision, issueCount: 0 }, ...labPreviewMeta(preview, revision) },
  } as unknown as GenerationCanvasNode) : null
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: node ? [node] : [], edges: [], groups: [], selectedNodeIds: [] } as never)
}

// 打开导演台的测试取证桥（__nomiDirectorE2E），下面的就绪等待靠它判断 3D 场景落定。
function enableDirectorE2EBridge(): void {
  try {
    window.localStorage.setItem('__nomiE2E', '1')
  } catch {
    // 无存储：取证桥不挂，下面的就绪等待会超时并报错，不会静默截一张空场景
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function directorBridge(): DirectorE2EBridge | undefined {
  return (window as unknown as { __nomiDirectorE2E?: DirectorE2EBridge }).__nomiDirectorE2E
}

const SETTLE_MAX_FRAMES = 1800
const SETTLE_TAIL_FRAMES = 30

/** 场景落定 = 每个角色的模型挂上了、每个用到的动作片段不再「加载中」。 */
function sceneSettled(project: DirectorProject | null): boolean {
  const bridge = directorBridge()
  if (!bridge) return false
  if (!project) return true
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  for (const object of scene?.objects ?? []) {
    if (object.type !== 'character' || !object.visible) continue
    if (bridge.findAll('characterMount', object.id).length === 0) return false
    for (const clip of object.actionClips ?? []) {
      if (clip.actionPose && bridge.poseClipStatus(clip.actionPose) === 'loading') return false
    }
  }
  return true
}

async function clickWhenPresent(selector: string): Promise<void> {
  for (let frame = 0; frame < SETTLE_MAX_FRAMES; frame += 1) {
    const element = document.querySelector<HTMLButtonElement>(selector)
    if (element) {
      element.click()
      await nextFrame()
      return
    }
    await nextFrame()
  }
  throw new Error(`director3dbox lab: 等不到 ${selector}`)
}

async function clickTextWhenPresent(selector: string, text: string): Promise<void> {
  for (let frame = 0; frame < SETTLE_MAX_FRAMES; frame += 1) {
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find((item) => item.textContent?.trim() === text)
    if (element) {
      element.click()
      await nextFrame()
      return
    }
    await nextFrame()
  }
  throw new Error(`director3dbox lab: 等不到 ${selector} 里的「${text}」`)
}

async function pointerWhenPresent(selector: string, text: string): Promise<void> {
  for (let frame = 0; frame < SETTLE_MAX_FRAMES; frame += 1) {
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find((item) => item.textContent?.trim() === text)
    if (element) {
      const box = element.getBoundingClientRect()
      const init: PointerEventInit = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
      element.dispatchEvent(new PointerEvent('pointerdown', init))
      await nextFrame()
      element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }))
      window.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }))
      await nextFrame()
      return
    }
    await nextFrame()
  }
  throw new Error(`director3dbox lab: 等不到 ${selector} 里的「${text}」`)
}

async function clickWithModifier(selector: string, modifier: 'ctrl' | 'shift'): Promise<void> {
  for (let frame = 0; frame < SETTLE_MAX_FRAMES; frame += 1) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: modifier === 'ctrl', shiftKey: modifier === 'shift' }))
      await nextFrame()
      return
    }
    await nextFrame()
  }
  throw new Error(`director3dbox lab: 等不到 ${selector}`)
}

async function runStep(step: LabStep): Promise<void> {
  if ('click' in step) return clickWhenPresent(step.click)
  if ('clickWith' in step) return clickWithModifier(step.clickWith.selector, step.clickWith.modifier)
  if ('pointer' in step) return pointerWhenPresent(step.pointer.selector, step.pointer.text)
  if ('clickText' in step) return clickTextWhenPresent(step.clickText.selector, step.clickText.text)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: step.press, bubbles: true, cancelable: true }))
  await nextFrame()
}

async function waitSettled(project: DirectorProject | null): Promise<void> {
  for (let frame = 0; frame < SETTLE_MAX_FRAMES; frame += 1) {
    if (sceneSettled(project)) {
      for (let tail = 0; tail < SETTLE_TAIL_FRAMES; tail += 1) await nextFrame()
      return
    }
    await nextFrame()
  }
  throw new Error('director3dbox lab: 3D 场景没有落定（角色模型或动作片段一直没就绪）')
}

async function driveAndSettle(drive: LabDrive, steps: readonly LabStep[], project: DirectorProject | null): Promise<void> {
  if (drive !== 'none') await clickWhenPresent('[data-testid="director-shot-2"]')
  if (drive === 'shot-2-refine') await clickWhenPresent('[data-testid="director-view-header"] button[aria-pressed="false"]')
  // 场景先落定再点：选中 / 进机位视角都要角色挂上之后才有意义，点完再等一次（选中描边、机位视角会重排画面）
  if (steps.length > 0) await waitSettled(project)
  for (const step of steps) await runStep(step)
  await waitSettled(project)
}

const NO_STEPS: readonly LabStep[] = []

export type Director3dBoxStageProps = {
  locale: AppLocale
  fixture: Director3dBoxFixture
  drive?: LabDrive
  /** 精修「选中才出」格在 drive 之后要点的真按钮 */
  steps?: readonly LabStep[]
  /** Agent 面板宽：缺省 390（壳 858）；窄格给 520，把壳压到 728（真机最小窗 1100 × 默认 Agent 时的壳宽） */
  agentWidth?: number
  /** 右侧对话：空，或「Agent 改完第 2 镜」那一轮（画布 ⑤）。 */
  conversation?: 'empty' | 'after-patch'
  /** 导演节点上的预演状态（「出成片」主按钮各态）。 */
  preview?: LabPreview
  /** 可编辑：只有「出成片」各态的格子要按钮可点的样子；其余格子只读（不落盘、不登记撤销前落盘）。 */
  editable?: boolean
  release: () => void
}

/** 画布 ⑤ 那一轮对话：用户说话 → Agent 调 stage_shot → 复述被覆盖的手改（Agent 的话照 skill 1.1 的复述规则写）。 */
function afterPatchItems(): ReturnType<typeof labHostState> {
  return labHostState({ items: [
    labUserItem('u1', i18n.t('director.view.labAfterUser')),
    labToolItem('t1', 'director.write'),
    labAssistantItem('a1', i18n.t('director.view.labAfterReply')),
  ] })
}

export function Director3dBoxStage({ locale, fixture, drive = 'none', steps = NO_STEPS, agentWidth = AGENT_PANEL_WIDTH, conversation = 'empty', preview = 'none', editable = false, release }: Director3dBoxStageProps): JSX.Element {
  React.useMemo(() => {
    enableDirectorE2EBridge()
    void i18n.changeLanguage(locale)
  }, [locale])
  const courtyard = React.useMemo(() => (fixture === 'empty' ? null : courtyardFixture(fixture)), [fixture])
  const project = courtyard?.project ?? null
  React.useMemo(() => installCanvasNode(courtyard, preview), [courtyard, preview])
  React.useEffect(() => {
    let alive = true
    driveAndSettle(drive, steps, project)
      .catch((error: unknown) => {
        // 抛到页面层：视觉基线把 pageerror 当失败，不会拿一张没落定的图去比
        if (alive) window.setTimeout(() => { throw error })
      })
      .finally(release)
    return () => {
      alive = false
      release()
    }
  }, [drive, project, release, steps])
  const title = fixture !== 'empty' ? FIXTURE_TITLE[fixture][locale] : i18n.t('director.node.title')
  const noop = React.useCallback(() => undefined, [])
  return (
    <>
      {/* 产品里导演台是生成页画布那一格里的一块（根 size-full 铺满所在容器）；实验室没有生成页，这里替它摆一格：
          顶栏带之下、右边让开假 Agent 栏——与真机 1280 窗口的页格同一个矩形。 */}
      <div className="fixed inset-x-0 bottom-0" style={{ top: SHELL_TOPBAR_HEIGHT, right: assistantPaneWidth(agentWidth) }}>
        <DirectorEditor rawProject={project ?? undefined} nodeTitle={title} readOnly={!editable} nodeId={courtyard ? LAB_DIRECTOR_NODE_ID : undefined} onClose={noop} onProjectChange={noop} />
      </div>
      <div className="fixed inset-y-0 right-0 bg-nomi-bg p-4" style={{ width: assistantPaneWidth(agentWidth) }}>
        <ShellStage surface="generation" snapshot={conversation === 'after-patch' ? afterPatchItems() : labHostState({ items: [] })} width={agentWidth} height={window.innerHeight - assistantPaneWidth(0)} />
      </div>
    </>
  )
}

/**
 * 画布 ⑦「亮色」：导演台开着时整个 App 被锁暗（2026-09-09 用户拍板「这个面默认深色」），所以真实产品里看不到亮色的这枚标签。
 * 这一格只把 Agent 面板放在亮色下，导演台不挂界面、只登记同一个会话读口（真编辑器 store + 真焦点会话，点的仍是第 2 镜），
 * 用来证明标签只用 token、亮色下照样成立——取景说明里写明「产品里不可达」。
 */
export function Director3dBoxFocusTagOnlyStage({ locale, release }: { locale: AppLocale; release: () => void }): JSX.Element {
  React.useMemo(() => {
    enableDirectorE2EBridge()
    void i18n.changeLanguage(locale)
  }, [locale])
  React.useEffect(() => {
    const fixture = courtyardFixture('courtyard')
    installCanvasNode(fixture)
    const store = createDirectorStore({ rawProject: fixture.project, defaultSceneName: i18n.t('director.node.sceneDefaultName') })
    const off = registerDirectorSession(LAB_DIRECTOR_NODE_ID, { store, defaultSceneName: '', ...createEditorShotFocusSession(LAB_DIRECTOR_NODE_ID, store) })
    const second = summarizeDirectorShots(fixture.project)[1]?.cameraId
    if (second) store.getState().select({ cameraId: second, multiCameraIds: [second] })
    const frame = requestAnimationFrame(() => release())
    return () => { cancelAnimationFrame(frame); off(); release() }
  }, [release])
  return (
    <div className="fixed inset-0 flex justify-end bg-nomi-bg p-4">
      <ShellStage surface="generation" snapshot={labHostState({ items: [] })} width={AGENT_PANEL_WIDTH} height={window.innerHeight - 32} />
    </div>
  )
}
