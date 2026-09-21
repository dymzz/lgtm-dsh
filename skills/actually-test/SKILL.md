---
name: actually-test
description: Write the tests a change actually needs, then iterate with lgtm until they prove something. Use when the user asks to test what was just built.
---

# actually-test

Goal: a test for every applicable flow and edge case of the code you just built, each one red for the realistic
bug, then iterate on `lgtm` until it passes.

## 1. Inventory

Write this down before writing a single test.

- The entry points the change touched.
- Every seam it crosses: one component writes and another reads, producer and consumer, auth, persistence,
  cache keys, queues, serialization.
- Every refusal path the code exists for: permissions, tenant isolation, duplicates, quotas, stale versions,
  concurrency, partial failure, invalid input.
- The true external edges: clock, randomness, network, third-party SDKs, filesystem.

## 2. Choose

- Few wide tests with real collaborators beat many mocked units.
- Fake only the external edges from the inventory. Nothing first-party.
- Every seam gets at least one test with both sides real, asserting they agree.
- Every refusal path gets one test that drives it and asserts the refusal.
- Skip trivial primitives. Any feature test that uses them covers them.
- For each test, finish "this test prevents us from shipping [specific incorrect behavior]". If you cannot, do
  not write it.

## 3. Write and run

Build fixtures through the real constructors and validators. Assert exact values on the fields that define
correctness. Await everything, including rejections and background work. No retries. Run the suite green.

## 4. Prove red

For each test that guards a refusal path or a fix: break the behaviour on purpose, run that test, watch it fail
for the right reason, restore. A test you never saw fail is not a test.

## 5. Iterate with lgtm

1. `lgtm_audit` with `plan: true` — free. Read the plan and tell the user the estimate in one line.
2. `lgtm_audit` with no `target` to analyse the tests your change touches (it diffs against the repository
   default branch); pass `target` when you want a file or directory instead. Reach lgtm only through the tool —
   a shell `lgtm` has no credential, because the harness scrubs `TYPESAFE_API_KEY` out of every tool environment.
3. For each finding decide keep, delete or replace exactly as the `lgtm` skill says.
4. Re-run until no `high` finding remains, or every one of them has a one-line defence.

Cap it at three rounds and report what is left.

## 6. Report

A table: flow or edge case, test name, the bug it prevents, the lgtm verdict. Then the remaining findings with
their defences. Then anything you chose not to test, and why.

## Do not

- Do not let `toHaveBeenCalled` be the only evidence.
- Do not mock the seam under test.
- Do not compute an expected value with production code.
- Do not snapshot whole objects.
- Do not write a test for the sake of coverage.
