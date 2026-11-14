// 设计实验室的单独打包配置：只给视觉基线那一趟用（playwright.config.mjs 的 webServer 先打包再静态托管）。
//
// 沿用正式的 vite.config.ts（插件、别名、分块、样式处理全一样，截到的才是同一套代码），只改两处：
// 入口换成 design-lab.html，输出到 outputs/ 下（labBundle.mjs，进不了安装包）。
// 正式产品的构建配置一个字不动——design-lab.html 照旧不参与正式打包（check-design-lab.mjs 守着）。
import path from 'node:path'
import base from '../../../vite.config.ts'
import { LAB_BUNDLE_DIR } from './labBundle.mjs'
import { REPO_ROOT as repoRoot } from './labStates.mjs'

export default async (env) => {
  const resolved = typeof base === 'function' ? await base(env) : base
  return {
    ...resolved,
    root: repoRoot,
    build: {
      ...resolved.build,
      outDir: LAB_BUNDLE_DIR,
      emptyOutDir: true,
      rollupOptions: { ...resolved.build?.rollupOptions, input: path.join(repoRoot, 'design-lab.html') },
    },
  }
}
