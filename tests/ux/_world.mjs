// 走查里造「世界」的共用入口：tests/world 是 TS，走查跑在纯 node，这里用 tsx 把它加载进来。
// 走查不再手写 model-catalog.json：目录行交给主人的写口（buildWorld → mutateCatalog），落盘形状由主人定。
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'

const here = path.dirname(fileURLToPath(import.meta.url))
const world = tsxRequire(path.join(here, '../world/index.ts'), import.meta.url)

export const buildWorld = world.buildWorld
export const seedOldUserData = world.seedOldUserData
export const damageWorldFile = world.damageWorldFile

/**
 * 走查夹具里「一个能选到的模型」：把旧手写目录的 vendors / models（可带 mappings）交给 buildWorld。
 * 模型默认 selectable（由门补一条占位映射，#1560 起没有启用映射的模型选不到）。
 * 只管设置根；项目仍由走查自己放（项目目录命名见各走查）。
 */
export function buildWalkCatalog(settingsDir, { vendors = [], models = [], mappings = [], projects = [], encryptedApiKeys } = {}) {
  const strip = (row) => {
    const rest = { ...row }
    delete rest.createdAt
    delete rest.updatedAt
    return rest
  }
  return buildWorld({
    settingsDir,
    builtinSeeds: false,
    projects,
    encryptedApiKeys,
    catalog: {
      vendors: vendors.map(strip),
      models: models.map((model) => ({ ...strip(model), selectable: mappings.length === 0 })),
      mappings,
    },
  })
}
