# 2026-10-08 Nightly walkthrough triage

Input: run 37707584980, four raw TSV files and their logs. Total 324: 149 passed, 169 exited 1, and 6 timed out (exit 124). Each failure below uses the first error-bearing log line.

## Category counts

| Category | Meaning | Count |
|---|---|---:|
| A | Walkthrough drift: selector, copy, or entry is stale | 56 |
| B | Requires real credentials, network, media, external CLI, or platform; CI should not run it | 30 |
| C | Harness/nightly environment: timeout, artifact, or runtime setup | 13 |
| D | Suspected real product regression | 25 |
| E | Not decidable from the available evidence | 51 |

## Per-failure triage

| Walkthrough | Exit | Seconds | Category | First error-bearing log line | Minimum handling |
|---|---:|---:|:---:|---|---|
| `tests/ux/agent-askback-real-model.walk.mjs` | 1 | 1 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/agent-lane-deletion.walk.mjs` | 1 | 6 | D | "error": "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: true\nReceived: false\n at captureRawStack (/home/runner/work/Nomi/Nomi/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/lib/coreBundle.js:3130:17)\n at callMatcherAsStep (/home/runner/work/Nomi/Nomi/node_modules/.pnpm/playwright@1.60.0/node_modules/play | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-panel-mechanics.walk.mjs` | 1 | 1 | E | node:internal/modules/run_main:107 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/agent-runtime-production.walk.mjs` | 1 | 21 | A | "error": "Error: \u57fa\u7ebf\u4e0d\u6210\u7acb\uff1a\u300cInline storyboard planning reaches the real Resident approval boundary\u300d\u5e94\u5f53\u80fd\u88ab\u63a2\u9488\u627e\u5230\uff0c\u4f46\u4e00\u4e2a\u90fd\u6ca1\u627e\u5230\u3002\n\u5982\u679c\u8fde\u5b83\u90fd\u627e\u4e0d\u5230\uff0c\u8bf4\u660e\u9762\u677f\u6ca1\u6e32\u67d3 / \u9009\u62e9\u5668\u51 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-spend-card.walk.mjs` | 1 | 25 | A | "error": "Error: \u70b9\u4e0d\u5230\u300c\u4ed8\u6b3e\u5361\u771f\u5b9e\u5c3a\u5bf8\u53c2\u6570\u300d\uff1a\u7b49\u6ee1 15000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002\n\u8981\u4e48\u8fd9\u4e00\u5c4f\u6839\u672c\u6ca1\u8d70\u5230\uff08\u4e0a\u4e00\u6b65\u5176\u5b9e\u5931\u8d25\u4e86\uff09\uff0c\u8981\u4e48\u5b9a\u4f4d\u5668\u5df2\u7ecf\u8fc7\u671f\u2014\u2014\n | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-spend-reprice.walk.mjs` | 1 | 23 | A | "error": "Error: \u57fa\u7ebf\u4e0d\u6210\u7acb\uff1a\u300cThe size chip is a live control on the paid card\u300d\u5e94\u5f53\u80fd\u88ab\u63a2\u9488\u627e\u5230\uff0c\u4f46\u4e00\u4e2a\u90fd\u6ca1\u627e\u5230\u3002\n\u5982\u679c\u8fde\u5b83\u90fd\u627e\u4e0d\u5230\uff0c\u8bf4\u660e\u9762\u677f\u6ca1\u6e32\u67d3 / \u9009\u62e9\u5668\u5199\u9519\u4e86\uff0c\u | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-thinking-rows.walk.mjs` | 1 | 10 | A | "error": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\"creation\"] [data-v4-block=\"intervention\"]')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n - Expect \"to.be.visible\" with timeout 5000ms\n - waiting for locator('[data-a | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-v4-retry-storm.walk.mjs` | 1 | 12 | D | "error": "Error: expect(locator).toHaveAttribute(expected) failed\n\nLocator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\"generation\"]').locator('[data-v4-block=\"process\"]')\nExpected: \"2\"\nReceived: \"\"\nTimeout: 5000ms\n\nCall log:\n - Expect \"to.have.attribute.value\" with timeout 5000ms\n - waiting for l | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/antigravity-cli.live.walk.mjs` | 1 | 0 | B | if (process.env.NOMI_LIVE_ANTIGRAVITY !== '1') throw new Error('Set NOMI_LIVE_ANTIGRAVITY=1 to run the authenticated walkthrough') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/asset-library-native-import.walk.mjs` | 1 | 15 | E | if (dropped.length !== 2) throw new Error(`\u62d6\u5165\u540e\u672a\u843d\u76d8\u7b2c\u4e8c\u5f20\u56fe\u7247\uff0c\u53d1\u73b0 ${dropped.length} \u5f20`) | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/asset-video-preview.walk.mjs` | 1 | 40 | A | \u8d70\u67e5\u5931\u8d25: locator.evaluate: Error: 30 \u79d2\u5185\u672a\u751f\u6210\u89c6\u9891\u5c01\u9762 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/audio-reference-connect.walk.mjs` | 1 | 41 | A | expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/canvas-handles-alt-drag.walk.mjs` | 1 | 0 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/canvas-shortcut-parity.walk.mjs` | 1 | 1 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/comfy-workflow-multiref.walk.mjs` | 1 | 11 | A | ExpectError: expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/control-hierarchy-u2.walk.mjs` | 1 | 21 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/creation-pill-overlap.walk.mjs` | 1 | 37 | A | locator.click: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/credential-offline.walk.mjs` | 1 | 5 | D | ExpectError: expect(received).toBe(expected) // Object.is equality | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/custom-prompt-realtask.walk.mjs` | 1 | 0 | B | \u62ff\u4e0d\u5230\u771f\u5b9e\u6a21\u578b\u76ee\u5f55\uff1a/home/runner/.config/nomi/model-catalog.json | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/default-generation-model.walk.mjs` | 1 | 35 | A | locator.waitFor: Timeout 15000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/design-lab-question-card-generality.walk.mjs` | 124 | 600 | C | "state": "v4-intervention-question-missing-param", | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/director-3dbox-3b-agent.walk.mjs` | 1 | 0 | B | if (!API_KEY) throw new Error('\u9700\u8981 DEEPSEEK_API_KEY\uff08\u771f\u5b9e Agent \u6a21\u578b\uff0c\u4e0d\u8bb8 mock\uff09\uff1aset -a; . ~/.nomi-secrets.env; set +a') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/director-assets.walk.mjs` | 1 | 25 | E | \u2717 \u8d44\u4ea7\u8d70\u67e5\u4e2d\u65ad\uff1aTypeError: Cannot read properties of undefined (reading 'id') | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-j5-splat-valley.walk.mjs` | 1 | 33 | E | \u2717 \u65c5\u7a0b\u4e2d\u65ad\uff1a\u7b49\u4e0d\u5230\u5de5\u7a0b\u72b6\u6001\u300c\u8d44\u4ea7\u5e93\u51fa\u6cfc\u6e85\u6761\u76ee\u300d\uff1a(p.assets && p.assets.items // []).some(i => i.kind === 'splat') \u2014 at Object.waitScene (file:///home/runner/work/Nomi/Nomi/tests/ux/_directorLab.mjs:136:15) \u21d0 at async file:///home/runner/work/Nomi/Nomi/te | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-ual-crowd.walk.mjs` | 1 | 94 | A | \u2717 \u65c5\u7a0b\u4e2d\u65ad\uff1alocator.fill: Timeout 15000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/feedback-share-center.walk.mjs` | 1 | 38 | A | ExpectError: \u70b9\u4e0d\u5230\u300c\u5173\u4e8e\u9875\u300c\u53cd\u9988\u4e0e\u5206\u4eab\u300d\u5165\u53e3\u300d\uff1a\u7b49\u6ee1 15000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/import-reveal.walk.mjs` | 1 | 0 | B | IMPORT_REVEAL_OUT \u672a\u8bbe\u7f6e\uff1a\u8bf7\u6307\u5411\u653e assets/frame4k.png \u4e0e assets/<\u89c6\u9891> \u7684\u8bc1\u636e\u76ee\u5f55 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/mcp-connection-truthfulness.walk.mjs` | 1 | 14 | A | ExpectError: expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/mention-scope.walk.mjs` | 1 | 22 | E | \u2192 \u7d20\u6750\u56fe: ref-red.png, ref-blue.png | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/model-contract-limits.walk.mjs` | 1 | 18 | A | ExpectError: expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/multi-user-isolation.walk.mjs` | 1 | 24 | A | locator.click: Timeout 8000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/node-composer-placement.walk.mjs` | 1 | 44 | A | VERIFY ERROR: locator.click: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/onboarding-checkmark-honesty.walk.mjs` | 1 | 26 | A | ExpectError: \u70b9\u4e0d\u5230\u300c\u62c6\u6210\u955c\u5934\xb7\u843d\u753b\u5e03\u300d\uff1a\u7b49\u6ee1 8000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/param-bar-models.walk.mjs` | 1 | 1 | C | Error: ENOENT: no such file or directory, open '/Users/aoqimin/Documents/Nomi Projects/\u672a\u547d\u540d\u9879\u76ee 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json' | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/pr720-apimart-key.walk.mjs` | 1 | 17 | B | \xb7 \u586b key \u524d \u4e09\u884c\u53ef\u6311\u9879\uff1a{"\u5bf9\u8bdd":"0(row-missing)","\u56fe\u7247\u9ed8\u8ba4":"3(ok)","\u89c6\u9891\u9ed8\u8ba4":"3(ok)"} | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/project-asset-healthcheck.walk.mjs` | 1 | 37 | A | locator.waitFor: Timeout 20000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/prompt-picker.walk.mjs` | 1 | 22 | D | ExpectError: composer \u91cc\u5e94\u5f53\u6709\u4e14\u53ea\u6709 1 \u4e2a\u63d0\u793a\u8bcd\u9009\u62e9\u5668\uff08\u4e00\u529f\u80fd\u4e00\u4e2a\u5bb6\uff09 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/provider-proxy-field.walk.mjs` | 1 | 7 | A | PROVIDER PROXY WALK FAIL: Error: no custom-api row | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/rich-editor-p1.walk.mjs` | 1 | 83 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/shot-table-storyboard-projection.walk.mjs` | 1 | 1 | B | if (!fs.existsSync(file)) throw new Error(`\u771f\u5b9e\u8d44\u6599\u76ee\u5f55\u7f3a ${path.basename(file)}\uff08${file}\uff09\u2014\u2014${why}`) | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/skill-library-cards.walk.mjs` | 1 | 11 | D | ExpectError: expect(received).toBe(expected) // Object.is equality | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/storyboard-anchor-policy.walk.mjs` | 1 | 33 | A | ExpectError: \u951a\u5361\u6d88\u8d39\u6a59\u5b57 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/storyboard-model-same-name.walk.mjs` | 1 | 21 | A | expect(locator).toContainText(expected) failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/telemetry-consent.walk.mjs` | 1 | 5 | A | [walkthrough] content viewport {"width":1280,"height":933} | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/timeline-toolbar-row.walk.mjs` | 1 | 10 | D | ExpectError: \u538b\u5230 320px \u540e\u6ca1\u6709\u4ea7\u751f\u6a2a\u5411\u6eda\u52a8\uff08\u8bf4\u660e\u88ab\u88c1\u6389\u6216\u6362\u884c\u4e86\uff09 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/toolbar-order.walk.mjs` | 1 | 48 | A | locator.click: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/vendor-honest-variant-axis.walk.mjs` | 1 | 5 | E | page.evaluate: Error: \u5bc6\u94a5\u9a8c\u8bc1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5bc6\u94a5\u548c\u6743\u9650\u540e\u91cd\u8bd5\u3002 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/video-depth-real-task.walk.mjs` | 1 | 80 | A | ExpectError: \u6d3e\u751f\u8282\u70b9\u4e0a\u6ca1\u6709\u8fdb\u5ea6\u906e\u7f69 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/volcengine-speech-credential.walk.mjs` | 1 | 7 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/agent-panel-missing-card.walk.mjs` | 1 | 24 | D | "name": "panel-missing-card", | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-queued-shot-not-regenerable.walk.mjs` | 1 | 68 | D | "error": "Error: \u7b2c\u4e00\u955c\u7684\u751f\u6210\u8bf7\u6c42\u5230\u4e86\u4f9b\u5e94\u5546\n\n\u7b2c\u4e00\u955c\u7684\u751f\u6210\u8bf7\u6c42\u5230\u4e86\u4f9b\u5e94\u5546\n\nexpect(received).toBe(expected) // Object.is equality\n\nExpected: 1\nReceived: 0\n\nCall Log:\n- Timeout 60000ms exceeded while waiting on the predicate\n at captureRawStack (/ho | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-runtime-provider.walk.mjs` | 1 | 1 | B | if (process.env.NOMI_AGENT_LIVE !== '1') throw new Error('Explicit paid evaluation requires NOMI_AGENT_LIVE=1') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/agent-spend-confirm-executes.walk.mjs` | 1 | 13 | A | "error": "Error: \u4ed8\u8d39\u5361\u5e95\u680f\u4e0a\u7684\u6e05\u6670\u5ea6 chip\n\nexpect(locator).toBeVisible() failed\n\nLocator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\"generation\"] [data-v4-block=\"intervention\"][data-kind=\"spend\"]').locator('[data-parameter-chip=\"resolution\"]')\nExpected: visible\ | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-spend-stop-midway.walk.mjs` | 1 | 92 | D | "error": "Error: zh\uff1a\u5361\u5173\u6389\u65f6\u90a3\u4e00\u53e5\u7167\u5bbf\u4e3b\u6700\u7ec8\u6279\u4e0b\u7684\u8bf4\uff08\u53d1\u51fa\u4e86 4 \u5f20\uff0c\u5269\u4e0b 2 \u5f20\u6ca1\u53d1\u3002\uff09\n\nexpect(received).toEqual(expected) // deep equality\n\n- Expected - 1\n+ Received + 1\n\n Object {\n \"notSent\": 2,\n- \"sent\": 1,\n+ \"sent\": 4,\n  | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-storyboard-generate-confirm.walk.mjs` | 1 | 5 | E | "error": "page.evaluate: Error: storyboard_initiator_required\n at Cee (file:///home/runner/work/Nomi/Nomi/dist/assets/NomiStudioApp-cgq6hzez.js:108:26182)\n at bT (file:///home/runner/work/Nomi/Nomi/dist/assets/NomiStudioApp-cgq6hzez.js:112:4979)\n at /home/runner/work/Nomi/Nomi/tests/ux/agent-storyboard-generate-confirm.walk.mjs:63:27" | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/agent-timeline-ops.walk.mjs` | 1 | 14 | A | ExpectError: \u53ef\u64a4\u9500\u7684\u6539\u52a8\u624d\u7ed9\u5230\u300c\u4e0d\u518d\u95ee \u2192\u300d | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-v4-short-film.walk.mjs` | 1 | 14 | A | "error": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\"creation\"]').locator('[data-v4-block=\"intervention\"]')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n - Expect \"to.be.visible\" with timeout 5000ms\n - waiting for locat | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/arrange-draft-cta.walk.mjs` | 1 | 13 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/assisted-onboarding-entry.walk.mjs` | 1 | 7 | D | ExpectError: \u2461 \u6280\u80fd\u6b63\u6587\u91cc\u7f3a nomi_integration | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/audio-timeline.walk.mjs` | 1 | 1 | E | \u7f3a .tmp/probe-tone-3s.mp3 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-drop-at-cursor.walk.mjs` | 1 | 0 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/canvas-image-aspect.walk.mjs` | 1 | 0 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/card12-draft-shots-performance.walk.mjs` | 1 | 22 | D | "error": "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 33\nReceived: 34\n\nCall Log:\n- Timeout 15000ms exceeded while waiting on the predicate\n at captureRawStack (/home/runner/work/Nomi/Nomi/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/lib/coreBundle.js:3130:17)\n at callMatcherAsStep (/home/runner/wo | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/composer-long-prompt.walk.mjs` | 1 | 29 | E | \u2026 \u542f\u52a8\u6784\u5efa\u4ea7\u7269\uff08Electron\uff09\u2026 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/design-lab-catalog-liveness.walk.mjs` | 1 | 23 | E | \u2717 catalog-liveness-light: manual enable failed | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-3dbox-3c-agent.walk.mjs` | 1 | 1 | B | if (!rendererUrl) throw new Error('\u9700\u8981 NOMI_WALK_RENDERER_URL\uff08\u672c\u4ed3 vite dev \u5730\u5740\uff09\uff0c\u89c1\u6587\u4ef6\u5934\u7528\u6cd5') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/director-clip-states.walk.mjs` | 1 | 0 | C | TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".tsx" for /home/runner/work/Nomi/Nomi/src/workbench/generationCanvas/nodes/director/timeline/ClipBar.tsx | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/director-j6-outputs.walk.mjs` | 1 | 407 | E | \u2713 \u622a\u56fe\u547d\u540d\u300c\u81ea\u7531\u6f2b\u6e38\xb7\u5168\u666f-\u622a\u56fe1\u300d \u2014 \u81ea\u7531\u6f2b\u6e38\xb7\u5168\u666f-\u622a\u56fe1 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-model-import.walk.mjs` | 1 | 29 | B | \xb7 \u8df3\u8fc7 FBX \u89d2\u8272\u5bfc\u5165\uff1a\u672a\u8bbe\u7f6e NOMI_DIRECTOR_TEST_FBX\uff08\u9700\u81ea\u5907 Mixamo \u5e26\u8499\u76ae\u89d2\u8272 FBX\uff09 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/director-ual-mannequin.walk.mjs` | 124 | 600 | C | \u2713 \u65b0\u52a0\u7684\u4eba = \u9ed8\u8ba4 UAL \u4eba\u5076\uff08builtin:ual + rig ual\uff09 \u2014 builtin:ual / ual | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/f3-f16b.walk.mjs` | 1 | 20 | A | ExpectError: \u521b\u4f5c\u52a9\u624b\u8f93\u5165\u6846\u53ef\u89c1 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/i18n-sweep.walk.mjs` | 1 | 63 | E | \u2717 [en] \u4fa7\u680f\xb7Prompt library \xb7 \u65e0\u6b8b\u7559\u4e2d\u6587 \u2014 Error: [en] \u4fa7\u680f\xb7Prompt library\uff1a\u82f1\u6587\u754c\u9762\u4e0d\u8be5\u6709\u672a\u7ffb\u8bd1\u4e2d\u6587\uff08EN-DOM \u65ad\u8a00\u7f51\uff09\uff1a\u627e\u5230 4 \u5904 CJK \u6587\u672c\u3002 / \xb7 button.shrink-0.rounded-full \u201c\u8868\u60c5\u9884\u8bbe | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/integration-session-terminal.walk.mjs` | 1 | 1 | B | Error: \u6ca1\u6709\u771f\u5b9e\u8ba4\u8bc1\u8fc7\u7684\u9694\u79bb profile\uff1a/home/runner/work/Nomi/Nomi/artifacts/integration-session-terminal/profile-arm-a | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/local-gateway-onboarding.walk.mjs` | 1 | 33 | E | \u2717 failedImageEnabled | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/mcp-key-window.walk.mjs` | 1 | 51 | A | Error: MCP open_credentials should bring Settings to the front | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/model-availability-agreement.walk.mjs` | 1 | 8 | E | \u2713 \u6ca1\u94a5\u5319\uff1a\u76ee\u5f55\u91cc\u786e\u5b9e\u6709\u8fd9\u5bb6\u7684\u6a21\u578b\uff08\u5426\u5219\u6d4b\u7684\u662f\u300c\u7a7a\u76ee\u5f55\u300d\uff09 \u2014 \u76ee\u5f55=0/10 \u539f\u56e0=["credential_missing"] readiness=false \u8bbe\u7f6e\u9875=1 \u53ef\u4f7f\u7528/4 \u5f85\u8bbe\u7f6e | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/model-kind-misguess.walk.mjs` | 1 | 44 | A | \u8d70\u67e5\u5f02\u5e38\uff1a locator.click: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/narrowed-mode-guidance.walk.mjs` | 1 | 0 | E | throw new Error(`\u771f\u5b9e model-catalog.json \u4e0d\u5b58\u5728(${profile.catalogPath})\u2014\u2014\u88ab\u6d4b agent \u9700\u8981\u5df2\u914d\u7f6e\u7684\u6a21\u578b\u4e0e key`); | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/notification-policy.walk.mjs` | 1 | 33 | A | locator.click: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/onboarding-overlap.walk.mjs` | 1 | 32 | A | ExpectError: \u9009\u4e2d\u6587\u5b57\u540e\u300c\u62c6\u6210\u955c\u5934\xb7\u843d\u753b\u5e03\u300d\u6309\u94ae\u5e94\u51fa\u73b0\uff08StoryboardNudge \u8fbe\u9608\u503c\u6d6e\u51fa\uff09 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/pr720-language-switch-mid-session.walk.mjs` | 1 | 1 | B | throw new Error(`\u771f\u5b9e model-catalog.json \u4e0d\u5b58\u5728(${profile.catalogPath})\u2014\u2014\u88ab\u6d4b agent \u9700\u8981\u5df2\u914d\u7f6e\u7684\u6a21\u578b\u4e0e key`); | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/preview-export-busy.walk.mjs` | 124 | 600 | C | [walkthrough] content viewport {"width":1280,"height":933} | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/project-location-settings.walk.mjs` | 1 | 7 | E | \u9879\u76ee\u4f4d\u7f6e\u8d70\u67e5\u5931\u8d25: Error: \u8bbe\u7f6e\u9875\u663e\u793a\u5f53\u524d\u81ea\u5b9a\u4e49\u76ee\u5f55: /tmp/project-location-settings-SvUIla/projects | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/prompt-translate.walk.mjs` | 1 | 0 | B | if (!API_KEY) throw new Error('\u9700\u8981 DEEPSEEK_API_KEY\uff08\u771f\u5b9e\u6587\u672c\u6a21\u578b\u8d70\u67e5\uff0c\u4e0d\u8bb8 mock\uff09\uff1aset -a; . ~/.nomi-secrets.env; set +a') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/skill-cover-wall.walk.mjs` | 1 | 21 | C | Error: ENOENT: no such file or directory, open '/private/tmp/nomi-skill-ui-b-wall-dom.html' | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/skill-library-specimen.walk.mjs` | 1 | 13 | A | ExpectError: \u771f\u5b9e Electron \u5bbf\u4e3b\u5df2\u5c31\u7eea | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/storyboard-narrow-row.walk.mjs` | 1 | 15 | E | result: failed | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/storyboard-table-exec.walk.mjs` | 1 | 34 | A | expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/task-center-states.walk.mjs` | 1 | 9 | D | Expected: "\u53ea\u67e5\u7ed3\u679c\uff0c\u4e0d\u91cd\u65b0\u751f\u6210\uff0c\u4e0d\u82b1\u94b1" | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/vendor-baseurl-discoverability.walk.mjs` | 1 | 13 | D | ExpectError: \u2460 401 \u7684\u5bb6\u5728\u9996\u9875\u884c\u8981\u663e\u793a\u300c\u8fde\u4e0d\u4e0a\u300d\uff0c\u4e0d\u80fd\u53ea\u62a5\u6a21\u578b\u7edf\u8ba1 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/video-ops.walk.mjs` | 1 | 0 | B | \u7f3a .tmp/probe-12s.mp4\uff0c\u5148\u7528 ffmpeg \u9020\u4e00\u4e2a 12s mp4 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/agent-dock-dismiss.walk.mjs` | 1 | 2 | C | page.evaluate: SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document. | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/agent-panel-system-prompt.walk.mjs` | 1 | 7 | D | "error": "Error: system \u91cc\u7f3a\u5c11\u4e13\u957f\u5c42\u7684\u300ccreate_staging_reference\u300d\u2014\u2014\u50cf\u662f\u53ea\u5230\u4e86\u4e00\u90e8\u5206\uff0c\u68c0\u67e5\u662f\u5426\u88ab\u622a\u65ad\n\nexpect(received).toContain(expected) // indexOf\n\nExpected substring: \"create_staging_reference\"\nReceived string: \"\u56de\u590d\u8bed\u8a00\u | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-runtime-video-export.walk.mjs` | 1 | 0 | B | result.error = new ErrnoException(result.error, 'spawnSync ' + options.file); | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/agent-storyboard-real-model.walk.mjs` | 1 | 1 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/asset-audio-upload.walk.mjs` | 1 | 1 | B | \u7f3a .tmp/probe-tone-3s.{mp3,flac,m4a}\uff0c\u5148\u7528 ffmpeg \u9020\uff08\u89c1\u6587\u4ef6\u5934\u6ce8\u91ca\uff09 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/at-mention-edge.walk.mjs` | 1 | 15 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/browser-overlay-interaction.walk.mjs` | 1 | 23 | E | \u7d20\u6750\u76d2\u6d6e\u5c42\u8d70\u67e5\u5f02\u5e38: Error: overlay window never appeared | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-frame-real-task.walk.mjs` | 1 | 10 | E | if (!created) throw new Error(`${item.kind} \u8282\u70b9\u6ca1\u5efa\u51fa\u6765`) | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-shot-identity.walk.mjs` | 1 | 0 | B | Error: \u771f\u5b9e\u7d20\u6750\u7f3a\u5931\uff1a\u73af\u5883\u53d8\u91cf NOMI_REAL_MEDIA_DIR \u672a\u8bbe\u7f6e\u3002 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/composer-overlap-and-fast-typing.walk.mjs` | 1 | 0 | B | if (!API_KEY) throw new Error('\u9700\u8981 DEEPSEEK_API_KEY\uff08\u5916\u90e8\u6539\u5199\u8d70\u771f\u5b9e\u6587\u672c\u6a21\u578b\uff0c\u4e0d\u8bb8 mock\uff09\uff1aset -a; . ~/.nomi-secrets.env; set +a') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/credential-redirect.walk.mjs` | 1 | 1 | E | if (!fs.existsSync(file)) throw new Error(`\u771f\u5b9e\u8d44\u6599\u76ee\u5f55\u7f3a ${path.basename(file)}\uff08${file}\uff09\u2014\u2014${why}`) | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/deconstruction-panel.walk.mjs` | 1 | 36 | A | \u8d70\u67e5\u5f02\u5e38\uff1a ExpectError: \u57fa\u7ebf\u4e0d\u6210\u7acb\uff1a\u300c\u62c6\u89e3\u9762\u677f\u5360\u69fd\u65f6\u8fd9\u4e2a\u5b9a\u4f4d\u5668\u627e\u5f97\u5230\u5b83\u300d\u5e94\u5f53\u80fd\u88ab\u63a2\u9488\u627e\u5230\uff0c\u4f46\u4e00\u4e2a\u90fd\u6ca1\u627e\u5230\u3002 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/design-lab-ask-card-in-panel.walk.mjs` | 124 | 600 | C | # design lab \xb7 ask card inside the real panel | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/design-lab-node-composer-bar.walk.mjs` | 1 | 45 | E | \u25b6 \u751f\u6210 tailwind \u4ea7\u7269\u2026 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/design-lab-settings.walk.mjs` | 1 | 51 | E | \u2713 privacy-04-failed 516\xd7480 \u5bfc\u51fa\u5931\u8d25 \xb7 \u7ed3\u679c\u884c\u8bf4\u4eba\u8bdd\u5e76\u8bf7\u518d\u8bd5 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-3dbox-shell.walk.mjs` | 1 | 0 | E | Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/Nomi/Nomi/electron/shared/director/vocab' imported from /home/runner/work/Nomi/Nomi/evals/director/s1OraclePlans.ts | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-electron.walk.mjs` | 1 | 114 | A | locator.innerText: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/director-refine-tasks.walk.mjs` | 1 | 132 | E | \u2713 \u5ead\u9662\u5bf9\u5cd9\u7ecf\u73b0\u5f79\u7f16\u8bd1\u5668\u7f16\u51fa \u2014 {"ok":true} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/editing-panel-system.walk.mjs` | 1 | 16 | E | if (failed.length > 0) throw new Error(`\u526a\u8f91\u9762\u677f\u7cfb\u7edf\u8d70\u67e5\u6709 ${failed.length} \u6761\u4e0d\u8fbe\u5408\u540c\uff1a${failed.map(([name]) => name).join(' / ')}`) | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/feedback-batch-hardening.walk.mjs` | 1 | 67 | A | locator.click: Timeout 30000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/focus-indication.walk.mjs` | 1 | 11 | A | "error": "Error: settings-budget\n\nexpect(locator).toBeVisible() failed\n\nLocator: getByRole('dialog', { name: '\u8bbe\u7f6e', exact: true }).locator('[data-settings-field=\"hard-budget\"]')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n - Expect \"to.be.visible\" with timeout 5000ms\n - waiting for getByRole('dialog', { na | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/library-language-switcher.walk.mjs` | 1 | 16 | A | locator.click: Timeout 6000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/local-model-connect.walk.mjs` | 1 | 14 | A | ExpectError: \u70b9\u4e0d\u5230\u300c\u8fde\u63a5\u52a9\u624b\u6a21\u578b\u5165\u53e3\u300d\uff1a\u7b49\u6ee1 8000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/new-models-20260729.walk.mjs` | 1 | 0 | C | Error: ENOENT: no such file or directory, open '/Users/aoqimin/Documents/Nomi Projects/\u672a\u547d\u540d\u9879\u76ee 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json' | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/node-prompt-presets.walk.mjs` | 1 | 17 | D | ExpectError: expect(received).toBeGreaterThan(expected) | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/omni-video-reference-gate.walk.mjs` | 1 | 37 | A | expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/plan-gate.walk.mjs` | 1 | 9 | E | [16017:1008/011624.548927:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/pr720-prompt-language.walk.mjs` | 1 | 0 | B | \u2716 \u8d70\u67e5\u4e2d\u65ad\uff1aError: \u771f\u5b9e model-catalog.json \u4e0d\u5b58\u5728(/home/runner/.config/nomi/model-catalog.json)\u2014\u2014\u88ab\u6d4b agent \u9700\u8981\u5df2\u914d\u7f6e\u7684\u6a21\u578b\u4e0e key | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/provider-adapter-doctor.walk.mjs` | 1 | 0 | B | throw new Error('Set NOMI_ADAPTER_UI_USERDATA to a completed live adapter harness directory') | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/reference-capture.walk.mjs` | 1 | 37 | E | \xb7 shot 09-actionable-download-error | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/runway-vendor-honest-modes.walk.mjs` | 1 | 4 | E | page.evaluate: Error: \u5bc6\u94a5\u9a8c\u8bc1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5bc6\u94a5\u548c\u6743\u9650\u540e\u91cd\u8bd5\u3002 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/shot-cut-empty-states.walk.mjs` | 1 | 23 | A | ExpectError: \u70b9\u4e0d\u5230\u300cnode-strong \u7684\u300c\u6309\u955c\u5934\u62c6\u300d\u300d\uff1a\u7b49\u6ee1 15000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/skill-import-formats.walk.mjs` | 1 | 7 | E | if (!fs.existsSync(refPath)) throw new Error('zip \u91cc\u7684 references/ \u5b50\u76ee\u5f55\u6ca1\u843d\u76d8\uff08\u5b50\u76ee\u5f55\u88ab\u524a\u5e73\u4e86\uff09') | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/storyboard-reference-slots.walk.mjs` | 1 | 34 | A | result: failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/storyboard-table-phasec.walk.mjs` | 1 | 34 | A | result: failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/tikhub-connector.walk.mjs` | 1 | 27 | B | ExpectError: \u7d20\u6750\u5e93\u5de5\u5177\u884c\u6ca1\u6709\u300c\u8d34\u94fe\u63a5\u5bfc\u5165\u300d\u5165\u53e3 | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/vendor-connection-health.walk.mjs` | 1 | 12 | E | mock \u4e0a\u6e38: http://127.0.0.1:45001 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/vendor-validation-error-persistence.walk.mjs` | 1 | 7 | A | locator.click: Timeout 5000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/video-playback-heal.walk.mjs` | 1 | 38 | A | \u2713 \u524d\u63d0\u6210\u7acb\uff1a\u539f\u59cb AVI \u5728 Electron \u91cc\u64ad\u4e0d\u4e86\uff08error:4\uff09 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/windows-freeze-sweep.walk.mjs` | 1 | 124 | A | \u2716 \u65b0\u5efa\u56fe\u7247\u8282\u70b9 \u2192 \u751f\u6210\uff08\u7b49\u5f85\u52a8\u6548\u5728\u8dd1\uff09 \u2014 \u5e27\u95f4\u9694 117ms \xb7 \u4e3b\u8fdb\u7a0b 20ms \xb7 \u62a5\u9519 locator.waitFor: Timeout 30000ms exceeded. [06.png] | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-artifact.walk.mjs` | 1 | 248 | A | expect(locator).toBeVisible() failed | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-inflight-shots-reload.walk.mjs` | 1 | 23 | A | "error": "Error: \u70b9\u4e0d\u5230\u300c\u5361\u4e0a\u7684\u8303\u56f4\u5207\u5230\u300c\u5168\u90e8\u300d\u300d\uff1a\u7b49\u6ee1 15000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002\n\u8981\u4e48\u8fd9\u4e00\u5c4f\u6839\u672c\u6ca1\u8d70\u5230\uff08\u4e0a\u4e00\u6b65\u5176\u5b9e\u5931\u8d25\u4e86\uff09\uff0c\u8981\u4e48\u5b9a\u4f4d\u5668\u5df2\u7ecf\u8fc7\u671f\u | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-panel-form.walk.mjs` | 1 | 2 | C | page.evaluate: SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document. | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/agent-process-tone.walk.mjs` | 1 | 37 | A | "error": "locator.evaluate: Timeout 30000ms exceeded.\nCall log:\n - waiting for locator('[data-v4-block=\"process\"]').locator('[data-v4-block=\"tool\"] > summary').first()\n\n at /home/runner/work/Nomi/Nomi/tests/ux/agent-process-tone.walk.mjs:41:24" | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/agent-runtime-editing.walk.mjs` | 1 | 12 | D | "error": "Error: expect(locator).toContainText(expected) failed\n\nLocator: locator('[aria-label=\"\u521b\u4f5c\u6587\u6863\u7f16\u8f91\u533a\"] .tiptap[contenteditable=\"true\"]')\nExpected substring: \"FAPPROVEDAPPEND\uff1a\u5979\u6309\u4e0b\u5f55\u5236\u952e\u3002\"\nReceived string: \"\u6e05\u6668\uff0c\u521b\u4f5c\u8005\u6253\u5f00\u5496\u5561\u9986\u76 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-single-shot-skill-boundary.walk.mjs` | 1 | 5 | D | "error": "Error: expect(received).toMatchObject(expected)\n\n- Expected - 1\n+ Received + 0\n\n Object {\n- \"message\": \"agent_skill_unavailable\",\n \"ok\": false,\n }\n at captureRawStack (/home/runner/work/Nomi/Nomi/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/lib/coreBundle.js:3130:17)\n at callMatcherAsStep (/home/runner/work | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-spend-priced-card.walk.mjs` | 1 | 24 | D | "error": "Error: \u6309\u4e0b\u5e26\u4ef7\u683c\u7684\u4e3b\u6309\u94ae\u4e4b\u540e\uff0c\u4f9b\u5e94\u5546\u5fc5\u987b\u771f\u7684\u6536\u5230\u4e00\u6b21\u751f\u6210\u8bf7\u6c42\n\n\u6309\u4e0b\u5e26\u4ef7\u683c\u7684\u4e3b\u6309\u94ae\u4e4b\u540e\uff0c\u4f9b\u5e94\u5546\u5fc5\u987b\u771f\u7684\u6536\u5230\u4e00\u6b21\u751f\u6210\u8bf7\u6c42\n\nexpect(rece | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-thinking-overlap.walk.mjs` | 1 | 15 | D | "error": "Error: expect(locator).toHaveCount(expected) failed\n\nLocator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\"generation\"]').locator('[data-v4-block=\"thinking\"] details')\nExpected: 2\nReceived: 1\nTimeout: 5000ms\n\nCall log:\n - Expect \"to.have.count\" with timeout 5000ms\n - waiting for locator('[dat | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/agent-trace-log.walk.mjs` | 124 | 600 | C | "error": "Error: Timed out waiting for the actual Electron process to close\n at Timeout.<anonymous> (file:///home/runner/work/Nomi/Nomi/tests/ux/agent-runtime-walk-support.mjs:165:41)\n at listOnTimeout (node:internal/timers:685:17)\n at process.processTimers (node:internal/timers:618:7)" | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/agent-ui-exception-states-runtime.walk.mjs` | 1 | 36 | A | "error": "locator.click: Timeout 30000ms exceeded.\nCall log:\n - waiting for locator('[data-agent-resident=\"true\"][data-agent-collapsed=\"true\"] [data-agent-topbar-badge=\"true\"] button').first()\n\n at /home/runner/work/Nomi/Nomi/tests/ux/agent-ui-exception-states-runtime.walk.mjs:122:76" | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/anchor-real.walk.mjs` | 1 | 33 | A | ExpectError: \u65e7\u884c\u4e3a\u951a\u672a\u6d88\u8d39 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/asset-library-interactions.walk.mjs` | 1 | 52 | E | [walkthrough] content viewport {"width":1440,"height":900} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/asset-transport-settings.walk.mjs` | 1 | 7 | E | \u8d44\u4ea7\u4e0a\u4f20\u8bbe\u7f6e\u8d70\u67e5\u5931\u8d25: Error: \u660e\u786e\u8bf4\u660e\u4e0a\u4f20\u514d\u8d39: \u7d20\u6750\u4e0a\u4f20\u901a\u9053 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-control-clarity.walk.mjs` | 1 | 8 | E | page.evaluate: Error: \u5bc6\u94a5\u9a8c\u8bc1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5bc6\u94a5\u548c\u6743\u9650\u540e\u91cd\u8bd5\u3002 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-frame.walk.mjs` | 1 | 9 | E | if (!created) throw new Error(`\u7b2c ${index + 1} \u4e2a\u89c6\u9891\u8282\u70b9\u6ca1\u5efa\u51fa\u6765`) | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-s5-walkthrough.walk.mjs` | 1 | 23 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/canvas-three-gestures.walk.mjs` | 1 | 3 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/comfy-workflow-feedback.walk.mjs` | 1 | 19 | D | ExpectError: expect(received).toBe(expected) // Object.is equality | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/creation-flow-fixes.walk.mjs` | 1 | 22 | A | ExpectError: \u5bf9\u8bdd\u91cc\u6ca1\u6e32\u67d3\u51fa\u5206\u955c\u65b9\u6848\u5361 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/credential-connect-honesty.walk.mjs` | 1 | 3 | E | \u2716 page.evaluate: Error: \u5bc6\u94a5\u9a8c\u8bc1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5bc6\u94a5\u548c\u6743\u9650\u540e\u91cd\u8bd5\u3002 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/dark-journey.walk.mjs` | 1 | 25 | A | ExpectError: \u70b9\u4e0d\u5230\u300c\u5bfc\u51fa MP4\u300d\uff1a\u7b49\u6ee1 15000ms \u5b83\u90fd\u6ca1\u53ef\u89c1\u3002 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/director-ai.walk.mjs` | 1 | 21 | D | \u2717 AI\u8d70\u67e5\u4e2d\u65ad\uff1aError: expect(locator).toBeDisabled() failed | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/director-fields.walk.mjs` | 1 | 7 | E | node:internal/modules/run_main:107 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-timeline-pointer.walk.mjs` | 1 | 1 | E | node:internal/modules/run_main:107 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/director-waypoint-aim.walk.mjs` | 1 | 1 | E | node:internal/modules/run_main:107 | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/editing-real-user-pass.walk.mjs` | 124 | 600 | C | [walkthrough] content viewport {"width":1280,"height":933} | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/feedback-loop-consent-and-report.walk.mjs` | 1 | 29 | E | FEEDBACK LOOP WALK FAIL: Error: \u5185\u8054\u884c\u5e94\u5f53\u8bf4\u6e05\u662f\u88ab\u62d2\u4e86\uff1a"\u300cnomi-feedback-loop-rejected.txt\u300d\u4e0d\u662f Nomi \u8ba4\u5f97\u7684\u5a92\u4f53\u683c\u5f0f\n\n\u53cd\u9988\u95ee\u9898"; \u6458\u8981\u5e94\u5f53\u6d3e\u751f\u81ea\u5bfc\u5165\u88ab\u62d2\u90a3\u53e5\u4eba\u8bdd\uff0c\u5b9e\u9645\uff1a"\u300c | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/image-grid-split-freeze.walk.mjs` | 1 | 73 | D | \u274c \u8d70\u67e5\u4e2d\u65ad\uff1aError: \u8282\u70b9\u56fe\u6ca1\u89e3\u7801\u5230\u539f\u59cb\u5c3a\u5bf8 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/layout-timeline-panel-span.walk.mjs` | 1 | 6 | D | ExpectError: \u2462b videoTrack \u88ab\u8f68\u9053\u89c6\u53e3\u88c1\u6389\u4e86\u2014\u2014\u9ed8\u8ba4\u9ad8\u5ea6\u88c5\u4e0d\u4e0b\u4e24\u6761\u4e3b\u8f68\uff08row.bottom=912 viewport.bottom=907\uff09 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/mcp-client-activation.walk.mjs` | 1 | 1 | B | if (!fs.existsSync(executablePath)) throw new Error(`Installed Nomi executable not found: ${executablePath}`) | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/media-import-matrix.walk.mjs` | 1 | 28 | B | library-upload/png-small/fixture-missing/0ms/none//Users/aoqimin/Desktop/nomi-media-fixtures/small.png | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/model-pick-confirm.walk.mjs` | 1 | 11 | A | locator.click: Timeout 4000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/node-actions-off-image.walk.mjs` | 1 | 25 | E | [walkthrough] content viewport {"width":1280,"height":933} | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/node-toolbar-one-row.walk.mjs` | 1 | 28 | D | ExpectError: \u70b9\u300c\u9996\u5e27\u300d\u540e\u591a\u51fa\u4e00\u4e2a\u8282\u70b9 | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/onboarding-auto-fetch.walk.mjs` | 1 | 9 | E | [newapi-mock] listening http://localhost:8798 (video done after 1 poll) | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/param-bar-geometry.walk.mjs` | 1 | 0 | C | Error: ENOENT: no such file or directory, open '/Users/aoqimin/Documents/Nomi Projects/\u672a\u547d\u540d\u9879\u76ee 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json' | Fix the shared harness/runtime and rerun 3-5 representative walks; prove there is no silent skip. |
| `tests/ux/pr619-reference-task.walk.mjs` | 1 | 1 | B | AssertionError [ERR_ASSERTION]: TIKHUB_API_KEY is required; this task cannot be validated with fixtures | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/pr720-ux-geometry.walk.mjs` | 1 | 0 | B | throw new Error(`\u771f\u5b9e model-catalog.json \u4e0d\u5b58\u5728(${profile.catalogPath})\u2014\u2014\u88ab\u6d4b agent \u9700\u8981\u5df2\u914d\u7f6e\u7684\u6a21\u578b\u4e0e key`); | Keep it out of CI via the registry; run it separately with its real credentials, fixtures, or platform. |
| `tests/ux/production-stalled-draft.walk.mjs` | 1 | 27 | E | \u2705 \u2460 \u672a\u5b9e\u73b0\u7684 playbook \u5f53\u573a\u88ab\u62d2\uff0c\u4e14\u9519\u8bef\u8bf4\u6e05\u4e86\u300c\u4f20\u7684\u662f\u4ec0\u4e48\u300d\u300c\u53ef\u7528\u7684\u662f\u4ec0\u4e48\u300d \u2014\u2014 Error invoking remote method 'nomi:production-runs:create-draft': Error: playbook\u300cfilm.scene-recreation\u300d\u4e0d\u5b58\u5728\u3002\u5f | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/provider-model-discovery.walk.mjs` | 1 | 5 | D | ExpectError: expect(received).toBe(expected) // Object.is equality | Reproduce the product state, inspect the shared boundary, and add behavior evidence before changing code. |
| `tests/ux/shot-cuts.walk.mjs` | 1 | 22 | A | locator.click: Timeout 5000ms exceeded. | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/stage4-switch.walk.mjs` | 1 | 21 | A | "error": "Error: \u57fa\u7ebf\u4e0d\u6210\u7acb\uff1a\u300creal lane approval is visible before the document changes\u300d\u5e94\u5f53\u80fd\u88ab\u63a2\u9488\u627e\u5230\uff0c\u4f46\u4e00\u4e2a\u90fd\u6ca1\u627e\u5230\u3002\n\u5982\u679c\u8fde\u5b83\u90fd\u627e\u4e0d\u5230\uff0c\u8bf4\u660e\u9762\u677f\u6ca1\u6e32\u67d3 / \u9009\u62e9\u5668\u5199\u9519\u4e8 | Update the walkthrough against the current production entry, copy, and selector; add one stable entry assertion. |
| `tests/ux/timeline-context-menu.walk.mjs` | 1 | 7 | E | \xb7 \u622a\u56fe 99-error.png | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |
| `tests/ux/vendor-connection-identity.walk.mjs` | 1 | 41 | E | TypeError: Cannot read properties of undefined (reading 'key') | Add a minimal reproduction plus screenshot or state snapshot before deciding; do not change product code from this log alone. |

## A list (not fixed one by one on this branch)

- `tests/ux/agent-runtime-production.walk.mjs`
- `tests/ux/agent-spend-card.walk.mjs`
- `tests/ux/agent-spend-reprice.walk.mjs`
- `tests/ux/agent-thinking-rows.walk.mjs`
- `tests/ux/asset-video-preview.walk.mjs`
- `tests/ux/audio-reference-connect.walk.mjs`
- `tests/ux/comfy-workflow-multiref.walk.mjs`
- `tests/ux/creation-pill-overlap.walk.mjs`
- `tests/ux/default-generation-model.walk.mjs`
- `tests/ux/director-ual-crowd.walk.mjs`
- `tests/ux/feedback-share-center.walk.mjs`
- `tests/ux/mcp-connection-truthfulness.walk.mjs`
- `tests/ux/model-contract-limits.walk.mjs`
- `tests/ux/multi-user-isolation.walk.mjs`
- `tests/ux/node-composer-placement.walk.mjs`
- `tests/ux/onboarding-checkmark-honesty.walk.mjs`
- `tests/ux/project-asset-healthcheck.walk.mjs`
- `tests/ux/provider-proxy-field.walk.mjs`
- `tests/ux/storyboard-anchor-policy.walk.mjs`
- `tests/ux/storyboard-model-same-name.walk.mjs`
- `tests/ux/telemetry-consent.walk.mjs`
- `tests/ux/toolbar-order.walk.mjs`
- `tests/ux/video-depth-real-task.walk.mjs`
- `tests/ux/agent-spend-confirm-executes.walk.mjs`
- `tests/ux/agent-timeline-ops.walk.mjs`
- `tests/ux/agent-v4-short-film.walk.mjs`
- `tests/ux/f3-f16b.walk.mjs`
- `tests/ux/mcp-key-window.walk.mjs`
- `tests/ux/model-kind-misguess.walk.mjs`
- `tests/ux/notification-policy.walk.mjs`
- `tests/ux/onboarding-overlap.walk.mjs`
- `tests/ux/skill-library-specimen.walk.mjs`
- `tests/ux/storyboard-table-exec.walk.mjs`
- `tests/ux/deconstruction-panel.walk.mjs`
- `tests/ux/director-electron.walk.mjs`
- `tests/ux/feedback-batch-hardening.walk.mjs`
- `tests/ux/focus-indication.walk.mjs`
- `tests/ux/library-language-switcher.walk.mjs`
- `tests/ux/local-model-connect.walk.mjs`
- `tests/ux/omni-video-reference-gate.walk.mjs`
- `tests/ux/shot-cut-empty-states.walk.mjs`
- `tests/ux/storyboard-reference-slots.walk.mjs`
- `tests/ux/storyboard-table-phasec.walk.mjs`
- `tests/ux/vendor-validation-error-persistence.walk.mjs`
- `tests/ux/video-playback-heal.walk.mjs`
- `tests/ux/windows-freeze-sweep.walk.mjs`
- `tests/ux/agent-artifact.walk.mjs`
- `tests/ux/agent-inflight-shots-reload.walk.mjs`
- `tests/ux/agent-process-tone.walk.mjs`
- `tests/ux/agent-ui-exception-states-runtime.walk.mjs`
- `tests/ux/anchor-real.walk.mjs`
- `tests/ux/creation-flow-fixes.walk.mjs`
- `tests/ux/dark-journey.walk.mjs`
- `tests/ux/model-pick-confirm.walk.mjs`
- `tests/ux/shot-cuts.walk.mjs`
- `tests/ux/stage4-switch.walk.mjs`

## D list (evidence only; no fixes)

- `tests/ux/agent-lane-deletion.walk.mjs`
- `tests/ux/agent-v4-retry-storm.walk.mjs`
- `tests/ux/credential-offline.walk.mjs`
- `tests/ux/prompt-picker.walk.mjs`
- `tests/ux/skill-library-cards.walk.mjs`
- `tests/ux/timeline-toolbar-row.walk.mjs`
- `tests/ux/agent-panel-missing-card.walk.mjs`
- `tests/ux/agent-queued-shot-not-regenerable.walk.mjs`
- `tests/ux/agent-spend-stop-midway.walk.mjs`
- `tests/ux/assisted-onboarding-entry.walk.mjs`
- `tests/ux/card12-draft-shots-performance.walk.mjs`
- `tests/ux/task-center-states.walk.mjs`
- `tests/ux/vendor-baseurl-discoverability.walk.mjs`
- `tests/ux/agent-panel-system-prompt.walk.mjs`
- `tests/ux/node-prompt-presets.walk.mjs`
- `tests/ux/agent-runtime-editing.walk.mjs`
- `tests/ux/agent-single-shot-skill-boundary.walk.mjs`
- `tests/ux/agent-spend-priced-card.walk.mjs`
- `tests/ux/agent-thinking-overlap.walk.mjs`
- `tests/ux/comfy-workflow-feedback.walk.mjs`
- `tests/ux/director-ai.walk.mjs`
- `tests/ux/image-grid-split-freeze.walk.mjs`
- `tests/ux/layout-timeline-panel-span.walk.mjs`
- `tests/ux/node-toolbar-one-row.walk.mjs`
- `tests/ux/provider-model-discovery.walk.mjs`

## E list

- `tests/ux/agent-panel-mechanics.walk.mjs`
- `tests/ux/asset-library-native-import.walk.mjs`
- `tests/ux/control-hierarchy-u2.walk.mjs`
- `tests/ux/director-assets.walk.mjs`
- `tests/ux/director-j5-splat-valley.walk.mjs`
- `tests/ux/mention-scope.walk.mjs`
- `tests/ux/rich-editor-p1.walk.mjs`
- `tests/ux/vendor-honest-variant-axis.walk.mjs`
- `tests/ux/volcengine-speech-credential.walk.mjs`
- `tests/ux/agent-storyboard-generate-confirm.walk.mjs`
- `tests/ux/arrange-draft-cta.walk.mjs`
- `tests/ux/audio-timeline.walk.mjs`
- `tests/ux/composer-long-prompt.walk.mjs`
- `tests/ux/design-lab-catalog-liveness.walk.mjs`
- `tests/ux/director-j6-outputs.walk.mjs`
- `tests/ux/i18n-sweep.walk.mjs`
- `tests/ux/local-gateway-onboarding.walk.mjs`
- `tests/ux/model-availability-agreement.walk.mjs`
- `tests/ux/narrowed-mode-guidance.walk.mjs`
- `tests/ux/project-location-settings.walk.mjs`
- `tests/ux/storyboard-narrow-row.walk.mjs`
- `tests/ux/at-mention-edge.walk.mjs`
- `tests/ux/browser-overlay-interaction.walk.mjs`
- `tests/ux/canvas-frame-real-task.walk.mjs`
- `tests/ux/credential-redirect.walk.mjs`
- `tests/ux/design-lab-node-composer-bar.walk.mjs`
- `tests/ux/design-lab-settings.walk.mjs`
- `tests/ux/director-3dbox-shell.walk.mjs`
- `tests/ux/director-refine-tasks.walk.mjs`
- `tests/ux/editing-panel-system.walk.mjs`
- `tests/ux/plan-gate.walk.mjs`
- `tests/ux/reference-capture.walk.mjs`
- `tests/ux/runway-vendor-honest-modes.walk.mjs`
- `tests/ux/skill-import-formats.walk.mjs`
- `tests/ux/vendor-connection-health.walk.mjs`
- `tests/ux/asset-library-interactions.walk.mjs`
- `tests/ux/asset-transport-settings.walk.mjs`
- `tests/ux/canvas-control-clarity.walk.mjs`
- `tests/ux/canvas-frame.walk.mjs`
- `tests/ux/canvas-s5-walkthrough.walk.mjs`
- `tests/ux/canvas-three-gestures.walk.mjs`
- `tests/ux/credential-connect-honesty.walk.mjs`
- `tests/ux/director-fields.walk.mjs`
- `tests/ux/director-timeline-pointer.walk.mjs`
- `tests/ux/director-waypoint-aim.walk.mjs`
- `tests/ux/feedback-loop-consent-and-report.walk.mjs`
- `tests/ux/node-actions-off-image.walk.mjs`
- `tests/ux/onboarding-auto-fetch.walk.mjs`
- `tests/ux/production-stalled-draft.walk.mjs`
- `tests/ux/timeline-context-menu.walk.mjs`
- `tests/ux/vendor-connection-identity.walk.mjs`

## C fixes made on this branch

- `.github/workflows/nightly-walkthroughs.yml`: the `report` job now checks out the repository and installs Node 24 before running `scripts/nightly-walk-summary.mjs`.
- Nightly execution now calls `scripts/nightly-walk-selection.mjs`, which reads `tests/ux/nightly-ci-exclusions.json` so B-category walks are recorded and removed from CI selection.
- `scripts/check-quality-gate-workflow.node-test.mjs`: added a cross-workflow assertion that every job executing a `scripts/` file checks out first.
