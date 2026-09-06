# Lenden Engineering Plan

This plan assumes the product is already built and deployed. It does not
describe how Lenden was originally built; it describes the next phase of
work: an independent audit and hardening pass on the existing
implementation. See `architecture.md` for the full, verified description
of what currently exists.

---

## 1. Current State

Verified directly from the repository (`https://github.com/vaishnavisingh095/lenden`):

**Implemented and working (traced end-to-end in code):**
- Voice input (browser `MediaRecorder`) and typed-text input, both
  converging on the same AI-extraction and review flow.
- Speech-to-text via Sarvam AI (`saaras:v3`).
- Multi-event structured extraction (1–3 events per transcript) via Sarvam
  chat completions, constrained to a strict JSON schema.
- An editable review/confirmation screen — nothing is persisted until the
  owner explicitly saves.
- A real transaction ledger: every purchase/payment is its own signed row
  in `transactions`; balance is always computed as `SUM(amount)`, never
  stored redundantly.
- Promise tracking (`promise_history`) with automatic fulfillment matching
  against subsequent payments (matched by amount and date).
- A follow-up/priority engine (computed server-side, on read) that
  classifies customers into `high`/`medium`/`low` priority with a
  human-readable reason and a recommended `call`/`whatsapp`/`none` action.
- A "Today" dashboard that filters/sorts the same server-computed
  priority data client-side.
- Owner-initiated contact via `tel:`/`wa.me` links, with a fire-and-forget
  contact-event log for later "average follow-ups" statistics.
- Multi-phone-number management per customer (add/edit/set-primary/delete).
- Payment Reliability statistics (average days late, promises kept/broken,
  average follow-ups before payment) — a summary of historical fact, not a
  prediction.

**Deployed:** Frontend on Vercel, API on Render, per the README (deployment
configuration itself lives outside this repository and was not directly
verifiable from code).

**Major known limitations** (verified from code, not assumed):
- No authentication, authorization, or multi-tenancy anywhere in the
  system — every endpoint is fully open.
- No automated tests of any kind exist in the repository.
- Multi-event saves are not atomic across events (each event is its own
  HTTP request and its own DB transaction).
- No duplicate-submission guard on the primary save action.
- A confirmed bug in `promise_date` parsing: the `"<weekday> next month"`
  phrasing never returns a value and always falls through to
  `"Invalid promise date."`.
- Customer identity is a case-insensitive exact name match with no
  disambiguation or merge tooling — minor naming inconsistencies (e.g. from
  AI transliteration) will silently fragment one customer into several.
- Two independently-maintained copies of the follow-up-priority logic
  (list endpoint vs. detail endpoint) that are similar but not identical.
- A dead, unused `customer_history` table remains in the schema.
- The `transactions.source` field does not reliably distinguish
  voice-originated from typed-originated saves (both are hardcoded to
  `"voice"`).

Full detail, including FACT/INFERENCE/CONCERN labeling, is in
`architecture.md` §12.

---

## 2. Engineering Objective

> Establish correctness, reliability, maintainability, and defensibility
> of the existing Lenden implementation without unnecessary architectural
> complexity.

This phase is about verifying and hardening what exists — not redesigning
it, not adding product features, and not chasing an idealized architecture
the current codebase does not warrant.

---

## 3. Phase 1 — Baseline Audit

Status: **substantially completed** by the repository exploration that
produced `architecture.md`. Remaining work in this phase is verification
under actual runtime conditions rather than static reading:

- Confirm the exact behavior of the voice-path empty-`events` edge case
  (architecture.md §6/§12 item 10) by exercising it, rather than inferring
  from static analysis alone.
- Confirm real request/response payloads against what the code claims by
  hitting the deployed Render API directly (health check, then a
  controlled `/extract` call with a known transcript).
- Confirm actual Node.js runtime version in production versus the
  `replit.md` note (which is documentation, not an enforced `engines`
  field).
- Confirm whether Render/Vercel apply any environment-specific
  configuration (rate limiting, CORS allow-lists, etc.) that isn't visible
  in this repository.
- Reconcile this document and `architecture.md` against any further
  findings; update both if runtime behavior contradicts static reading.

---

