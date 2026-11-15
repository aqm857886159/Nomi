/**
 * `import logo from '@lobehub/icons-static-svg/icons/x.svg'` 的类型声明（Vite 把它变成一条 URL）。
 *
 * 仓库没有引 `vite/client` 的全局类型（见 rawText.d.ts），所以这类资源导入要自己声明。
 * 只声明这一个包的图标目录——别的 svg 导入要用再加，不开通配的 `*.svg`。
 */
declare module '@lobehub/icons-static-svg/icons/*.svg' {
  const url: string
  export default url
}
