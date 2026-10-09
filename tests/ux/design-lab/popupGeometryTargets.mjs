// 弹层几何普查「量哪些格」的唯一 owner（普查脚本和 CI 分片计划都读这里，不各抄一份）。
//
// 跑哪些格：**所有屏里声明 `capture: 'viewport'` 的格**——实验室约定「浮层逃出舞台的形态必须整屏截」，
// 所以这个声明就是「这一格有打开的浮层」的登记处。
import { LAB_SCREEN_IDS, readLabStates } from './labStates.mjs'

/**
 * 量不了的格（写明为什么；格子改名 / 删掉时这里没跟上就当场红，豁免不许过期留着）。
 * 只收「这一格在 headless 软渲染下到不了就绪」这一种，不收「量出来压住了」——那是要修的。
 */
export const UNMEASURABLE = Object.freeze({
  // 3D 精修：脚本步骤（选中侍卫的片段）要等 WebGL 场景与片段轨道加载，CI 的软渲染与慢机器上 60 秒内到不了就绪
  // （CI #1051 与本机各超时一次）；这一格画的是导演台片段轨道，没有浮条下拉。
  'director-refine/d3a-clip-zh': '3D 精修脚本步骤在 headless 软渲染下到不了就绪；格内没有浮条下拉',
})

/** 全部声明了整屏截的格（含量不了的）：[{ screen, state }]。 */
export function listViewportTargets(onlyScreen = '') {
  return LAB_SCREEN_IDS
    .filter((screen) => !onlyScreen || screen === onlyScreen)
    .flatMap((screen) => readLabStates(screen).filter((state) => state.capture === 'viewport').map((state) => ({ screen, state })))
}

/** 豁免指向不存在的格 = 豁免过期，返回这些键。 */
export function staleUnmeasurableKeys() {
  const known = new Set(LAB_SCREEN_IDS.flatMap((screen) => readLabStates(screen).map((state) => `${screen}/${state.id}`)))
  return Object.keys(UNMEASURABLE).filter((key) => !known.has(key))
}

/** 真正要量的格（去掉豁免）。 */
export function listMeasurableTargets(onlyScreen = '') {
  return listViewportTargets(onlyScreen).filter(({ screen, state }) => !UNMEASURABLE[`${screen}/${state.id}`])
}
