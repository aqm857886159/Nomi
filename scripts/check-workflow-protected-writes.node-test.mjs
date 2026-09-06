// 门岗自己的红绿证明：先证它对 2026-09-06 之前的真实 download-stats.yml 报红，
// 再证它对修后的写法与仓库里别的合法 push（tag、数据分支）放行。
// 没有「先验它会红」的门岗等于没门岗（R17）。
import test from "node:test";
import assert from "node:assert/strict";

import { findProtectedWrites, violationOf } from "./check-workflow-protected-writes.mjs";

/** 修之前 .github/workflows/download-stats.yml 的最后一步，逐字照抄。 */
const PRE_FIX_STEP = `      - name: Commit if changed
        run: |
          if git diff --quiet -- docs/stats/downloads-history.json; then
            echo "skip"
            exit 0
          fi
          git add docs/stats/downloads-history.json
          git commit -m "chore(stats)"
          git push
`;

/** 修之后那一步。 */
const POST_FIX_STEP = `      - name: Commit the snapshot onto the data branch
        working-directory: .stats-data
        run: |
          git add downloads-history.json
          git commit -m "chore(stats)"
          git push origin HEAD:refs/heads/stats-data
`;

function fakeFs(files) {
  return {
    existsSync: () => true,
    readdirSync: () => Object.keys(files),
    readFileSync: (file) => files[file.split("/").pop()],
  };
}

test("裸 push 报红——这正是 20 天连红的那一行", () => {
  const offenders = findProtectedWrites(["/repo/.github/workflows/download-stats.yml"], {
    fsImpl: fakeFs({ "download-stats.yml": PRE_FIX_STEP }),
    root: "/repo",
  });
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].line, 9);
  assert.match(offenders[0].reason, /没写目的地/);
});

test("推到非保护数据分支放行", () => {
  const offenders = findProtectedWrites(["/repo/.github/workflows/download-stats.yml"], {
    fsImpl: fakeFs({ "download-stats.yml": POST_FIX_STEP }),
    root: "/repo",
  });
  assert.deepEqual(offenders, []);
});

test("显式写死受保护分支的每种拼法都报红", () => {
  for (const args of [" origin main", " origin HEAD:main", " origin HEAD:refs/heads/main", " --force origin feature:main", ' origin "main"']) {
    assert.match(violationOf(args) ?? "", /受保护分支/, `应报红：git push${args}`);
  }
});

test("推 tag、推别的分支、推变量 tag 放行", () => {
  for (const args of [' origin "$RELEASE_TAG"', " origin refs/tags/v1.2.3", " origin HEAD:refs/heads/stats-data", " origin automation/seo-radar"]) {
    assert.equal(violationOf(args), null, `不该报红：git push${args}`);
  }
});

test("只写 remote 不写 refspec 也报红（目的地仍是当前分支）", () => {
  assert.match(violationOf(" origin") ?? "", /没写 refspec/);
});

test("注释里提到 push 的历史说明不算违规", () => {
  const offenders = findProtectedWrites(["/repo/.github/workflows/x.yml"], {
    fsImpl: fakeFs({ "x.yml": "# 机器人每天 git push 直推 main 被 GH006 拒绝\njobs: {}\n" }),
    root: "/repo",
  });
  assert.deepEqual(offenders, []);
});
