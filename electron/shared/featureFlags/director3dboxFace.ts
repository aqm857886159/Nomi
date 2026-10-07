/**
 * 3D-BOX 开关在**共享层**的只读视图（工具注册表、契约表这类会被主进程 / 渲染端 / pi 岛 / MCP 进程 /
 * 门岗脚本 / vitest 同时导入、且在模块导入时就装配成常量的代码只许问这里）。
 *
 * 为什么不直接 import `./director3dbox`：那是 Node 引导模块（读 `fs` 与 `__dirname`），渲染端 bundle
 * 也会导入共享层，进去就炸。值的唯一来源仍是引导模块——它在每个 Node 进程首个导入时把算好的值
 * 用 `installDirector3DBoxFace` 装到 `globalThis` 上；渲染端读 preload 交出的同一份证明
 * （`window.nomiDesktop.featureFlags.director3dbox`，3a 的主进程 → preload 指纹核对已经做完）。
 * 两处都没有 = 关。
 *
 * 读早于装：某个进程如果先导入了注册表、后导入引导模块，注册表已经按「关」装配了，开关却是开——
 * 那是两张工具面。装的那一刻发现「之前有人读到了不同的值」就当场抛，不让进程带着两张面跑。
 */
const INSTALLED = Symbol.for('nomi.featureFlags.director3dbox.face')
const FIRST_READ = Symbol.for('nomi.featureFlags.director3dbox.firstRead')

type FaceGlobal = typeof globalThis & {
  [INSTALLED]?: Readonly<{ enabled: boolean }>
  [FIRST_READ]?: boolean
  nomiDesktop?: { featureFlags?: { director3dbox?: { enabled?: unknown } } }
}

function slot(): FaceGlobal {
  return globalThis as FaceGlobal
}

/** 引导模块专用：一个进程只装一次；已有人按别的值读过 → 抛。 */
export function installDirector3DBoxFace(enabled: boolean): void {
  const target = slot()
  const installed = target[INSTALLED]
  if (installed) {
    if (installed.enabled !== enabled) throw new Error(`director3dbox face already installed as ${installed.enabled}, refusing ${enabled}`)
    return
  }
  const firstRead = target[FIRST_READ]
  if (firstRead !== undefined && firstRead !== enabled) {
    throw new Error('director3dbox face was read before the bootstrap installed it; import electron/shared/featureFlags/director3dbox first in this process')
  }
  target[INSTALLED] = Object.freeze({ enabled })
}

export function director3dBoxFaceEnabled(): boolean {
  const target = slot()
  const installed = target[INSTALLED]
  const value = installed
    ? installed.enabled
    : target.nomiDesktop?.featureFlags?.director3dbox?.enabled === true
  if (target[FIRST_READ] === undefined) target[FIRST_READ] = value
  return value
}

/** 测试专用：清掉安装与首读记录，配合 `vi.resetModules()` 在同一进程里装配两张面。 */
export function resetDirector3DBoxFaceForTests(): void {
  const target = slot()
  delete target[INSTALLED]
  delete target[FIRST_READ]
}
