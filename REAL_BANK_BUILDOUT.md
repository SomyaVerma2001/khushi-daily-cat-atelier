# Real Question Bank Buildout

The app target from 2026-06-30 to 2026-11-29 is 153 IST days.

Daily requirement:

- 4 VARC passages = 16 VARC questions
- 5 DILR sets = 20 DILR questions
- 30 Quant questions

True no-repeat bank requirement:

- 612 unique VARC passages, each with 4 questions
- 765 unique DILR sets, each with 4 questions
- 4,590 unique Quant questions
- 10,098 total question-level entries

Current state:

- The app now assigns permanent bank slots: `VARC-0001-Q1`, `DILR-0001-Q1`, `QUANT-0001`, etc.
- The scheduler maps each IST day to unique bank slots.
- `tools/audit_real_bank.js` verifies slot uniqueness, option counts, answer indexes, broken generated text, and VARC passage length.
- Current expanded bank version: `2026-06-30-expanded-bank-v1`.
- Structural variety currently audited:
  - 48 VARC themes
  - 25 DILR set families
  - 20 Quant topics/templates
- The Google Sheet shared on 2026-07-01 is accessible as a public resource directory, but the provided `gid=480061171` exports only the landing/instructions tab, not direct Q&A rows.
- The current app bank is original deterministic generated material with checked answers. It is wider and no-repeat at slot level, but not yet a fully hand-authored 10,098-item textbook bank.

Buildout rule:

- Do not mark the bank complete until `tools/audit_real_bank.js` passes and the structural/content bank contains enough authored material for all required slots.
- Do not scrape provider-owned prep-site questions into the public repo unless the licence explicitly allows reuse.
- Every Quant and DILR item must have a deterministic checked answer.
- Every VARC passage must be original or properly licensed, long enough for CAT-style RC, and include a written justification for every answer.

Recommended batch order:

1. Build and verify 300 original Quant questions.
2. Build and verify 50 DILR sets.
3. Build and verify 40 VARC passages.
4. Repeat batches until the target is reached.

Audit command:

```bash
node tools/audit_real_bank.js
```
