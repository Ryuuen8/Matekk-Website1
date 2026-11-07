# Changelog

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