## 4. Phase 2 — Product/Business Logic Audit

Inspect, with test cases where feasible:

- **Transaction semantics**: confirm the sign convention
  (`payment` negative, `purchase` positive) holds consistently and that no
  code path could insert a transaction with the wrong sign for its type.
- **Multi-event extraction**: verify the "one customer per transcript"
  assumption baked into the AI system prompt actually matches real user
  speech patterns (e.g. what happens if a transcript genuinely mentions two
  different customers — the prompt does not appear to handle this case).
- **Payment vs. purchase vs. promise distinction**: confirm the
  `amount_type` fallback behavior (anything not `promised`/`received`
  falls through to the `outstanding`/purchase branch, including `null`) is
  intentional and not silently miscategorizing ambiguous AI output.
- **Promise handling**: verify the promise-to-payment matching logic
  (exact amount match + date-on-or-before) against partial payments,
  overpayments, and multiple simultaneous open promises for the same
  customer — none of which appear to be explicitly handled today.
- **Customer identity**: quantify how often real transliteration variance
  would fragment a customer (this is a data-quality risk inherent to the
  current design, not a bug, but its practical severity should be
  measured).
- **Balance calculations**: confirm `SUM(transactions.amount)` behaves
  correctly with the `numeric(14,2)` column type at the currency
  precision Lenden operates at (Indian Rupees, values reaching into the
  lakhs).
- **Collections prioritization**: reconcile the two independently-written
  priority rule sets (list vs. detail endpoints) — determine whether the
  divergence is intentional (different views for different purposes) or
  accidental drift, and treat accordingly.
- **Review/confirmation behavior**: confirm what the owner actually sees
  and can correct at review time for each of the three event types, and
  whether the UI clearly communicates that a `promised` event does not
  affect balance (this is a business-logic distinction users need to
  understand, not just an implementation detail).

---

## 5. Phase 3 — Correctness Hardening

Priority order, highest-impact first:

1. **Financial invariants**: add explicit safeguards so that a `received`
   or `outstanding` event with `amount: null` cannot silently reach a
   `500` from a thrown `Error` — today this works, but only via a generic
   throw/catch rather than a validated `400`. Align this with the
   `saveCustomerNoteSchema` Zod validation that already runs earlier in
   the same request.
2. **Multi-event save atomicity**: decide whether to (a) accept the
   current per-event-request design and add clear partial-failure
   reporting to the owner (which events saved vs. failed), or (b)
   introduce a single batched save endpoint that wraps all events from one
   transcript in one DB transaction. This is a design decision for the
   audit, not something to default into.
3. **Duplicate-submission guard**: add an in-flight guard (disable the
   button / ignore repeat clicks) to the "Save & Continue" action, matching
   the pattern that already exists for the `processing` screen state
   elsewhere in the same component.
4. **Fix the confirmed `"<weekday> next month"` parsing bug** (missing
   `return result;`) — a small, isolated, well-understood fix once this
   phase begins (not fixed during the documentation task itself, per
   scope).
5. **Malformed AI output**: add a defensive Zod parse of the `/extract`
   response server-side before returning it to the client, so a provider-
   side schema violation fails predictably rather than surfacing as a
   client-side type mismatch.
6. **Stale/ambiguous data**: decide on and implement a minimal
   customer-disambiguation safeguard (even something as simple as warning
   the owner when a newly extracted name is a close-but-not-exact match to
   an existing customer) — scoped as SHOULD HAVE, not MUST HAVE, pending
   time.
7. **Dependency failures**: confirm the existing `502`/`500` handling for
   Sarvam and Postgres failures is consistent in shape (error payload
   structure) across all routes, and normalize where it is not.

---

## 6. Phase 4 — Testing

No tests currently exist; this phase starts from zero. Priorities, not
exhaustive:

- **Happy path**: voice → transcript → extraction → review → save →
  balance/priority update, for each of the three event types.
- **Invalid input**: missing customer name, negative/non-numeric amount,
  unparseable `promise_date` strings (including the confirmed buggy
  phrasing, both before and after the fix).
- **Boundary cases**: `amount = 0`, exactly-matching promise/payment
  amounts, a promise due exactly "today," balance exactly at the
  ₹20,000/₹50,000 follow-up thresholds.
