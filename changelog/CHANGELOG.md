# Changelog

## 2026-11-08 — `main`

Commits included in this push:

- `26e7744` — Added redacted reCAPTCHA rejection diagnostics, including provider error codes and rejection reasons, without logging tokens or secrets.

Validation before push: CAPTCHA service tests passed (5 tests); targeted oxlint and Nest build passed; Git whitespace checks passed.

## 2026-11-08 — `main`

Commits included in this push:

- `cf90e4f` — Added display-name support to the profile API, included the Users table migration, and restricted role changes to administrators.

Validation before push: 32 focused auth/users tests passed; backend lint passed with one existing duplicate-key warning; Nest build passed with placeholder database URLs; Git whitespace checks passed.

## 2026-11-07 — `main`

Commits included in this push:

- `4db5d6c` — Restored backend source to the pre-login-issue state at `9431431`; the website source was already at its pre-issue state.

Validation before push: verified backend application source matches `9431431`; OTP service tests, oxlint, Nest compile, and Git whitespace checks passed.

## 2026-11-07 — `main`

Commits included in this push:

- `93b7ff2` — Restored the dedicated EmailJS OTP template integration after the backend rollback; persistent offline PIN unlock was already restored in the website repo.

Validation before push: OTP email and OTP service tests passed (10 tests); targeted oxlint and Nest compile passed; Git whitespace checks passed.

## 2026-11-07 — `main`

Commits included in this push:

- `44a396b` — Reverted backend source changes after `9431431`, restoring that baseline while preserving Git history.

Validation before push: verified backend email source matches `9431431`; `git diff --check` passed.

## 2026-11-07 — `main`

Commits included in this push:

- `192a90a` — Routed login verification emails through the dedicated EmailJS OTP template with the documented code and expiry parameters.

Validation before push: OTP email and OTP service tests passed (10 tests); targeted oxlint and Nest compile passed; Git whitespace checks passed.

## 2026-11-07 — `main`

Commits included in this push:

- `7e3a94e` — Reverted the dedicated OTP EmailJS template change and restored the previous OTP email parameters.

Validation before push: OTP service tests, targeted oxlint, and Git whitespace checks passed.

## 2026-11-07 — `main`

Commits included in this push:

- `d6b6b52` — Fixed OTP email delivery to use the dedicated EmailJS OTP template and its expected code/expiry fields; added a regression test.

Validation before push: EmailService regression test, targeted oxlint, Nest compile, and Git whitespace checks passed. `npm run build` could not run Prisma generation because local `DATABASE_URL` is unset.

## 2026-10-25 — `main`

Commits included in this push:

- `94cc686` — Added server-side reCAPTCHA v3 verification for contact and inquiry submissions, including action matching and a 0.5 minimum score.

Validation before push: 22 focused CAPTCHA/inquiry/environment tests passed; API production build passed with placeholder database URLs; Git whitespace checks passed.

## 2026-10-25 — `main`

Commits included in this push:

- `41ff1d9` — Switched both homepage forms to v3 token execution and removed the incompatible v2 checkbox package.

Validation before push: frontend production build and targeted ESLint passed; Git whitespace checks passed.
