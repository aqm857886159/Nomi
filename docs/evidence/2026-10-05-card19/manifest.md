# Card 19 baseline and clock evidence

- Scope: 30 approved states; `d3-courtyard-director-zh` excluded per user decision.
- Verification: two consecutive `design-lab:update` runs, each 30 passed; 30 target PNG SHA-256 values identical across runs.
- Code change: process-feedback devlab fixture freezes Date.now, performance.now and requestAnimationFrame only inside the lab fixture. Production clock, calibration.json, assertions and product code are untouched.
- Source commit from Mac execution: 4e01e082d.
- Full diff and run logs are preserved in the private Library artifact `card19-card19-evidence.zip` (SHA-256 de147ab499ac2cc89b4cd60332938a6b0b48e3224eceba50d2eddccd5204515a).
