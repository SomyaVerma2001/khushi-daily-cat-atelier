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
- The existing content is still a generator-backed placeholder bank. It is not a complete real authored bank yet.

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
