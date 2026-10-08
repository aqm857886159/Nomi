# Storyboard batch implementation evidence

Captured from the current implementation through the headless design lab. Every PNG below was read with `view_image` in both locale tracks. The obsolete result-removal state is absent.

| State | zh-CN | en |
|---|---|---|
| sbb-b2-01-dialog | [zh-CN](after/zh-CN/sbb-b2-01-dialog.png) | [en](after/en/sbb-b2-01-dialog.png) |
| sbb-b2-02-dialog-removed | [zh-CN](after/zh-CN/sbb-b2-02-dialog-removed.png) | [en](after/en/sbb-b2-02-dialog-removed.png) |
| sbb-b2-03-dialog-no-anchors | [zh-CN](after/zh-CN/sbb-b2-03-dialog-no-anchors.png) | [en](after/en/sbb-b2-03-dialog-no-anchors.png) |
| sbb-b2-05-dialog-none | [zh-CN](after/zh-CN/sbb-b2-05-dialog-none.png) | [en](after/en/sbb-b2-05-dialog-none.png) |
| sbb-b2-07-dialog-dark | [zh-CN](after/zh-CN/sbb-b2-07-dialog-dark.png) | [en](after/en/sbb-b2-07-dialog-dark.png) |
| sbb-b2-08-footer-idle | [zh-CN](after/zh-CN/sbb-b2-08-footer-idle.png) | [en](after/en/sbb-b2-08-footer-idle.png) |
| sbb-b2-11-footer-stopped | [zh-CN](after/zh-CN/sbb-b2-11-footer-stopped.png) | [en](after/en/sbb-b2-11-footer-stopped.png) |
| sbb-b2-12-footer-done | [zh-CN](after/zh-CN/sbb-b2-12-footer-done.png) | [en](after/en/sbb-b2-12-footer-done.png) |
| sbb-b5-01-rows | [zh-CN](after/zh-CN/sbb-b5-01-rows.png) | [en](after/en/sbb-b5-01-rows.png) |
| sbb-b5-02-rows-narrow | [zh-CN](after/zh-CN/sbb-b5-02-rows-narrow.png) | [en](after/en/sbb-b5-02-rows-narrow.png) |
| sbb-b5-03-rows-dark | [zh-CN](after/zh-CN/sbb-b5-03-rows-dark.png) | [en](after/en/sbb-b5-03-rows-dark.png) |
| sbb-b5-04-row-menu | [zh-CN](after/zh-CN/sbb-b5-04-row-menu.png) | [en](after/en/sbb-b5-04-row-menu.png) |
| sbb-b5-06-result-narrow | [zh-CN](after/zh-CN/sbb-b5-06-result-narrow.png) | [en](after/en/sbb-b5-06-result-narrow.png) |
| sbb-b7-02-toolbar-three-models | [zh-CN](after/zh-CN/sbb-b7-02-toolbar-three-models.png) | [en](after/en/sbb-b7-02-toolbar-three-models.png) |
| sbb-b7-04-toolbar-narrow | [zh-CN](after/zh-CN/sbb-b7-04-toolbar-narrow.png) | [en](after/en/sbb-b7-04-toolbar-narrow.png) |
| sbb-b7-06-panel-three-models | [zh-CN](after/zh-CN/sbb-b7-06-panel-three-models.png) | [en](after/en/sbb-b7-06-panel-three-models.png) |
| sbb-b7-10-bulkbar | [zh-CN](after/zh-CN/sbb-b7-10-bulkbar.png) | [en](after/en/sbb-b7-10-bulkbar.png) |
| sbb-b7-11-bulkbar-narrow | [zh-CN](after/zh-CN/sbb-b7-11-bulkbar-narrow.png) | [en](after/en/sbb-b7-11-bulkbar-narrow.png) |

## Mutation checks
Each mutation below was applied temporarily, the named test was run and expected to fail, then the production file was restored.

| Check | Red test output |
|---|---|
| cancel: no nodes before confirmation / zero dispatch | [output](mutations/01-cancel-zero-dispatch.txt) |
| unchecked checklist item is not dispatched | [output](mutations/02-unchecked-dispatch.txt) |
| reference failure blocks shot dispatch | [output](mutations/03-reference-failure-dispatch.txt) |
| legacy checkbox migrates to skip | [output](mutations/04-legacy-migration.txt) |

The passing baseline was `pnpm exec vitest run src/workbench/creation/storyboard/exec/storyboardBatchLanding.test.ts src/workbench/creation/storyboard/storyboardSelectionMigration.test.ts --reporter=dot` (22 tests).
