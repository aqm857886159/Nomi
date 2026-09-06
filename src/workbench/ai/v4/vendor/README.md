# AI Elements adaptation boundary

The v4 lab uses the Apache-2.0 Vercel AI Elements anatomy captured in
`docs/research/2026-09-06-ai-elements-anatomy.md`. The runtime components are
Nomi-owned adaptations in the parent directory: no shadcn class names, no
Tailwind 4 syntax, no React 19 APIs, and no new dependency are introduced.

`aiElementsContract.ts` freezes the imported building-block/status vocabulary so
future wiring can replace fixture data without changing the visual components.
