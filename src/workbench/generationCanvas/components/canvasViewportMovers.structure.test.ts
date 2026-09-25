import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「谁有权移动画布视口」的名单（2026-09-25 用户拍板：程序不再主动平移 / 缩放画布，只有用户显式操作能动）。
 *
 * 这类问题反复发生（用户原话「好像修过，但类似问题反复发生」）的机械原因：「新建后露出 / 落地后适应 /
 * 复制后聚焦 / 导入后对准」各自在自己的入口里请求一次移动，每加一个新入口就多一扇门。这里把能请求移动的
 * 两扇总门——`requestCanvasFit`（适应并切分类）与 `FOCUS_GENERATION_NODE_EVENT`（定位到某个节点）——的
 * 全部调用处列成名单；名单里每一处都必须是用户点出来的。新增一处而不进名单 = 红；进名单要在这里写清
 * 「这是用户的哪一下点击」。新东西落在屏外，正确做法是让画布边缘提示（CanvasArrivalHint）指路，不是加门。
 */
const SRC = path.resolve(__dirname, '../../..')

const FIT_CALLERS: Record<string, string> = {
  'workbench/production/useProductionStatus.ts': '生产状态卡「去看看」按钮（open-stage）：用户点了才去',
}

const FOCUS_DISPATCHERS: Record<string, string> = {
  'workbench/sidebar/CategoryTree.tsx': '侧栏点节点定位',
  'workbench/creation/storyboard/StoryboardPlanEditor.tsx': '分镜表「在画布上查看」按钮',
  'workbench/generationCanvas/nodes/BaseGenerationNode.tsx': '节点「定位来源」角标',
  'workbench/generationCanvas/components/BatchPlanOverlay.tsx': '批量条上点被卡住的那一镜',
  'workbench/generationCanvas/nodes/completeNodeConnection.ts': 'toast 上的「定位」动作',
  'workbench/project/useProjectNotificationTarget.ts': '点系统通知 / 深链跳到节点',
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** 剥掉注释再扫：注释里提到这些符号（记录历史的那几行）不算调用（check:walkthroughs「结构测试须剥注释」）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const relative = (file: string) => path.relative(SRC, file).split(path.sep).join('/')
const files = sourceFiles(path.join(SRC, 'workbench'))

describe('canvas viewport movers', () => {
  it('only explicit user actions request a canvas fit', () => {
    const callers = files
      .filter((file) => /\brequestCanvasFit\(/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map(relative)
      .filter((file) => file !== 'workbench/workbenchStore.ts')
      .sort()
    expect(callers).toEqual(Object.keys(FIT_CALLERS).sort())
  })

  it('only explicit user actions dispatch the focus event', () => {
    const dispatchers = files
      // 常量与字面量两种写法都算（侧栏以前就是用字面量派发的，同一扇门换个拼法照样是门）。
      .filter((file) => /new CustomEvent\((FOCUS_GENERATION_NODE_EVENT|['"]nomi-focus-generation-node['"])/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map(relative)
      .sort()
    expect(dispatchers).toEqual(Object.keys(FOCUS_DISPATCHERS).sort())
  })

  it('the created-node reveal pan, its target tracker and the open-time auto fit stay deleted', () => {
    // useAutoFitOnLoad：2026-09-26 协调裁定：打开项目时的自动摆全貌在 main 上从未生效（节点量好尺寸之前就判定，外接盒为空）。证据：main 上磁吸走查量到 zoom=1、性能测试挂载数 < 总数。按用户「程序不自己动视口」的规则直接删除，不修复。代价：内容离原点很远时，用户自己点一次「适应视图」。
    for (const gone of ['useCreatedNodeVisibilityPan.ts', 'viewportTargetTracker.ts', 'useAutoFitOnLoad.ts']) {
      expect(fs.existsSync(path.join(__dirname, gone)), gone).toBe(false)
    }
  })
})
