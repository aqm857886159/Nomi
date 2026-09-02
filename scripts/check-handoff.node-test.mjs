import assert from "node:assert/strict";
import test from "node:test";
import { countSuiteFailures, deletedLinesFromNumstat, formatReport, parseArgs, summarizeDeletionRisk } from "./check-handoff.mjs";

test("handoff deletion math separates two-point drift from three-point branch work", () => {
  assert.equal(deletedLinesFromNumstat("2\t7\tfile.ts\n-\t-\tbinary.png\n4\t3\tother.ts"), 10);
  assert.deepEqual(summarizeDeletionRisk(10, 4), {
    twoPointDeleted: 10,
    ownDeleted: 4,
    ratio: 2.5,
    suspicious: true,
  });
  assert.equal(formatReport({ branch: "feature/demo", base: "origin/main", behind: 3, deletionRisk: summarizeDeletionRisk(10, 4) }).includes("⚠ 回滚嫌疑"), true);
});

test("handoff CLI arguments require one branch and support the optional suite", () => {
  assert.deepEqual(parseArgs(["feature/demo", "--with-tests"]), { branch: "feature/demo", withTests: true });
  assert.deepEqual(parseArgs(["--", "feature/demo"]), { branch: "feature/demo", withTests: false });
  assert.deepEqual(parseArgs(["--with-tests", "feature/demo"]), { branch: "feature/demo", withTests: true });
  assert.throws(() => parseArgs([]), /Usage:/);
  assert.throws(() => parseArgs(["a", "b"]), /Usage:/);
});

test("handoff suite parser reports stage failures and fails closed on missing receipts", () => {
  assert.equal(countSuiteFailures("system-test full-local: FAIL (7/9 stages passed)"), 2);
  assert.equal(countSuiteFailures("system-test full-local: PASS (9/9 stages passed)"), 0);
  assert.equal(countSuiteFailures("runner crashed before the summary", 1), 1);
});
