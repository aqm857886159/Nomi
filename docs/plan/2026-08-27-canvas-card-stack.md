# Canvas card stacks implementation plan

## Scope

Replace parallel result-history UIs with one card stack, make group collapse real, and correct duplicate-as-variant graph semantics on Nomi v0.21.0.

## Do not change

- Generic clipboard copy/paste semantics.
- Sidebar project-switch behavior.
- Windows/package icon assets.
- Video player controls in the full preview.
- Provider/model request contracts.

## Work sequence

1. Add pure projection helpers and RED tests for stable result order, bounded tray entries, collapsed-group layout, hidden/redirected edges, and card layer count.
2. Add RED store tests for clean duplicate-as-variant, incoming-edge cloning, one undo step, group collapse persistence and group drag/expand position restoration.
3. Implement the store/model behavior without UI.
4. Build `NodeResultStack` and delete `ImageResultStack` plus `ShotVersionStrip`; extend exact-result download and reuse safe delete/full preview.
5. Build `CardStackPeeks` and `CollapsedGroupCard`; wire group collapse into `GroupFrame` and `GenerationCanvas` projection.
6. Add bilingual strings and component tests for click, keyboard, hover, reduced motion, count labels and no duplicate controls.
7. Run focused tests, source/control/token/i18n/size gates, full typecheck/test/build.
8. Launch the built Electron app against a disposable project, run four acceptance journeys, reopen it, and capture light/dark screenshots.

## Rollback

The change is isolated to canvas projection/store actions and can be reverted as one branch. Persisted `group.collapsed` is optional and already schema-compatible; older builds ignore it.

## Acceptance gate

- Card peeks max at two rear layers for any history size.
- Result switching does not reorder history.
- Historical media actions target the clicked result.
- Duplicate variant has no old output/run state and clones all incoming edges exactly once.
- Collapsed groups preserve node positions and connections across reopen.
- No old image grid or production version strip remains.
- Real Electron screenshots match the approved right-only stack metaphor.

