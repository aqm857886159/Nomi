/**
 * 引导旅途的预置内容：「修好一个小机器人」示例片。
 *
 * 全是事先备好的数据——剧本文本（打字回放用）+ 分镜方案（落画布走真实流水线
 * storyboardPlanToCreateNodesArgs + create_canvas_nodes）。零模型、零额度、零网络。
 * 两个固定角色（小孩 + 小机器人）正好演「身份锁」卖点；屋顶夕阳镜演站位 + 运镜。
 */
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'

/** 示例项目名（带「示例：」前缀，和用户真项目一眼区分）。 */
export const DEMO_PROJECT_NAME = '示例：修好一个小机器人'

/** seedKey：带它的项目永不被空壳 GC 回收，且与真项目隔离（projectRepository 机制）。 */
export const DEMO_PROJECT_SEED_KEY = 'example:robot-rescue'

/** 打字回放的剧本（无台词暖系微叙事，逐字敲进创作编辑器）。 */
export const DEMO_STORY = [
  '黄昏的小巷，一个坏掉的小机器人歪在墙角，零件散落一地。',
  '放学路过的小孩蹲下来，好奇地看着它。',
  '他把小机器人抱回家，在台灯下一颗螺丝一颗螺丝地修。',
  '当最后一颗螺丝拧紧，小机器人的眼睛「叮」地亮了起来。',
  '两个人爬上屋顶，并排坐着，看夕阳一点点沉下去。',
].join('\n')

/**
 * 分镜方案：2 个角色锚（小孩 / 小机器人）+ 1 个场景锚（屋顶）+ 8 个镜头。
 * clientId 稳定（kid / robot / rooftop / shot-N），落画布后控制器靠 clientIdToNodeId
 * 拿到真实节点 id 给聚光精准指向。
 */
export function buildDemoStoryboardPlan(): StoryboardPlan {
  return {
    title: '修好一个小机器人',
    anchors: [
      {
        id: 'kid',
        kind: 'character',
        name: '小孩',
        description: '约十岁的小男孩，短发，黄色连帽卫衣，背一个旧书包，眼神好奇温和。',
        carrier: 'visual',
      },
      {
        id: 'robot',
        kind: 'character',
        name: '小机器人',
        description: '巴掌大的圆头旧机器人，磨损的银色外壳，胸口一盏会亮的暖黄小灯，动作笨拙可爱。',
        carrier: 'visual',
      },
      {
        id: 'rooftop',
        kind: 'scene',
        name: '黄昏屋顶',
        description: '城市旧居民楼的屋顶，水箱与晾衣绳，远处楼群被夕阳染成橘金色。',
        carrier: 'visual',
      },
    ],
    shots: [
      { index: 1, durationSec: 4, anchorIds: ['robot'], prompt: '黄昏小巷远景，坏掉的小机器人歪在墙角，零件散落，暖光斜照。' },
      { index: 2, durationSec: 3, anchorIds: ['kid', 'robot'], prompt: '小孩蹲下，好奇地看着墙角的小机器人，中景。' },
      { index: 3, durationSec: 4, anchorIds: ['kid', 'robot'], prompt: '小孩抱起小机器人走回家，背影跟镜。' },
      { index: 4, durationSec: 4, anchorIds: ['kid', 'robot'], prompt: '台灯下，小孩用螺丝刀专注地修理，手部特写。' },
      { index: 5, durationSec: 3, anchorIds: ['robot'], prompt: '小机器人胸口的暖黄小灯「叮」地亮起，眼睛点亮，特写。' },
      { index: 6, durationSec: 3, anchorIds: ['kid', 'robot'], prompt: '小孩与小机器人对视，机器人歪头，双人中景。' },
      { index: 7, durationSec: 4, anchorIds: ['kid', 'robot', 'rooftop'], prompt: '屋顶上两个并排坐着，背对镜头看远方，中景。' },
      { index: 8, durationSec: 5, anchorIds: ['kid', 'robot', 'rooftop'], prompt: '夕阳下定格，相机缓缓拉远，剪影与橘金天空。' },
    ],
  }
}

/**
 * 画布段每个聚光 beat 指向哪个 clientId（控制器落画布后用 clientIdToNodeId 解析成
 * `[data-node-id="…"]`）。staging/trajectory 指向对应镜头卡，气泡讲「这是什么 + 跟 AI 说一句」
 * ——这两个工具现状只有对话入口、没有 UI 按钮（诚实，不假装有按钮）。
 */
export const DEMO_CANVAS_SPOTLIGHTS: Record<'character' | 'staging' | 'trajectory' | 'generate', string> = {
  character: 'kid',
  staging: 'shot-7',
  trajectory: 'shot-8',
  generate: 'shot-1',
}

/**
 * 预置成图：clientId → 打包图 URL。用真 Nomi(Nano Banana + 角色参考锁一致)生成的 10 张
 * 「修好一个小机器人」成片，压成 720px JPEG 随包走（~920K，零网络零额度）。落画布后由 runner
 * 注入对应节点的 result(status=success) → 画布即显成片，像一个做完的示例项目。
 * 用 new URL(import.meta.url) 静态字面量 = Vite 标准资产处理，类型安全、随构建打包。
 * rooftop(场景卡)复用屋顶日落镜 shot-8;8 镜各用自己的成图。
 */
export const DEMO_NODE_IMAGES: Record<string, string> = {
  kid: new URL('./assets/robot/kid.jpg', import.meta.url).href,
  robot: new URL('./assets/robot/robot.jpg', import.meta.url).href,
  rooftop: new URL('./assets/robot/shot-8.jpg', import.meta.url).href,
  'shot-1': new URL('./assets/robot/shot-1.jpg', import.meta.url).href,
  'shot-2': new URL('./assets/robot/shot-2.jpg', import.meta.url).href,
  'shot-3': new URL('./assets/robot/shot-3.jpg', import.meta.url).href,
  'shot-4': new URL('./assets/robot/shot-4.jpg', import.meta.url).href,
  'shot-5': new URL('./assets/robot/shot-5.jpg', import.meta.url).href,
  'shot-6': new URL('./assets/robot/shot-6.jpg', import.meta.url).href,
  'shot-7': new URL('./assets/robot/shot-7.jpg', import.meta.url).href,
  'shot-8': new URL('./assets/robot/shot-8.jpg', import.meta.url).href,
}
