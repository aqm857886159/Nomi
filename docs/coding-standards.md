# Coding Standards

## Tooling

- TypeScript is the default language for application and package code.
- Prettier is the formatting source of truth.
- ESLint is the linting source of truth.

## Formatting

- Keep the existing Prettier settings.
- Do not reformat unrelated files while making a focused change.
- Prefer the repository's current style in the file you are editing.

## TypeScript

- Keep types explicit when they improve readability or prevent ambiguity.
- Avoid `any` unless the existing code already requires it.
- Remove imports and variables made unused by your change.
- Keep module boundaries clean and move shared code into `packages/*` when it is genuinely reused.

## Code Organization

### Component Responsibility

- Keep each component focused on a single UI or business responsibility.
- Do not combine data fetching, complex state handling, business calculation, and UI rendering in one component.
- If a component is carrying multiple responsibilities, split it into child components, hooks, utils, or services first.
- Page-level components should orchestrate flow and assemble data, not hold large amounts of UI detail.
- Shared UI components must stay free of business-specific logic, and business components should not be over-abstracted into vague generic wrappers.

### File Split Rules

- Keep a single file under roughly 400-500 lines when practical; this is a soft target. The hard limit follows `CLAUDE.md` rule 12 and `check:filesize`.
- If a file grows beyond 500 lines, evaluate whether it should be split.
- Prefer this split order:
  1. Reusable UI into separate components
  2. Complex state logic into custom hooks
  3. Pure computation into utils
  4. API calls into `services/api`
  5. Types into `types`
  6. Static configuration into `constants`

### React Split Signals

- Split when JSX becomes long enough to hurt readability.
- Split when a component contains multiple independent business sections.
- Split when `useState`, `useEffect`, `useMemo`, or `useCallback` accumulate heavily.
- Split when a component owns complex forms, dialogs, lists, canvases, drag-and-drop, or similar isolated logic.
- Split when the same UI or logic repeats in multiple places.
- Split when a component must handle data fetching, permission checks, event dispatch, and rendering details at the same time.

### Recommended Feature Layout

- Prefer feature-oriented folders when a module grows beyond a small surface area.
- Keep related components, hooks, services, utils, constants, and types close together.
- A typical layout can look like:

```bash
src/features/example/
├── index.tsx
├── components/
│   ├── Header.tsx
│   ├── ContentList.tsx
│   └── ActionPanel.tsx
├── hooks/
│   ├── useExampleData.ts
│   └── useExampleActions.ts
├── services/
│   └── exampleApi.ts
├── utils/
│   └── formatExample.ts
├── constants.ts
└── types.ts
```

### Coding Expectations

- Prioritize readability over minimizing file count.
- Do not abstract for abstraction's sake.
- Use clear names that describe responsibility.
- Follow the current module's directory structure and coding style first.
- When touching old code, if a single file is clearly too large or too mixed, refactor it carefully without changing behavior.

## Verification

- Use the narrowest useful check first: package-level lint, typecheck, or build.
- For larger changes, run the scripts from the root.
- If a change affects formatting, run Prettier on the touched files only.
