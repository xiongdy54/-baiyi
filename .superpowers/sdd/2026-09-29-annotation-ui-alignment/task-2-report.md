# Task 2 report: FakeKernel mark navigation

## Status

Implemented and committed Task 2 only on branch `批注样张对齐`.

- Baseline at task start: `3427c5210a37927ae9a637ba560c5c546c6ca798`
- Commit: `5af3d1afb5fbe67d0f3441e0de1e4ab5be077fa2` (`Add fake kernel mark navigation contract`)
- Files committed: `src/lib/reader/kernel.ts`, `src/lib/reader/testing/fakeKernel.ts`

## Changes

- Added required `ReaderKernel.goToMark(id): Promise<boolean>` with a contract that specifies exact mark-id navigation, CFI-only resolution and no text-search fallback.
- Documented `setDocumentMarks` as replacing the current document mark list.
- Added FakeKernel mark storage using a copy of supplied marks (including copied rect arrays), exact-id lookup, CFI-only delegation to `goTo({ cfi })`, and `false` for missing/non-CFI marks.
- FakeKernel clears its mark storage on `destroy()`.
- No adapter or test files were included in the commit.

## TDD evidence

### RED

Command: `node tests/reader.fake-marks.test.cjs`

Output:

```text
✗ 按标记导航所需接口已定义 | 条件不成立
✗ 精确标记 id 导航到该条 CFI | goToMark 接口缺失
✗ 未知 id 返回 false 且位置不变 | goToMark 接口缺失
✗ 没有定位锚的标记返回 false 且位置不变 | goToMark 接口缺失
✗ 替换标记列表后旧 id 不再导航 | setDocumentMarks/goToMark 接口缺失

==== reader.fake-marks: 0/5 ====
```

This was the expected RED run: `goToMark` and `setDocumentMarks` were absent from FakeKernel, with all five assertions failing for the missing API/behavior.

### GREEN

Command: `node tests/reader.fake-marks.test.cjs`

Output:

```text
✓ 按标记导航所需接口已定义
✓ 精确标记 id 导航到该条 CFI
✓ 未知 id 返回 false 且位置不变
✓ 没有定位锚的标记返回 false 且位置不变
✓ 替换标记列表后旧 id 不再导航

==== reader.fake-marks: 5/5 ====
```

The user-provided failing RED run was reproduced before implementation. The GREEN command was run after implementation, and again during final verification; both completed 5/5.

## TypeScript

Command: `npx tsc --noEmit`

Result: **fails (exit 2)** because `ReaderKernel.goToMark` is required while the existing Foliate and PDF adapter object literals do not yet implement it:

```text
src/lib/reader/foliate/adapter.ts(450,9): error TS2741: Property 'goToMark' is missing ...
src/lib/reader/pdf/adapter.ts(393,9): error TS2741: Property 'goToMark' is missing ...
```

This is an outstanding Task 3 integration dependency. Per Task 2 scope, adapter changes and adapter L1 work were not included.

## Bundle / scope / concerns

- The original starting worktree had no tracked `tests/reader.bundle.js` diff (verified before Task 2). During controller-side exploration, `npx electron tests/reader.kernel.cjs` rebuilt this tracked artifact from experimental `tests/reader.driver.js` changes. The current diff is generated output and unrelated to commit `5af3d1a`; restoration to HEAD was approved by the user but is still blocked by the tool policy. It remains uncommitted and must not be staged. Subsequent FakeKernel tests use a standalone harness and do not rewrite this bundle.
- `tests/reader.driver.js` exploratory mark-navigation harness additions were removed; its remaining unrelated user/worktree diff is not part of Task 2. Multiple original untracked assets remain untouched.
- `npx electron tests/reader.kernel.cjs` was not run after Task 2 implementation because it regenerates the tracked bundle; the standalone `node tests/reader.fake-marks.test.cjs` is the scoped GREEN evidence.
- `git diff --check` for the two scoped files passed. The new commit contains exactly the two required source files.

## Verification summary

- RED: `node tests/reader.fake-marks.test.cjs` — 0/5, expected missing API failures.
- GREEN: `node tests/reader.fake-marks.test.cjs` — 5/5.
- TypeScript: `npx tsc --noEmit` — blocked by the two adapter implementations deferred to Task 3.
- Tracked bundle: unchanged by the focused test runs; pre-existing worktree modification remains outside the commit.

## Test-asset report

- Reviewed `tests/reader.fake-marks.test.cjs` and `tests/reader.fake-marks.entry.ts` against the Task 2 brief, the approved alignment spec, and the FakeKernel implementation. The navigation checks use a real FakeKernel and assert externally observable location/result behavior for a known CFI, unknown id, missing CFI, and replacement list.
- Replaced the interface-presence assertion with a behavioral destroy check while retaining five total checks: install a CFI mark, destroy, reopen, and prove the stale id returns false without changing location. This validates mark clearing through the public navigation contract, not private storage inspection.
- Command: `node tests/reader.fake-marks.test.cjs` — **5/5 passed**.
- The harness writes only `tests/.tmp-reader-fake-marks-${process.pid}.cjs`, removes it in `finally`, and verification found no matching temp bundle left behind.
- Did not run `npx electron tests/reader.kernel.cjs`; did not modify or restore `tests/reader.bundle.js`; did not touch the existing `tests/reader.driver.js` diff or user untracked assets.
- This test-asset update is limited to `tests/reader.fake-marks.test.cjs` and `tests/reader.fake-marks.entry.ts`. The separate existing tracked bundle diff remains untouched and excluded.

## Task 2 final review fix report: engine-neutral mark navigation

### Review finding

The previous `goToMark` JSDoc described CFI as the only supported anchor, conflicting with the approved contract: EPUB marks use CFI, while PDF marks use `pageIndex + rects`.

### Fix

- Updated the `ReaderKernel.goToMark` JSDoc in `src/lib/reader/kernel.ts` to specify exact mark-id matching, use of the engine-supported anchor (EPUB: CFI; PDF: `pageIndex + rects`), `false` for a missing mark or an unresolvable anchor, and no text-search fallback.
- Updated the related `setDocumentMarks` JSDoc to state the same navigation contract.
- No method signatures or runtime behavior changed. No bundle or test files were changed for this review fix.

### Verification

- `git diff --check` — passed (exit 0; Git emitted only the existing LF-to-CRLF working-copy warnings).
- `node tests/reader.fake-marks.test.cjs` — passed, **5/5** checks: exact-id CFI navigation, unknown id, missing anchor, list replacement, and destroy/reopen lifecycle.

### Outstanding concern

The earlier `npx tsc --noEmit` check recorded above remains an adapter integration item for Task 3: the Foliate and PDF adapter implementations do not yet implement the required `goToMark` method. This JSDoc-only fix does not address that Task 3 work. The pre-existing `tests/reader.bundle.js` worktree diff and unrelated user untracked files were left untouched and must not be staged with this fix.
