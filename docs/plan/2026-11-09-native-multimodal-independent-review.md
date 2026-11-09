已独立复核下述工作区快照：7 个目标测试文件、41 项测试通过，未发现尚未处理的代码阻断项；发布仍应保持 DRAFT，不能据此宣称完整任务已验收。

# Native multimodal input: independent review

Reviewer: `native_input_acceptance` (independent of the input, transport and configuration implementation agents).

验收线：`native_input_acceptance`。

验收 HEAD：`93244c70c86452aafd4364f4f62531b70e200d12`。This is the actual HEAD read immediately before the refreshed tests on Windows on 2026-11-09, not a claim that the working tree was clean or that a later publication commit was audited.

The following six paths had uncommitted changes when the tests ran; their diffs were inspected as part of this refreshed acceptance snapshot:

- `docs/plan/2026-11-09-native-multimodal-input.md`
- `electron/agentLane/laneHost.mts`
- `electron/catalog/catalogStore.ts`
- `electron/providerAdapter/liveHarness.ts`
- `src/ui/onboarding/ModelCapabilityEditor.nativeInput.test.tsx`
- `src/ui/onboarding/ModelCapabilityEditor.tsx`

This report is the seventh modified path after this documentation-only update. The reviewed production maintenance changes consolidate imports/an inferred return type and preserve the same auth selection, while the UI change reuses `V4Row`; the UI test replaces untyped mock props with explicit types. The test run includes those working-tree changes. A subsequent commit will have a different SHA and must not be described as this report's reviewed HEAD without separate verification.

The final status read also showed the newly created, untracked `docs/plan/2026-11-09-native-multimodal-publish-checks.md`. That publication note appeared after the test-start snapshot and is outside this independent code/test review.

Scope: verify that selected original audio/video bytes reach the model alongside text/images, that invalid inputs fail before dispatch, and that follow-up/history, protocol configuration and existing transport controls remain meaningful. This report does not declare the complete feature delivered.

## Reproducible validation

From the root worktree:

```powershell
Set-Location 'C:\Users\admin\Documents\ChatGPT\Nomi-native-multimodal'
pnpm exec vitest run electron/agentLane/nativeMultimodal.integration.test.ts electron/agentLane/laneNativeMediaInput.test.ts electron/agentLane/laneGoogleTransport.test.ts electron/shared/textModelInput.test.ts src/ui/onboarding/ModelCapabilityEditor.nativeInput.test.tsx electron/ai/nativeFilePayload.test.ts electron/textTaskNativeMedia.test.ts
git diff --check
```

Observed refreshed result at **2026-11-09 18:08:07 Asia/Shanghai**: **7 test files passed, 41 tests passed**, duration 5.22 seconds (tests 1.49 seconds). `git diff --check` exited 0 without output. The earlier acceptance run at 17:25:42 also passed 41 tests; the result stated here is the rerun after the configuration and media-maintenance follow-ups finished.

The checks exercise the production model-call boundary and real SDK serializers using injected local transports. The integrated mixed-input test also exercises the real AgentHarness and its payload hooks, then sends a follow-up and checks that the original image/audio/video payloads remain present. They validate request fidelity, not the semantic quality of a remote model's understanding.

Additional reviewed coverage:

- Original media preserves its exact bytes and MIME instead of becoming a transcript, extracted frames or a summary.
- Native media is represented by Nomi file types and ephemeral bound handles, rather than falsely labelling audio/video as SDK image content.
- Persisted input keeps canonical project asset claims; native bytes and bound handles are reconstructed for requests.
- Compaction retains original attachment-bearing input claims and excludes private handles/base64 media from its textual summary request; a fresh lane rehydrates those claims.
- Unsupported input, missing originals, invalid MIME/bytes, unresolved bindings and aggregate request-size violations fail explicitly.
- The existing composer already accepts audio/video files. The model capability editor saves an explicit model-local protocol override and media capability flags while preserving unrelated metadata.
- The Google adapter uses Nomi's injected fetch without changing global fetch. Gateway prefixes and query parameters, custom headers, exact model identity, AbortSignal, usage and valid thought-signature/tool replay are covered.

## Findings resolved during review

### Gateway query parameters

