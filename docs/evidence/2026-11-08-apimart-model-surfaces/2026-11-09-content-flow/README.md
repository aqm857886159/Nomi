# Model settings content flow — 2026-11-09

User decision: follow the design system content flow, superseding right alignment in the unchanged older preview. Production head: `a95ff8676329b4135e881022a5d67c8753f8a384`. Command: `node tests/ux/apimart-model-surfaces.rehearsal.mjs`, exit 0, synthetic credentials and loopback only.

All three screenshots were visually read. Refresh/manage follow APIMart and its connected status by gap-1.5; each disclosure arrow follows its title by gap-1.5. Prefix icons and hint indentation remain unchanged. Geometry for all three states is in [receipt.json](receipt.json): every text/control gap is 6 CSS px, vertical center offsets and title/hint left offsets are within 0.5 px. Arrows intentionally have different x positions because their title lengths differ.

- [zh-CN-account.png](zh-CN-account.png)
- [en-account.png](en-account.png)
- [zh-CN-account-dark.png](zh-CN-account-dark.png)

The dark image uses the real settings theme toggle, then restores light through the same control. 64 GET requests, zero non-GET requests, zero media submissions. Chinese fresh and English v0.24.1 catalog continue the prior full free rehearsal.

Limits: fixed 1280×933 content viewport; real narrow viewport, real account/billing, Windows and independent acceptance not checked. No preview redraw, gate relaxation, button-handler or data-format changes. This settles only the three control placements, not all in-progress items on the model-surface board.