- **Business-rule failures**: a `received` event with no matching promise,
  a promise that is fulfilled twice (double payment), an `amount_type`
  that is neither of the three known values.
- **Duplicate requests**: the exact double-tap scenario on "Save &
  Continue," before and after the guard from Phase 3 is added.
- **Retries**: what happens if the frontend retries `/extract` or
  `/customers/notes` after a timeout that the server actually completed
  (currently no idempotency key exists anywhere in the design — worth
  deciding whether this is in scope).
- **Dependency failures**: Sarvam unreachable, Sarvam returning malformed
  JSON, Postgres unreachable, `DATABASE_URL`/`SARVAM_API_KEY` missing at
  runtime.
- **Persistence failures**: a forced failure partway through the
  `db.transaction` in `/customers/notes` (e.g. the promise-insert step) to
  confirm the whole transaction actually rolls back as expected.
- **Regression tests** for every item fixed in Phase 3, so hardening work
  doesn't silently regress.

Do not optimize for raw test count; optimize for coverage of the financial
invariants and failure boundaries listed in `architecture.md` §8.

---

## 7. Phase 5 — UX Hardening

Only after Phase 3's core correctness work lands.

- **Loading states**: confirm every async action (`loadCustomers`,
  `loadCustomer`, the save loop, phone management) has a visible loading
  indicator distinct from a stuck/frozen UI — several currently rely on
  screen-state transitions (`"processing"`) rather than a dedicated
  loading flag per action.
- **Error states**: confirm `errorMessage` is always cleared appropriately
  and never persists across unrelated screens; confirm error copy is
  consistently owner-facing plain language (most of it already is).
- **Empty states**: no customers yet, no promises yet, no contact history
  yet — confirm each renders sensibly rather than blank.
- **Confirmation flow clarity**: make sure the distinction between
  "promised" (does not affect balance) and "received"/"outstanding" (does)
  is visually unambiguous at review time — this is a place where a
  misunderstanding has direct financial consequences for the business
  owner.
- **Confusing terminology**: review "outstanding" vs. "promised" wording
  with a fresh eye, given the target user is a non-technical business
  owner switching between Hindi, Hinglish, and English.
- **Responsiveness**: the UI is mobile-first by design intent; confirm
  actual behavior on a range of real device widths, not just the
  ~430px-wide layout assumptions visible in the component's styling.
- **Recovery after failure**: confirm a failed save leaves the review
  screen in a state the owner can retry from, rather than losing the
  extracted events.

---

## 8. Phase 6 — Deployment Hardening

- **Production environment**: obtain and document the actual Render/Vercel
  configuration (build commands, environment variables set, any
  platform-level settings) since none of this is captured in the
  repository itself.
- **Environment variables**: confirm `SARVAM_API_KEY`, `DATABASE_URL`, and
  all others enumerated in `architecture.md` §11 are correctly set in both
  environments, and decide whether missing-key behavior (currently a
  request-time `500` for `SARVAM_API_KEY`, a startup crash for
  `DATABASE_URL`) is the desired failure mode.
- **Runtime configuration**: pin an explicit Node.js engine version in
  `package.json` if production behavior must match a specific version
  (currently only documented informally in `replit.md`).
- **External service reliability**: decide whether any retry/backoff logic
  is warranted for Sarvam calls, given there is currently none.
- **Production errors**: confirm whether any error-monitoring/observability
  tool is wired in beyond `pino` structured logs (none was found in this
  repository).
- **Deployment reproducibility**: confirm the `pnpm-workspace.yaml`
  `minimumReleaseAge` supply-chain protection and `post-merge.sh` schema-push
  hook are both actually exercised in the real deployment pipeline, not
  just present in the repo.

---

## 9. Phase 7 — Final Review

Before submission/handoff:

