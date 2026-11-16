# Native multimodal model input

Owner: coordinator; implementation branches: native-media-input / native-media-transport.
Categories: new feature, Agent behavior, long-running/cancellable model requests. Existing composer and model settings controls are reused; no new screen or layout.

## ★0 Prior art

- https://ai.google.dev/api/generate-content — native parts accept inlineData/fileData for audio and video; use typed original media, never transcript/frame substitution.
- https://ai.google.dev/gemini-api/docs/openai — input_audio is supported by the compatibility API; retain explicit protocol capability checks instead of assuming all compatible servers support video.
- https://github.com/googleapis/js-genai — HttpOptions.fetch in 2.32.0 allows the existing Nomi transport; patch the pinned pi adapter to pass it rather than replace the streaming engine.
- https://ai.google.dev/gemini-api/docs/files — file references have provider scope/lifetime; initial implementation uses bounded inline originals and fails with an actionable limit error instead of silently summarizing.
- 出口：https://ai.google.dev/gemini-api/docs/files · 大文件由供应商 File API 上传后继续请求，内联请求受大小限制 · 本次保留既有取消与失败入口，用户可以移除超限媒体或切换支持的模型重试；尚未实现 File API 时明确报错，不以概要替代。

## ★1 User outcome

When a creator attaches original audio/video and selects a model declaring those input capabilities, the model receives those original bytes alongside text/images, can answer and continue the conversation, and never claims to have read media it did not receive. Steps: configure protocol/capabilities, select model, attach originals, send, read streamed response, follow up or cancel. No automatic transcription, extracted-frame substitute, or summary fallback.

Tests/metrics: request-boundary integration tests must observe exact media bytes and MIME for mixed input and follow-up; incompatible/oversized inputs must cause zero network calls; existing image/PDF/text tests must remain green. Real provider validation uses the user's previously supplied relay credential only in memory and is recorded separately from loopback tests. Long media exceeding the documented inline request limit is explicitly unsupported until provider-scoped uploads are available.

### ★1b Surfaces

Reuse model protocol and capability settings and existing chat attachment chips/error surface. Use existing cancellation controls. Errors name unsupported media or size and the next action; no false success.

### ★1c Existing users

Existing provider protocol and image/PDF behavior remain valid. New input capabilities are optional and default conservatively; metadata is additive. Native media bytes never enter persisted conversation records; existing asset identity remains the persistence owner. Older builds can still open projects and ignore new metadata.

## ★2 Ownership

Model input capability normalization owns supported media; main-process asset resolution owns file identity/bytes; the shared native-file payload boundary owns protocol serialization and aggregate size validation. Both Agent and single-shot/text tasks use it. pi remains owner of streaming, tools, usage, and thought-signature replay. Door-map evidence is recorded before implementation.

## ★3 Alternatives

Keep compatible-only inputs: cannot reliably represent native video. Replace the full streaming engine: duplicates mature tool/reasoning/cancellation logic. Chosen: reuse pi Google adapter, pass existing transport through the SDK's supported fetch option, and extend the existing PDF payload boundary to typed original files. Remove obsolete audio/video skipping when native support is declared. Explicitly unsupported protocols still reject media instead of dropping content.

## ★4 States

Empty/text-only unchanged; reading media resolves main-owned asset identities; success streams the model answer; unreadable/unsupported/oversized files fail explicitly before network; partial media reads fail the request rather than silently omit one; cancellation uses existing signal; stale/missing originals request reattachment. No implicit conversion.

## 5 Interruptions

Before send: cancel/close causes no submission. Reading/encoding: abort prevents dispatch. In flight: AbortSignal reaches the SDK and fetch; existing billing semantics apply. Disconnect reports transport failure. Restart preserves asset references only and reconstructs bytes from the project. Repeated clicks use existing admission/order control.

## 6 External boundaries

Google native SDK serializes original media parts. Existing OpenAI/Anthropic protocols retain their documented shape. No arbitrary URL fetch or file path introduced by a model; use resolved Nomi assets. Validate MIME and aggregate encoded request size including history; failures use existing error presentation and never expose credentials or base64 media.

