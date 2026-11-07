# Changelog

## 2026-11-07 — `main`

Commits included in this push:

- `44a396b` — Reverted backend source changes after `9431431`, restoring that baseline while preserving Git history.

Validation before push: verified backend email source matches `9431431`; `git diff --check` passed.

## 2026-10-25 — `main`

Commits included in this push:

- `94cc686` — Added server-side reCAPTCHA v3 verification for contact and inquiry submissions, including action matching and a 0.5 minimum score.

Validation before push: 22 focused CAPTCHA/inquiry/environment tests passed; API production build passed with placeholder database URLs; Git whitespace checks passed.

## 2026-10-25 — `main`

Commits included in this push:

- `41ff1d9` — Switched both homepage forms to v3 token execution and removed the incompatible v2 checkbox package.

Validation before push: frontend production build and targeted ESLint passed; Git whitespace checks passed.
