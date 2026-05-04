# Design

This folder is the single entry point for reusable frontend visual primitives.

Use this folder for:
- shared panels, inline surfaces, buttons, badges
- shared form controls, modal/drawer shells, tables, and page shells
- brand and workspace identity elements
- other UI atoms that should stay consistent across workbench, project pages, canvas, and stats surfaces

Current primitives:
- `PanelCard` / `InlinePanel`: shared bounded surfaces.
- `DesignButton` / `DesignBadge`: Mantine-backed shared controls for legacy admin/share surfaces that need Mantine props such as `loading`, `component`, or table/modal integration.
- `IconActionButton`: Mantine-backed icon action for legacy Mantine surfaces.
- `WorkbenchButton` / `WorkbenchIconButton`: native workbench actions for dense canvas, timeline, preview, and creation controls.
- `StatusBadge`: shared semantic status badge.
- `DesignCheckbox` / `DesignTextInput` / `DesignTextarea` / `DesignSelect` / `DesignNumberInput` / `DesignSegmentedControl`: shared Mantine-backed form controls.
- `DesignModal` / `DesignDrawer`: shared overlay entry points.
- `DesignTable`: shared table entry point for admin and management surfaces.
- `DesignPageShell`: shared top-level page wrapper.
- `NomiBrand` / `NomiAILabel` / `NomiStepper`: Nomi identity and navigation markers.
- `BodyPortal`: shared body-level portal helper.
- `nomiDesignTokens` / `buildNomiTheme`: token and Mantine theme entry.

Keep it small and centralized:
- add new reusable visual primitives here first
- keep old `ui/*` and `workbench/nomi/*` paths as thin re-exports only
- do not duplicate styling logic in feature pages when a shared primitive exists