## ★7 Performance

New operation: resolve/encode bounded originals at send time, not during typing or metadata listing. Bound inline requests conservatively to 20 MiB including encoded media/history; avoid repeated encoding within a request. Measure mixed-media preparation with a repeatable performance test and register the scenario using the repository harness where supported. Network generation latency is not a UI responsiveness claim.

## 8 Real conditions

Windows local checkout; loopback SDK request tests exercise real serialization/streaming. Real relay request and packaged UI checks are recorded as verified/unverified separately. Do not report loopback success as real provider compatibility.

## ★9 Acceptance and counterexamples

- Text, image, audio and video can coexist in the native request with exact original bytes and MIME.
- Tool call continuation and follow-up preserve media bindings without persisting base64 in chat.
- Unsupported media/protocol fails before fetch; no filename-only response presented as analysis.
- Aggregate size counts multiple files and history; boundary/over-boundary covered.
- Unreadable originals, MIME mismatch, cancellation and provider errors are explicit.
- Existing text/image/PDF and existing provider protocol tests continue to pass.
- Rollback: revert this feature commit/branch; additive metadata and original project asset references remain readable.

## Verification log

- Integrated feature branch `codex/native-multimodal-input`; source base `23fe401788cdaf95ac19dfd87f31957d668d069f` from the user's fork.
- 17 focused/regression Vitest files: 271 tests passed; 7 compiled agent-runtime/PDF/compaction tests passed.
- Independent review: `2026-11-09-native-multimodal-independent-review.md`, 41 additional focused acceptance assertions, including actual AgentHarness mixed media and follow-up.
- `pnpm run typecheck`: app, Electron, pi, fixtures and test type gates passed (existing unrelated test baseline remains unchanged).
- `pnpm run build`: renderer and Electron build passed. Modified production ESLint passed after adding the native auth-header callback dependency.
- Credential-origin, outbound-policy, framework-boundary, supply-chain pins, self-written, i18n and performance registry checks passed. Root-cause contract schema passed; its two type-only contract files have no runtime caller door to count.
- Performance scenario `native-media-inline-14m`: 5 runs, median 59.9 ms / p95 65.1 ms / budget 100 ms. Raw report `native-media-performance-final.json`.
- Isolated real Windows development build UI visited through actual settings navigation in zh-CN and en; screenshots `native-input-ui/zh-CN.png` and `native-input-ui/en.png` opened and visually inspected.
- Repeatable UI walk `node tests/ux/native-multimodal-input.walk.mjs` toggles audio capability off/on, saves through the production catalog, reads it back and reopens the editor in both languages. Report `native-input-ui/report.json`. The existing test launcher used its forced process cleanup after its normal close timeout; this is not a graceful-shutdown verification.
- One real production compiled model-call to `gemini-4-argon` succeeded. Actual outgoing request contained image/png, audio/wav and video/mp4 originals (2,750,711 bytes); response terminated normally. Raw facts and limitations in `native-input-live-result.json`. The near-silent audio does not establish speech recognition quality; this test verifies provider acceptance and original-media transport.
- No installer/release artifact produced; no claim of merged upstream status. Large-file File API uploads remain outside this inline implementation.

### Expanded regression limits

Expanded directory run covered 314 files: 308 passed; 5,824 tests passed and 6 tests failed, plus one suite could not load an excluded media fixture. Restoring the tracked `tests/ux/fixtures/real-narration.mp3` and rerunning both old-user upgrade suites passed all 5 tests, including the earlier Windows teardown failure.

The remaining failures are in unchanged test/production files: `codexCli.test.ts` (two Windows home-directory expectations), `multiOutputMapping.test.ts` (forward-slash expectation versus Windows path separators), `operationLedger.test.ts` (POSIX permission bits on Windows), and `certificationMedia.test.ts` (Windows symlink privilege). This is not a claim of an entirely green repository-wide run. These environment/test-compatibility findings were not modified as part of the native media feature.
