/**
 * [INPUT]: 依赖 src/assets/director/ual/ual-mannequin.glb（Quaternius UAL，CC0；网格 + 骨架 + 45 个原生动作同一个文件；构建产物 URL，只喂 three loader）
 * [OUTPUT]: 对外提供 MANNEQUIN_MODEL_URL
 * [POS]: director/scene/character 的内置资产地址单一真相：默认人偶与它的动作库是同一个 glb（CharacterEntity 用网格，poseClipLibrary 用动画）。
 *        只渲染不持久化，登记在 src/bundleAssetUrlBoundary.test.ts 的 RENDER_ONLY_ALLOWLIST。Vite 要静态字面量才能收进产物，所以不拼字符串。
 *        机位机身是 entities/CameraEntity 的程序化几何、泼溅场景由用户自备上传。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export const MANNEQUIN_MODEL_URL = new URL('../../../../../../assets/director/ual/ual-mannequin.glb', import.meta.url).href
