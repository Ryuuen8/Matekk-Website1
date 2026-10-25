# Changelog

This log summarizes the frontend and backend changes completed during the
2026-10-17 and 2026-10-18 work sessions.

## 2026-10-25

### Homepage inquiry CAPTCHA

- `72b5fb2` — Added server-side Google reCAPTCHA verification for contact and
  training/ICT inquiry submissions; invalid or unverifiable tokens cannot be
  submitted as inquiries.
- `c6205ef` — Added tests for successful verification, rejected tokens, missing
  configuration, and Google verification service failures.
- Documented the production secret and local-only Google test keys.

### Verification

- 20 targeted backend tests passed; backend build and targeted lint passed.

## 2026-10-25

### CompTIA question bank

- `9674168` — Included CompTIA multiple-select and fill-in-the-blank questions in the usable
  bank, and retained simulations, unsupported formats, and incomplete answer
  keys as ungraded review items instead of dropping them.
- Preserved signed exhibit image URLs on review items so CompTIA exams can show
  every mapped image.
- Added regression tests for CompTIA question-type handling and image links.

### Verification

- Backend question-service tests, lint, and build.

## 2026-10-18

### Offline learning

- Hid the frontend navbar and footer while the browser is offline.
- Let cached module routes reach the PIN gate without waiting for an account
  session or requiring an authenticated profile.
- Kept the device's locally saved PIN verifier when an account logs out or its
  online session expires.
- Clarified that the PIN must first be configured and verified online by an
  administrator, and that the PIN gates access to cached content rather than
  encrypting it.

### Verification

- Frontend ESLint and production build passed for the offline layout and access
  changes.

## 2026-10-17

### Exam question bank and grading

- Kept connect-the-dots, drag-and-drop, click-the-boxes, image-based, and
  multiple-choice questions as distinct question types.
- Added the CCNA per-50 question allocation: 5 connect-the-dots, 3
  drag-and-drop, 1 click-the-boxes, 1 image-based, and 40 multiple-choice
  questions.
- Added randomized question/choice ordering while preserving a saved attempt's
  order when it is resumed.
- Improved click-the-boxes interaction with animated choice removal,
  repositioning of remaining choices, and selected-answer highlighting.
- Scoped question-bank queries to their module, recognized common question-type
  aliases, and prevented non-CCNA modules from entering the legacy CCNA exam.
- Added module-scoped exam creation, submission, grading, and gradebook
  recording for future programs, including CompTIA.
- Stored the program and module scope on exam attempts and added the corresponding
  Prisma migration.
- Fixed grading of shuffled single-choice options by preserving the resolved
  correct option in the private attempt record.
- Applied the exam-attempt scope migration to the configured database and
  verified Prisma reported the schema up to date.

### CompTIA gradebook access

- Updated program-key resolution so CompTIA keys such as `comptia-network-plus`
  and `comptia-security-plus` resolve to their enrolled database programs.
- Confirmed the existing CompTIA practice flow saves browser-calculated scores
  to the backend gradebook; those results are progress records, not
  server-authoritative exam attempts.

### Enrollment and profile

- Corrected the frontend profile photo upload method and password-change URL to
  match the backend routes.
- Added the authenticated student enrollment-request endpoint, including input
  validation, duplicate-request checks, and rejection of requests for programs
  the student already has access to.
- Changed administrator approval of an enrollment request to create the
  enrollment and resolve the request atomically.
- Updated profile enrollment names to combine normalized enrollment records
  with legacy `programs_enrolled` values, while removing duplicates.
- Updated the course page to load actual enrollment history, expand full-program
  enrollments, and display enrolled programs that are not in its static catalog.

### Offline PIN setup

- Added the authenticated, admin-only endpoint for verifying the shared
  offline-module PIN, with rate limiting and validated optional server
  configuration.
- Documented the `OFFLINE_MODULE_PIN` backend setting and added regression
  coverage.
- The deployed backend must have `OFFLINE_MODULE_PIN` configured for online
  device setup; without it, the verification endpoint returns `503`.

### Verification

- Targeted backend auth, enrollment, question, and user-service tests passed
  during the respective changes.
- Backend builds and frontend builds/lint passed for the affected changes.
