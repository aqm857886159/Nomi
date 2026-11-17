/**
 * 「一个已经做完的项目」夹具：创作区有文稿、生成画布有成片节点、预览时间轴有排好的 clip。
 * 零模型、零额度、零网络——图片复用仓库已有的细节测试 PNG，预览和导出都能解码；不作为真实素材或性能验收。
 *
 * 为什么需要它（2026-08-18）：`dark-journey.walk.mjs` 号称走 J1-J5，实际跑在一个**空**的
 * 隔离 profile 上——库里一个项目都没有。于是「打开示例项目」那一步的两个候选定位器都是 0，
 * 整步静默跳过（旧 clickText 拿 `count() > 0` 当成功、又用 `.catch(() => {})` 吞掉真实失败），
 * 脚本照常往下截图：J1/J2/J3 三张 PNG **字节完全相同**，全是那张空库页，而它报绿。
 *
 * 治本不是「把定位器修对」——空库里本来就没有项目可点，修一百遍定位器也点不出来。
 * 真正缺的前提条件是**先有一个项目**，且它在三个工作区里都得有内容，
 * 否则每一段的截图仍然只是空态，走查等于没走。
 *
 * 落盘格式的两个要点（照 electron 侧实现，别凭记忆改）：
 *   · 项目靠 `<projectsDir>/<文件夹>/.nomi/project.json` 被发现——
 *     `electron/workspace/legacyProjectMigration.ts:114` 的 discoverLegacyProjects 扫默认根，
 *     认的是「有没有 workspace manifest」，文件夹名本身不参与识别。
 *   · hydrate **只读 `payload`**，顶层的 workbenchDocument/timeline/generationCanvas 是影子，
 *     不参与恢复——`src/workbench/project/workbenchProjectSession.ts:25`
 *     restoreWorkbenchProjectPayload 三行全部读的 payload.*。写错地方会得到一个空项目。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 时间轴帧率与「一张图占多久」。与 buildClipFromGenerationNode 的默认一致（图 3 秒）。 */
const FPS = 30
const IMAGE_FRAMES = 90

/**
 * 6 个镜头，内容取自引导示例片「修好一个小机器人」（`src/workbench/onboarding/demoProject.ts`）。
 * 六个独立镜头保留文稿、节点和时间轴对应关系；图片内容是已存在的解码测试图案，不冒充故事成片。
 */
const SHOTS = [
  { id: 'shot-1', title: '① 黄昏小巷', prompt: '黄昏小巷远景，坏掉的小机器人歪在墙角，零件散落，暖光斜照。' },
  { id: 'shot-2', title: '② 蹲下相遇', prompt: '小孩蹲下，好奇地看着墙角的小机器人，中景。' },
  { id: 'shot-3', title: '③ 抱回家', prompt: '小孩抱起小机器人走回家，背影跟镜。' },
  { id: 'shot-4', title: '④ 台灯下修理', prompt: '台灯下，小孩用螺丝刀专注地修理，手部特写。' },
  { id: 'shot-5', title: '⑤ 灯亮了', prompt: '小机器人胸口的暖黄小灯「叮」地亮起，眼睛点亮，特写。' },
  { id: 'shot-6', title: '⑥ 屋顶夕阳', prompt: '屋顶上两个并排坐着，背对镜头看远方，中景。' },
]

/** 创作区文稿正文（同一个故事的散文版，让 J2 那屏有真字可读、可截图对账）。 */
const STORY_PARAGRAPHS = [
  '黄昏的小巷，一个坏掉的小机器人歪在墙角，零件散落一地。',
  '放学路过的小孩蹲下来，好奇地看着它。',
  '他把小机器人抱回家，在台灯下一颗螺丝一颗螺丝地修。',
  '当最后一颗螺丝拧紧，小机器人的眼睛「叮」地亮了起来。',
  '两个人爬上屋顶，并排坐着，看夕阳一点点沉下去。',
]

function buildDocument(title, updatedAt) {
  return {
    version: 1,
    title,
    contentJson: {
      type: 'doc',
      content: STORY_PARAGRAPHS.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    },
    updatedAt,
  }
}

/**
 * 时间轴由画布节点**推导**出来，不另抄一份镜头清单：
 * 两份手写清单迟早会对不上，而对不上的那一刻测试只会安静地少验一段。
 */
function buildTimeline(nodes) {
  let cursor = 0
  const clips = nodes.map((node) => {
    const startFrame = cursor
    cursor += IMAGE_FRAMES
    return {
      id: `clip-${node.id}`,
      type: 'image',
      sourceNodeId: node.id,
      label: node.title,
      startFrame,
      endFrame: startFrame + IMAGE_FRAMES,
      frameCount: IMAGE_FRAMES,
      offsetStartFrame: 0,
      offsetEndFrame: 0,
      url: node.result.url,
    }
  })
  return {
    version: 1,
    fps: FPS,
    scale: 1,
    playheadFrame: 0,
    // 三轨定义与 TIMELINE_TRACK_DEFINITIONS 对齐（imageTrack / videoTrack / audioTrack）。
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips },
      { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
      { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
    ],
    textClips: [],
  }
}

/**
 * 往 projectsDir 里种一个「做完的项目」。
 *
 * @param {object} options
 * @param {string} options.projectsDir  隔离的项目根（launchNomiApp 的 projectsDir）
 * @param {string} [options.projectId]
 * @param {string} [options.projectName]
 * @returns {{projectId: string, projectName: string, projectRoot: string,
 *   shotCount: number, clipCount: number, storyParagraphs: string[], firstParagraph: string}}
 */
export function seedFinishedJourneyProject({ projectsDir, projectId = 'dark-journey-walk', projectName = '走查示例：修好一个小机器人' } = {}) {
  if (!projectsDir) throw new Error('seedFinishedJourneyProject 需要 projectsDir（必须落在隔离目录，别写用户真实项目库）')

  const projectRoot = path.join(path.resolve(projectsDir), projectId)
  const generatedDir = path.join(projectRoot, 'assets', 'generated')
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'exports'), { recursive: true })

  const now = Date.now()
  const nodes = SHOTS.map((shot, index) => {
    const fileName = `${shot.id}.png`
    fs.copyFileSync(new URL('./hires-detail-1024x1792.png', import.meta.url), path.join(generatedDir, fileName))
    return {
      id: shot.id,
      kind: 'image',
      categoryId: 'shots',
      title: shot.title,
      prompt: shot.prompt,
      position: { x: 120 + (index % 3) * 460, y: 120 + Math.floor(index / 3) * 320 },
      exactPosition: true,
      size: { width: 420, height: 260 },
      status: 'success',
      result: {
        id: `${shot.id}-result`,
        type: 'image',
        url: `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/${fileName}`,
        createdAt: now,
      },
      meta: { imageWidth: 1024, imageHeight: 1792 },
    }
  })

  const generationCanvas = { nodes, edges: [], selectedNodeIds: [], groups: [] }
  const timeline = buildTimeline(nodes)
  const workbenchDocument = buildDocument(projectName, now)
  const payload = {
    workbenchDocument,
    timeline,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const record = {
    id: projectId,
    name: projectName,
    version: 2,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 1,
    lastKnownRootPath: projectRoot,
    payload,
  }
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(record, null, 1))

  return {
    projectId,
    projectName,
    projectRoot,
    shotCount: nodes.length,
    clipCount: timeline.tracks[0].clips.length,
    storyParagraphs: [...STORY_PARAGRAPHS],
    firstParagraph: STORY_PARAGRAPHS[0],
  }
}
