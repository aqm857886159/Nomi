# Bounded Markdown loading correction

The coordinator authorized minimal production correction after profiling. Evidence is `docs/evidence/2026-10-10-nomi-user-performance/profiles/README.md`; unchanged raw files include four stage actions and cold/hot trace. The independent review owns acceptance. This plan is the implementation line's concrete correction, not a performance pass.

## ★1 User behavior

Opening an empty conversation project currently imports Markdown parser/highlighter through the resident Agent shell even when there is no Markdown to render. Cold node mounting trails the studio moment by396–411ms, with traced Markdown parse/evaluation work. Content rendering keeps the existing Streamdown output; the heavy owner loads only when an actual Markdown consumer mounts.

## ★2 Owner

`NomiMarkdown` remains the sole rendering owner. `LazyNomiMarkdown` is the sole production import boundary; no duplicated parser, projected state, initialization preload or migration shortcut. Production consumers are Agent v4 messages, skill detail, prompt preview and artifact body. The generated seven-door map includes these four, the lazy wrapper, the implementation and kernel test.

## ★3 Reuse

Reuse the existing React.lazy/Suspense boundary and rendering placeholder. Infer its complete props with a type-only import; forward compact/profile/streaming/copy/image labels unchanged. Four direct production consumers switch to that boundary. Tests may directly import the rendering owner to test its kernel. A TypeScript AST static import graph regression protects the shell and all direct consumer entries, including new indirect consumers.

## ★4 States

Empty conversation: no Markdown module requested. Actual content: existing rendering placeholder while loading, then the same production owner. Streaming and labels retain original props. Chunk failure follows the existing router/component error handling; no second renderer or swallow path. Existing project surface suspension, lane open, migration and receipt recovery order stays intact. No layout or new wording is introduced.

## ★9 Verification and rollback

RED: the shell and each direct consumer currently reach the heavy owner. GREEN: none does, and lazy wrapper props preserve production types. Run existing Markdown kernel regressions, renderer types, a fresh production build and unchanged fixture1+5 cold/hot without profiling; compare first feedback, actual target response and decoded-content diagnostics individually. Real rendering/Agent walk must verify the lazy consumer. Native Mac/Windows/GPU remain unverified. Revert the one correction commit to roll back; keep raw evidence immutable.

- [x] Root-cause contract/door enumeration and RED static graph regression.
- [x] One shared lazy boundary and all four production consumers; GREEN kernel/types.
- [x] Fresh build with tracked tree frozen; corrected same-condition baseline and actual lazy Markdown table/stream in native Agent UI. Cold budgets still fail; no significant improvement claimed.
- [ ] Independent review, repository gates and push the existing draft branch.
