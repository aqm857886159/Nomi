# B2e official API research — 2026-09-09

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## Registry evidence (downloaded today)
- https://registry.npmjs.org/streamdown/latest → **2.6.0**, Apache-2.0; peer React/ReactDOM `^18.0.0 || ^19.0.0`.
- https://registry.npmjs.org/@streamdown/code/latest → **1.1.1**, Apache-2.0; peer React `^18.0.0 || ^19.0.0`; Shiki `^3.19.0`.
- https://registry.npmjs.org/@streamdown/cjk/latest → **1.0.3**, Apache-2.0; peer React `^18.0.0 || ^19.0.0`; remark-cjk-friendly `^2.0.1` and remark-cjk-friendly-gfm-strikethrough `^2.0.1`.
- npm JSON evidence and official dist tarballs unpacked alongside this report. Package metadata has no gitHead; do not claim main source is exactly package revision. Current main source has already diverged slightly (sanitize image sentinel support); versioned dist is authoritative for shipped behavior.

## Official setup and APIs
Context7 resolve selected `/vercel/streamdown`; successful resolve/query raw responses saved. Official setup docs: https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/getting-started.mdx
- React 18 explicitly compatible per peerDependencies; website requirements line oddly says React >=19.1.1 “compatible with React18+”, so npm peer metadata is stronger integration evidence.
- Tailwind3 official content addition: `./node_modules/streamdown/dist/*.js`; code docs recommend including plugin dist too. No Tailwind4 upgrade required. Do not use Tailwind4 @source directive in Tailwind3.
- Use `import { Streamdown } from 'streamdown'; import { code } from '@streamdown/code'; import { cjk } from '@streamdown/cjk'; <Streamdown plugins={{code,cjk}}>{markdown}</Streamdown>`.
- Do not add math/Mermaid plugins. Core defaults do not activate them without plugin.
- Nomi should not use upstream global shadcn variables blindly. Tailwind3 will not generate v4-only `wrap-anywhere` etc; Nomi component mappings and scoped className data selectors can supply token skins and `break-words`/overflow behavior. Inspect actual browser after build.

## Code blocks and copying
Official source: https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/code-block/copy-button.tsx
- CodeBlockCopyButton takes code from explicit string prop or CodeBlockContext; calls `navigator.clipboard.writeText(code)` (never ReactNode stringification). Copy disabled while `isAnimating`; translated aria-label and polite success output.
- Preserve default `components.code`/`pre` owner; use `components.inlineCode` for Nomi inline skin. Overriding code loses default fenced-code string extraction/plugin dispatch/toolbar.
- Controls shape: `{code:{copy:true,download:false},table:{copy:false,download:false,fullscreen:false},image:false}` is supported. Set table/code controls to intended Nomi semantics, not all default controls.
- `lineNumbers` defaults true. `codeBlockMaxHeight` default400, tableMaxHeight default300; `0` or Infinity disables. Dist index.d.ts is exact field evidence.
- Highlight plugin `createCodePlugin({themes:[lightTheme,darkTheme]})` accepts full Shiki theme objects; tokens can derive from Nomi CSS vars. Plugin lazily returns null until async language load; do not treat initial unhighlighted code as failure without wait.

## Streaming/caret/components
Official source: https://github.com/vercel/streamdown/blob/main/packages/streamdown/index.tsx
- `mode` default streaming, `isAnimating` default false; parseIncompleteMarkdown remains independent of actual activity. Stopped/incomplete markdown can continue going through Streamdown repair; do not switch to raw text on stop.
- Built-in `caret='block'|'circle'` + `isAnimating`; core CSS renders caret and hides where inappropriate. No Nomi caret implementation needed.
- `components` maps intrinsic tags, `inlineCode` special case; merges defaults and overrides (index.tsx734ff).
- Passing custom remarkPlugins/rehypePlugins replaces corresponding defaults: preserve exported defaults if extending; do not accidentally drop GFM/sanitize/harden.
- `translations` is Partial<StreamdownTranslations>; use Nomi i18n for all active toolbar strings.

## Link safety and footnotes
Official source: https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/components.tsx and https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/link-safety.mdx
- Core default rehype raw→sanitize→harden pipeline. Harden permits prefixes/protocols '*', but preceding sanitize has restrictive schema. Keep sanitize pipeline intact.
- linkSafety defaults `{enabled:true}`; default link is button+confirmation modal, optional `onLinkCheck`, uses window.open(url,'_blank','noreferrer'). A custom components.a takes over this UI; Nomi existing Electron approved opener/domain dispatch belongs in adapter and must preserve scheme checks. Incomplete `streamdown:incomplete-link` sentinel must never open.
- Default anchor without modal has target='_blank'; footnote `#...` links should use normal in-page navigation in Nomi link adapter instead.
- Core 2.6.0 sanitize clobberPrefix='' avoids double-prefix mismatched footnote IDs. remark-rehype default adds user-content- once. Multiple renderer instances with same [^1] can still collide unless Nomi passes unique per-instance `remarkRehypeOptions.clobberPrefix` (derived from React useId). Do not implement second parser/ID rewriting pipeline.
- Core footnote section filters empty streamed definitions; preserve default section when possible.

## Evidence inventory
`context7-resolve.json`, `context7-query.json`, `*-npm.json`; `streamdown/package/dist/*`, `streamdown-code/package/dist/*`, `streamdown-cjk/package/dist/*`; fetched official main sources under `source/` (not guaranteed identical to versioned dist).
