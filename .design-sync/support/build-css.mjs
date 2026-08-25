// Flatten the design-system styling surface into ONE self-contained CSS file.
//
// Why this exists: the converter copies cfg.cssEntry verbatim into the bundle
// as _ds_bundle.css. Any relative `@import` inside it then dangles, because the
// imported files are NOT copied alongside — validate reports
// [CSS_IMPORT_MISSING] and every preview card renders unstyled.
//
// Nomi has no shipped library stylesheet (it's a private Electron app), so the
// styling surface has to be assembled from the app's own sources. esbuild
// resolves and inlines the @import graph, producing a single file with zero
// relative imports — safe to copy anywhere.
//
// url(...) references (font files) are left as-is: the @font-face rules that
// matter are shipped separately via cfg.extraFonts, which copies the woff2s
// into fonts/ and rewrites their urls. Inlining fonts here would duplicate
// ~2MB of woff2 as base64 into every design that imports styles.css.
//
// Run: node .design-sync/support/build-css.mjs   (see .design-sync/NOTES.md)

import { build } from '../../.ds-sync/node_modules/esbuild/lib/main.js'
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const entry = resolve(here, 'styles.css')
const outFile = resolve(here, 'styles.generated.css')

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  absWorkingDir: repoRoot,
  // `external` keeps font/image urls as literal strings (esbuild rewrites them
  // relative to the output file) instead of inlining or emitting copies. The
  // `empty` loader was tried first and is WRONG here: it blanks every url() to
  // `url()`, losing which file each @font-face pointed at.
  external: ['*.woff', '*.woff2', '*.ttf', '*.otf', '*.svg', '*.png'],
  logLevel: 'warning',
})

let css = result.outputFiles.map((f) => f.text).join('\n')

// Font urls must stay resolvable RELATIVE TO THIS FILE, because the converter
// (package-build.mjs: `extractFonts(explicitCss, dirname(explicitCss), …)`)
// resolves them from the cssEntry's own directory, then copies each woff2 into
// the bundle's flat fonts/ dir and rewrites the url itself.
//
// Getting this wrong is silent: an unresolvable url is left verbatim, so a
// pre-baked `./fonts/x.woff2` ends up inside fonts/fonts.css and resolves to
// fonts/fonts/x.woff2 — a 404 that shows up only as a missing brand font.
// So point every url back at the real file in node_modules, relative to here.
const FONT_SRC_DIRS = [
  'node_modules/@fontsource-variable/inter/files',
  'node_modules/@fontsource-variable/fraunces/files',
]
const fontFileDir = new Map()
for (const d of FONT_SRC_DIRS) {
  for (const f of readdirSync(resolve(repoRoot, d))) fontFileDir.set(f, d)
}
const unresolved = []
css = css.replace(/url\(\s*["']?([^"')]+\.(?:woff2?|ttf|otf))["']?\s*\)/g, (_m, p) => {
  const base = p.split('/').pop()
  const dir = fontFileDir.get(base)
  if (!dir) {
    unresolved.push(p)
    return `url(${p})`
  }
  // relative path from .design-sync/support/ back to the repo-root font file
  return `url(${relative(here, resolve(repoRoot, dir, base))})`
})
if (unresolved.length) {
  console.error(`[CSS_FONTS] ${unresolved.length} font url(s) not found in the known font dirs: ${unresolved.join(', ')}`)
  process.exit(1)
}

// Guard: a stray relative @import surviving here would reproduce exactly the
// [CSS_IMPORT_MISSING] failure this script exists to prevent. Fail loudly.
const leftover = [...css.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:)/.test(u))
if (leftover.length) {
  console.error(`[CSS_FLATTEN] ${leftover.length} relative @import(s) survived bundling: ${leftover.join(', ')}`)
  process.exit(1)
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, css)
console.error(`  flattened CSS: ${(css.length / 1024).toFixed(0)} KB → ${outFile.replace(repoRoot + '/', '')}`)