- Adversarial engineering review of every item in `architecture.md` §12.
- Security review focused on the "no auth anywhere" gap — at minimum,
  document the blast radius precisely (any caller can read/write all
  customers' financial data) so it is not underestimated.
- Data-integrity review of the balance-derivation and promise-matching
  logic under concurrent writes (the current design does not appear to
  guard against two simultaneous saves for the same customer racing on the
  balance read, though each individual write is transactional).
- Failure-mode review against every row of `architecture.md` §8, including
  the two explicitly "not currently handled" rows.
- Performance review: confirm the `SUM(transactions.amount)` balance
  calculation and the customer-list `leftJoin`/`groupBy` remain performant
  as transaction volume grows, since balance is recomputed on every read
  rather than cached.
- UX review per Phase 5.
- Demo review: walk the full voice → ledger → follow-up flow end-to-end on
  the actual deployed environments (not just locally).
- Judge/stakeholder simulation: attempt to break the product the way an
  unfamiliar, skeptical evaluator would — duplicate names, rapid taps,
  ambiguous speech, network interruption mid-save.

---

## 10. Scope Control

### MUST HAVE
- Fix the confirmed `"<weekday> next month"` promise-date parsing bug.
- Add a duplicate-submission guard on "Save & Continue."
- Add defensive server-side validation of the `/extract` AI response shape.
- Resolve or explicitly document the empty-`events` voice-path edge case.
- Precisely document (not necessarily fix in this phase) the no-auth
  security posture so it is understood and intentional, not accidental.

### SHOULD HAVE
- Reconcile the two divergent follow-up-priority rule sets into one shared
  implementation (or explicitly document why they differ).
- Add a minimal customer-name-collision warning at save time.
- Normalize input validation (Zod) across all routes, not just
  `/customers/notes`.
- Add a baseline automated test suite covering the Phase 4 priority list.
- Add clear partial-failure reporting to the multi-event save flow.

### NICE TO HAVE
- Remove the dead `customer_history` table from the schema.
- Make `transactions.source` accurately reflect voice vs. typed origin.
- Wire the existing Orval/OpenAPI codegen pipeline to actually cover the
  business routes, or remove it if it will remain unused.
- Add retry/backoff for transient Sarvam failures.
- Pin an explicit Node engine version.

### CUT (not worth doing in this phase)
- Any redesign of the data model (the derived-balance/signed-transaction
  design is sound and should not be replaced).
- Introducing a global state library (Redux/Zustand) — the single-component
  local-state design, while unusual for an app this size, is not itself a
  correctness problem and refactoring it is out of scope for a
  correctness/hardening pass.
- Splitting `LendenInputScreen.tsx` into multiple components purely for
  file-size aesthetics, unless doing so is necessary to implement a MUST
  HAVE or SHOULD HAVE item above.
- Building the features the README already and explicitly lists as
  deliberately not built yet (OCR digitization, automated outbound
  reminders, route optimization, additional languages, a "why is this
  payment stuck" diagnostic engine).

---

## 11. Risks

Discovered directly during repository exploration (not hypothetical):

- **Data-quality risk**: customer-name-based identity resolution means the
  system's accuracy is bounded by AI transliteration consistency, which is
  outside this codebase's control (it depends on Sarvam's model behavior).
- **Single-vendor dependency risk**: both STT and extraction depend on one
  provider (Sarvam AI) with no fallback; an outage or model deprecation on
  Sarvam's side disables the entire voice-and-extraction pipeline
  simultaneously.
- **Security risk**: the complete absence of authentication means this
  system cannot safely hold real customers' financial data in a
  multi-user or public-internet-exposed context without that gap being
  closed first — this is already acknowledged by the project's own README
  and should not be treated as a surprise finding, but its precise scope
  should be re-confirmed.
- **Silent data-fragmentation risk**: because there is no merge tool and no
  disambiguation prompt, once two records for the same real customer are
  created, there is currently no way to reconcile them without direct
  database intervention.
- **Untested-surface risk**: with zero existing tests, any hardening
  change in Phase 3 carries a real chance of introducing a regression
  that would not be caught until manual/demo testing — mitigated by
  building the Phase 4 test suite early, ideally before or alongside the
  Phase 3 fixes rather than strictly after.
- **Concurrency risk**: no code path was found that guards against two
  simultaneous saves for the same customer racing on the balance
  computation; the practical likelihood of this in a single-owner-per-
  business tool is low today, but would rise sharply if multi-user access
  is ever added without addressing item 8 above at the same time.
