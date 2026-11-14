// 视觉基线对着**打包产物**跑（2026-11-14）：打包产物放哪、为什么不会进安装包。
//
// 以前截图对着开发服务器跑：开发服务器不打包，实验室顺着引用把几乎整个应用带进来（约 5900 个模块），
// 每开一次页面浏览器逐个取、逐个执行，开页到就绪本机约 1.3 秒、线上 3 核机更慢。打包后是少数几个文件，
// 开页到就绪约 0.3 秒（本机 165 个状态整趟从约 4 分钟降到约 1 分钟，含打包）。
//
// 产物目录在 outputs/ 下：.gitignore 已忽略、package.json 的 build.files 只收 dist/ 等，
// 进不了安装包。labBundle.test.mjs 把这条钉住——谁把目录挪进会打包的位置，那条测试先红。
import path from 'node:path'
import { REPO_ROOT } from './labStates.mjs'

export const LAB_BUNDLE_DIR = path.join(REPO_ROOT, 'outputs', 'design-lab', 'bundle')

/**
 * 安装包会收进去的顶层位置（package.json 的 build.files 里不带 `!` 的那些模式的第一段）。
 * 只看第一段是故意的：files 里的模式都是「某个顶层目录 /**」或单个文件，第一段就是它会碰的范围。
 */
export function packagedRoots(buildFiles) {
  return buildFiles
    .filter((pattern) => !pattern.startsWith('!'))
    .map((pattern) => pattern.split('/')[0])
    .filter((segment) => segment && !segment.includes('*'))
}

/** 实验室打包目录是否落在会进安装包的位置里（相对仓库根比较）。 */
export function bundleDirIsPackaged(bundleDir, buildFiles, repoRoot = REPO_ROOT) {
  const relative = path.relative(repoRoot, bundleDir).split(path.sep)
  if (relative[0] === '..' || path.isAbsolute(relative.join('/'))) return false
  return packagedRoots(buildFiles).includes(relative[0])
}
