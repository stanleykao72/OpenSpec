## 1. Guard

- [x] 1.1 Add `test/fork/version-parity.test.ts` comparing `package.json` against
      `git show main:package.json`, skipping when the mirror is unreadable
- [x] 1.2 Verify it fails on a drifted version and passes on a matching one

## 2. Verification

- [x] 2.1 `pnpm lint` clean
- [x] 2.2 `pnpm test` shows no new failures against the pre-merge baseline
