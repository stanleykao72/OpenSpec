# Design

## Context

The fork merges upstream in two stages: upstream lands on `main` as a pristine
mirror, then `main` merges into `esmith-main`. That convention is what makes the
guard possible — `main`'s `package.json` is upstream's, untouched, so it is a
truthful statement of the base without needing to resolve tags or merge-bases.

## Decisions

**A test rather than a script.** `scripts/pack-version-check.mjs` exists and is
wired to `check:pack-version`, which nothing in the default flow runs. A guard
nobody runs is the failure mode this change exists to fix, so this one lives in
the suite `pnpm test` already executes. Alternative considered: extend
`pack-version-check.mjs`. Rejected — it packs a tarball, which is slow, and it
answers a different question (CLI vs. manifest, not manifest vs. base).

**Skip, never pass, when the mirror is unreadable.** A guard that silently
succeeds when it cannot check is worse than absent, because it reports coverage
it does not have. `git show main:package.json` failing — no git, shallow clone,
`main` never fetched — yields a skipped test, which reads as "unverified" in the
output.

**Compare against `main`, not against a tag.** Tags require deciding which tag is
the base, and the answer is wrong the moment upstream tags a release the fork has
not merged. `main` is definitionally the merged base under the branch convention.

## Risks / Trade-offs

- [The guard is only as true as the branch convention] → If someone commits to
  `main`, the mirror stops being upstream's and the guard compares against a
  fiction. Mitigation: the convention is recorded, and a fork commit on `main`
  is visible as a non-zero count in `git rev-list --count upstream/main..main`.
- [CI may skip it] → A checkout without `main` skips silently-but-visibly. The
  skip is reported, so a suite that never runs this check is observable.

## Open Questions

Whether to re-adopt upstream's `PURPOSE_PLACEHOLDER_*` wording in
`specs-apply.ts` now that upstream has fixed the problem the fork forked over.
Out of scope here; noted so it is not lost.