A real SDK request using a base such as `https://relay.invalid/prefix/v1beta?route=a` originally appended the method suffix into the query value. The implementation now supplies a query-free SDK base and reattaches the configured query in the bound transport, preserving duplicate parameters while retaining SDK-generated parameters. The regression checks the exact path and duplicate tags.

### Payload-hook exceptions were not a fail-closed boundary

The pinned AgentHarness catches `before_payload` hook exceptions, reports them and can continue with its original payload. A direct HookRegistry reproduction confirmed that an exception alone returned the unchanged native-file handle. The provider now rejects unresolved native-file handles after awaiting the harness hook, outside that swallowed-error boundary. Real AgentHarness regression cases cover all four protocols and assert zero fetch calls.

### Aggregate memory admission

A per-file bound followed only by a final aggregate JSON check could read and encode many historical files before rejecting them. The implementation now shares a NativeMediaBudget across the request projection/history, reserves encoded sizes from available metadata before bounded reads, and enforces the final request-body bound.

### Compaction and original-media retention

The ordinary compaction path serializes projected messages to text and therefore could not safely summarize native-file handles as though they contained the original media. Attachment-bearing canonical inputs are now retained; their user text can be summarized while the original claims remain available for future request reconstruction.

### Test-fixture corrections

- `signature-original` was invalid Base64 and was correctly discarded by pi's thought-signature validation. The test uses valid Base64 rather than weakening production validation.
- The first integrated follow-up test passed a content-part array to the wrong `lane.prompt` overload. It now passes a proper UserMessage and asserts successful admission for both requests. The corrected test passed.

## Remaining limits and unverified conditions

- Inline requests are bounded to **20 MiB including Base64, other request content and retained history**. This is approximately 15 MiB of original binary media before other content; the per-file bound is slightly smaller.
- Provider File API uploads, remote file lifecycle/expiry handling and upload-reference reuse are not implemented in this feature slice. Large videos must be shortened or rejected explicitly.
- Retaining original attachment claims preserves native analysis across follow-ups, but long conversations can accumulate enough media to hit the request limit. The explicit recovery is a shorter original or a new conversation; no automatic transcription/summary substitute is claimed.
- Allowed media formats still depend on the selected protocol and provider. Native video requires the Google native route in this implementation; the OpenAI-compatible audio route is limited to its supported audio shapes/formats.
- These tests do not establish successful remote Gemini/relay interpretation of a non-synthetic recording. Root separately recorded one successful original PNG/WAV/MP4 request in `native-input-live-result.json`; its near-silent diagnostic audio explicitly does not establish speech-recognition quality. The reviewer did not make or independently rerun that remote call. **A non-synthetic live understanding test remains pending and must be recorded separately.**
- Root separately records development-build Chinese/English screenshots and a repeatable UI walk. This reviewer did not perform those interactions or independently inspect the screenshots in this refresh. Component state/save tests are not substitutes for UI acceptance, and the required approved UI design board remains pending.
- The final performance JSON was inspected and reported its bounded preparation scenario under the proposed budget; the reviewer did not independently rerun that performance scenario and does not treat it as a packaged UI responsiveness measurement.

## Publication status

Keep the publication **DRAFT**. This review passes the scoped implementation/request-fidelity checks, but it does not close the pending approved UI design board or the separate non-synthetic live-provider acceptance.

The root validation log also records unrelated failures in unchanged Windows/environment-sensitive tests (`codexCli.test.ts`, `multiOutputMapping.test.ts`, `operationLedger.test.ts`, `certificationMedia.test.ts`). This reviewer has not independently rerun that broad directory suite. Those results must remain visible in publication evidence and must not be described as an entirely green repository-wide run. Draft publication does not waive those gates or imply merge approval.

## Review disposition

No remaining confirmed blocker was found in the reviewed code and request-boundary tests after the listed corrections and the refreshed 41-test run. This is an independent implementation/request-fidelity review of the exact HEAD-plus-dirty snapshot above, not a claim that live-provider, approved-UI or repository-wide validation has completed.

The reviewer made no production-code changes, invoked no paid model requests and used no computer-use automation. Only this documentation file was written at the coordinator's request.
