# Lenden — Architecture (As Implemented)

Status: reverse-engineered from the repository at
`https://github.com/vaishnavisingh095/lenden` on the `main` branch as cloned
for this audit. This document describes what the code does today. It does
not describe a target or idealized architecture.

Legend used throughout: **FACT** (directly verified by reading code),
**INFERENCE** (reasonable conclusion not 100% provable from code alone,
e.g. because it depends on runtime/hosting behavior outside the repo), and
**CONCERN** (a risk or weakness worth flagging for the audit).

---

## 1. System Overview

Lenden is a two-package runtime system: a single-page React frontend and an
Express API server, backed by PostgreSQL. There is no separate AI service —
both speech-to-text and structured extraction are calls to Sarvam AI's
hosted API. FACT.

```
Owner (voice or typed text)
        ↓
React SPA — LendenInputScreen.tsx (single component, local state)
        ↓ multipart POST /api/transcribe   (voice only)
Express API — Sarvam STT (saaras:v3)
        ↓ transcript
        ↓ POST /api/extract
Express API — Sarvam chat completions (sarvam-105b, JSON-schema constrained)
        ↓ structured events (1–3 per transcript)
Review screen (client-side, editable, NOT yet persisted)
        ↓ owner taps "Save & Continue"
        ↓ POST /api/customers/notes  (once per event, sequential loop)
Express API — Postgres (Drizzle ORM): customers / transactions / promise_history
        ↓
GET /api/customers, GET /api/customers/:id
        ↓ (balance, promise status, follow-up priority all computed server-side, on read)
Customer list / customer detail / "Today" dashboard (client-side filter+sort of server data)
        ↓
tel: / wa.me links (owner-initiated contact) → POST /api/contact-events (fire-and-forget log)
```

FACT for every step above; traced directly in
`artifacts/api-server/src/routes/{transcribe,extract,customers}.ts` and
`artifacts/mockup-sandbox/src/components/mockups/lenden/LendenInputScreen.tsx`.

There is no background job, queue, scheduler, or webhook receiver anywhere
in the repository. Every state change is the direct, synchronous result of
an HTTP request initiated by the frontend. FACT.

---

## 2. Component Responsibilities

### `artifacts/api-server` (Express 5, TypeScript, bundled with esbuild)
- Owns: HTTP routing, request validation (partial — see §8), calls to
  Sarvam, all SQL access via Drizzle, all balance/priority/promise-matching
  business logic.
- Depends on: `@workspace/db` (schema + Postgres pool), `@workspace/api-zod`
  (only for the health-check response shape), Sarvam's public API,
  `pino`/`pino-http` for logging.
- FACT.

### `lib/db` (`@workspace/db`)
- Owns: Drizzle ORM table definitions (the schema), the Postgres connection
  pool (`pg`), `drizzle-kit push` tooling for schema sync.
- Exports both the schema and a live `db` client; the API server imports
  this package directly rather than talking to Postgres itself.
- FACT.

### `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` (Orval pipeline)
- Owns: an OpenAPI document and codegen'd Zod schema / React Query hooks
  generated from it.
- **FACT**: The OpenAPI spec (`lib/api-spec/openapi.yaml`) documents only
  `GET /healthz`. None of `/extract`, `/transcribe`, `/customers*`, or
  `/contact-events` are present in it. Consequently the generated
  `api-zod` and `api-client-react` packages only contain a `HealthStatus`
  type and a `useHealthCheck` hook.
- **FACT**: The frontend does not import or use `api-client-react` at all;
  every request in `LendenInputScreen.tsx` is a raw `fetch` call. This
  codegen pipeline is effectively unused by the running product.

### `artifacts/mockup-sandbox` (Vite + React 19 + Tailwind)
- Owns: the entire user-facing product.
- **FACT**: Despite its name and its origin as a component-preview tool
  (`App.tsx` resolves a URL path to a component under
  `src/components/mockups/...` and renders it — see `mockupPreviewPlugin.ts`
  and the `/preview/:path` routing in `App.tsx`), the "production homepage"
  branch of `App.tsx` unconditionally renders
  `lenden/LendenInputScreen`. This is the real, deployed frontend, not a
  design mockup, despite living in a directory and using a routing
  mechanism named for mockup previews.
- Depends on: `VITE_API_URL` (build-time env var) to know where the API
  server is; the browser's `MediaRecorder`/`getUserMedia` APIs for voice
  capture; `tel:`/`wa.me` URL schemes for contact actions.
- `src/components/mockups/lenden/HisaabHindiInputScreen.tsx` is a separate,
  earlier, fully static prototype (hardcoded transcripts, `setTimeout`-based
  fake state transitions, zero network calls). It is not reachable from the
  production route and is dead code in terms of runtime behavior. FACT.

### `lenden-sarvam-test/` (Python)
- A standalone CLI script (`transcribe.py`) used to manually test the
  Sarvam STT API from the command line. It is not imported by, called by,
  or in any way wired into the Node/Express runtime. FACT.

### `main.py` / `pyproject.toml` (repo root)
- Replit-generated "Hello world" scaffolding. Not part of the application.
  FACT.

---

## 3. Data Flow

### Voice → transaction (the primary path)

1. **Input**: Owner holds/taps the mic button in `LendenInputScreen.tsx`.
   `getUserMedia` + `MediaRecorder` capture audio as `audio/webm` (or
   `audio/webm;codecs=opus` if that's the only supported type). FACT.
2. **Transcription**: On stop, the recorded `Blob` is sent as
   `multipart/form-data` to `POST /api/transcribe`. The Express route hand-
   parses the multipart body (custom boundary-splitting code, not a
   library like `multer`) and forwards the audio to Sarvam's
   `/speech-to-text` endpoint with `model=saaras:v3`. FACT.
3. **Extraction**: The returned transcript is sent as JSON to
   `POST /api/extract`. This route calls Sarvam's chat-completions endpoint
   with a hand-written system prompt and a `json_schema`-constrained
   response format (`strict: true`), requesting 1–3 `events`, each with
   `customer_name`, `amount`, `amount_type`
   (`received`/`promised`/`outstanding`/`null`), `promise_date`, `notes`.
   Temperature is `0`. FACT.
4. **Validation (server-side, at extraction time)**: The API only checks
   that `response.ok` and that a JSON-parseable `content` string exists in
   Sarvam's reply. It does **not** independently re-validate the parsed
   object against a Zod schema before returning it to the client — it
   trusts Sarvam's schema-constrained output. FACT. See §6 and §8.
5. **Review**: The frontend shows a `screen === "result"`/`"review"` UI
   where each extracted event's `customer_name`, `amount`, `amount_type`,
   `promise_date`, and `notes` are freely editable in local state
   (`extractedEvents`) before saving. Nothing has been persisted yet at
   this point. FACT.
6. **Confirmation / persistence**: On "Save & Continue", the frontend
   filters out events with no `customer_name`, then **loops sequentially**
   and issues one `POST /api/customers/notes` per remaining event, awaiting
   each response before sending the next. FACT. There is no single
   "save all events in this transcript" endpoint or transaction spanning
   multiple events — see §8 and §12 for the implications.
7. **Server-side persistence logic** (`POST /api/customers/notes`, inside a
   single `db.transaction`, per call):
   - Validates the request body with a Zod schema
     (`saveCustomerNoteSchema`): `customer_name` required non-empty,
     `amount` optional numeric ≥ 0 (coerced to a 2-decimal string),
     `amount_type` optional enum, `promise_date` optional free-text string,
     `notes` optional string. FACT.
   - Parses `promise_date` with a hand-written `parsePromiseDate` function
     supporting: ISO dates, `"Month Day"` / `"Day Month"`, bare weekday
     names (assumed to mean "next occurrence"), `"next <weekday>"`,
     `"next month <weekday>"` / `"<weekday> next month"`, and Hinglish
     `"<N> din baad"`. Any other free-text value that fails all these
     patterns causes `parsePromiseDate` to return `null`, which is then
     detected and thrown as `"Invalid promise date."` FACT.
   - Resolves the customer by an **exact, case-insensitive match on
     `customer_name` only**. Phone number is explicitly *not* used to
     merge or deduplicate customers (documented in an inline code comment:
     different names may legitimately share a phone; the same person named
     slightly differently, e.g. "Sharma" vs. "Sharma ji", is treated as
     two distinct customers by design). FACT.
   - If no matching customer exists, one is created; the new customer's
     `amount`, `paymentStatus`, `promiseAmount`, `promiseDate`, `notes`
     columns are populated from the incoming event, largely for backward
     compatibility — the code comment states these fields are not used for
     the actual balance calculation going forward. FACT.
   - Branches on `amount_type`:
     - **`promised`**: no row is inserted into `transactions`. The
       customer's `promiseAmount`/`promiseDate`/`notes` are updated, and a
       new row is inserted into `promise_history` (`fulfilled: false`).
       Balance is *not* affected. FACT.
     - **`received`**: requires `amount` to be non-null (else throws). A
       `transactions` row is inserted with `type: "payment"`,
       `source: "voice"`, and the amount **negated** (e.g. ₹2,500 received
       → `-2500`). The code then looks for the most recent unfulfilled
       promise for that customer whose `promiseDate` is on/before the
       transaction date **and** whose `promiseAmount` exactly equals the
       received amount; if found, that promise is marked `fulfilled: true`.
       FACT.
     - **`outstanding`** (also the fallback branch if `amount_type` is
       anything else non-`promised`/non-`received`, including `null` or
       omitted): requires `amount` to be non-null (else throws). A
       `transactions` row is inserted with `type: "purchase"`,
       `source: "voice"`, and the amount stored **positive**. FACT.
   - After the branch, the customer's balance is recomputed and returned
     as `COALESCE(SUM(transactions.amount), 0)` for that customer. FACT.

### Text input → transaction

Identical to the voice path from step 3 onward: typed text goes straight to
`POST /api/extract` (transcription is skipped), producing the same
`extractedEvents` review state and the same save loop. FACT.

---

## 4. Data Model

All tables are defined with Drizzle ORM in `lib/db/src/schema/*.ts`, one
file per table, and are provisioned into Postgres via `drizzle-kit push`
(no committed SQL migration files exist — schema changes are pushed
directly). FACT.

### `customers`
- `id` (serial, PK)
- `customerName` (text, not null) — the sole identity key used for
  matching (case-insensitive) when saving a note.
- `amount` (numeric 14,2, nullable) — legacy/compatibility field, set at
  creation time; **not** used to compute the authoritative balance.
- `paymentStatus` (enum: `received`/`promised`/`outstanding`, not null)
- `promiseAmount` (numeric 14,2, nullable) — the *current/latest* promise
  amount, denormalized onto the customer row.
- `promiseDate` (timestamptz, nullable) — the *current/latest* promise
  date, denormalized onto the customer row.
- `notes` (text, nullable)
- `phone` (text, nullable) — a single "primary" phone kept in sync with
  `customer_phones` (see below).
- `createdAt`, `updatedAt` (timestamptz)
- FACT.

### `transactions`
- `id` (serial, PK)
- `customerId` (integer, FK → customers.id, not null)
- `amount` (numeric 14,2, not null) — **signed**: negative for payments
  received, positive for purchases/outstanding amounts. This signed-sum
  design is what makes balance a simple `SUM()`.
- `type` (enum: `purchase`/`payment`/`adjustment`, not null) — only
  `purchase` and `payment` are ever inserted by the current routes;
  `adjustment` is defined in the schema but never produced anywhere in the
  code. CONCERN/INFERENCE: likely reserved for a future manual-correction
  feature that does not yet exist.
- `date` (timestamptz, defaults to now, not null)
- `source` (enum: `voice`/`type`, not null) — **CONCERN**: every insert
  site in `customers.ts` hardcodes `source: "voice"`, including the code
  path reached from typed text input. The `type` source value is defined
  in the schema but never actually written by any current code path, so
  this field does not reliably distinguish voice-originated from
  typed-originated transactions despite appearing to be designed for that.
- `notes` (text, nullable)
- FACT.

### `promise_history`
- `id` (serial, PK)
- `customerId` (integer, FK → customers.id, not null)
- `promiseDate` (timestamptz, not null)
- `promiseAmount` (numeric 14,2, nullable)
- `createdAt` (timestamptz, defaults to now, not null)
- `fulfilled` (boolean, defaults false, not null)
- One row is inserted per `promised` event saved; there is no update path
  that edits or removes a promise row other than flipping `fulfilled` to
  `true` via the payment-matching logic in `POST /customers/notes`. FACT.

### `contact_events`
- `id` (serial, PK)
- `customerId` (integer, FK → customers.id, not null)
- `method` (enum: `call`/`whatsapp`, not null)
- `timestamp` (timestamptz, defaults to now, not null)
- Written by `POST /api/contact-events`, fired from the frontend's
  `onClick` handler on the `tel:`/`wa.me` links, *before* the browser
  actually navigates to the link. There is no confirmation that the call or
  WhatsApp message was actually made, sent, or answered — only that the
  owner clicked the button. FACT.

### `customer_phones`
- `id` (serial, PK)
- `customerId` (integer, FK → customers.id, `onDelete: cascade`, not null)
- `phone` (text, not null)
- `label` (text, nullable)
- `isPrimary` (boolean, defaults false, not null)
- `createdAt`, `updatedAt` (timestamptz)
- Supports multiple phone numbers per customer with one marked primary;
  the "primary" number is also mirrored onto `customers.phone` for
  backward compatibility whenever it changes. FACT.

### `customer_history` — **defined but unused**
- Schema exists (`lib/db/src/schema/customerHistory.ts`) with columns
  mirroring an older version of the customer/payment model
  (`amount`, `paymentStatus`, `promiseDate`, `notes`), and is exported from
  the package's `index.ts`.
- **FACT**: A repository-wide search found no `insert`, `select`, `update`,
  or `delete` call anywhere against `customerHistoryTable`. It is dead
  schema — likely a leftover from an earlier design iteration before the
  `transactions` + `promise_history` model was introduced.

### Relationships
- `customers` 1—N `transactions`
- `customers` 1—N `promise_history`
- `customers` 1—N `contact_events`
- `customers` 1—N `customer_phones`
- All foreign keys reference `customers.id`; only `customer_phones` declares
  `onDelete: cascade` — the others do not specify an `onDelete` behavior
  (Postgres/Drizzle default, which is `NO ACTION`). FACT. This means a
  customer with existing transactions/promises/contact-events cannot
  currently be deleted without a foreign-key violation — though no delete
  endpoint for customers exists in the API anyway, so this is latent rather
  than exercised.

---

## 5. Source of Truth

- **Balance**: Current implementation derives balance entirely from
  `SUM(transactions.amount)`, computed fresh on every read (list view,
  detail view, and immediately after each write). There is no
  `customers.balance` column, and the legacy `customers.amount` field is
  explicitly documented in code comments as not used for this purpose.
  FACT — this is a genuine strength: balance cannot silently drift from
  transaction history because it is never stored redundantly.
- **Promises**: Current implementation stores promise state in **two
  places**: a denormalized "current promise" on `customers`
  (`promiseAmount`/`promiseDate`) and a full history in
  `promise_history`. The customer-detail endpoint prefers
  `promise_history` (picking the earliest unfulfilled promise) and falls
  back to the denormalized `customers` fields only if `promise_history` has
  no unfulfilled rows. **This creates a potential consistency concern**:
  the two representations are written together inside the same
  transaction today, but nothing in the schema enforces that they stay in
  sync, and a future code path that updates one without the other would
  silently desynchronize them.
- **Customer identity**: Current implementation uses `customer_name`
  (case-insensitive exact match) as the sole identity key. Phone number is
  captured but deliberately not used for identity resolution. This is a
  documented design choice in the code, not an oversight, but it does mean
  the "source of truth" for who is a distinct customer is a free-text
  string the AI transliterates from speech — see §6 and §12.
- **Transactions**: persisted directly in Postgres via Drizzle; no
  intermediate cache, queue, or event log. The API server is the only
  writer.
- **Customer state**: persisted directly in Postgres; same as above.

---

## 6. AI Boundary

- **What AI receives**: (1) Sarvam STT receives raw audio bytes plus a
  fixed `model`/`mode` pair. (2) Sarvam's chat-completions endpoint
  receives a system prompt (rules for event extraction, amount-word
  conversion, and Devanagari-to-Latin name transliteration) and the raw
  transcript as the user message. No transaction history, no customer
  list, and no prior context is ever sent to the model. FACT.
- **What AI returns**: STT returns a transcript string and a language
  code. Extraction returns a JSON object matching a fixed schema:
  `{ events: [{ customer_name, amount, amount_type, promise_date, notes }] }`,
  1 to 3 items, enforced via Sarvam's `strict` JSON-schema response format.
  FACT.
- **How AI output is validated**: The API checks only that the HTTP call
  succeeded and that the response content parses as JSON; it does not
  independently re-validate the parsed object's shape (e.g. with the
  Zod schemas that exist elsewhere in the codebase) before forwarding it
  to the frontend. The frontend, in turn, does its own light validation at
  save time (via `saveCustomerNoteSchema` on the server, when the event is
  actually submitted) but performs no schema validation on the raw
  extraction response before rendering it into the editable review UI.
  FACT — this means a schema violation from Sarvam (should `strict` mode
  ever fail to hold) would surface as a runtime type mismatch in the React
  UI rather than a handled error.
- **Can AI directly mutate financial state?** No. FACT. Extraction only
  produces `extractedEvents` in client-side React state. The only path to
  a database write (`POST /api/customers/notes`) requires an explicit user
  action (tapping "Save & Continue") and passes through the server's own
  Zod validation (`saveCustomerNoteSchema`) independent of anything the AI
  returned.
- **Where user confirmation occurs**: The `"result"`/`"review"` screen in
  `LendenInputScreen.tsx`, where every field of every extracted event is
  editable before the save loop fires. FACT.
- **What happens when extraction fails**: If Sarvam's HTTP call fails or
  returns a non-OK status, the API returns a `502` with a generic or
  provider-derived error message; the frontend catches this, sets
  `errorMessage`, and returns the screen to `"ready"`. If Sarvam returns OK
  but with unparseable JSON in `content`, the API returns a `502` with
  `"Sarvam returned invalid structured data"`. If `events` is present but
  empty or not an array, the frontend's guard (`.slice(0,3)` on an
  `Array.isArray` check) can result in an empty `extractedEvents` array
  reaching the review screen — in the typed-text path this is caught
  explicitly (`"Could not find any payment details."`); in the voice path,
  no equivalent explicit empty-array check was found before
  `setScreen("result")`, so **an empty review screen with zero events is
  reachable via voice input if extraction returns a well-formed but empty
  `events` array**. CONCERN — flagged for the audit, not fixed here.

---

## 7. External Dependencies

| Dependency | Purpose | Called from | Data crossing boundary | On failure | Can app continue without it? |
|---|---|---|---|---|---|
| Sarvam AI — Speech-to-Text (`api.sarvam.ai/speech-to-text`, `saaras:v3`) | Converts recorded audio to text | `POST /api/transcribe` | Raw audio bytes out; transcript + language code in | Route returns `502` with provider or generic message; frontend shows `errorMessage`, resets to `"ready"` | No — voice input is unusable without it. Typed text input is unaffected (bypasses this call entirely). |
| Sarvam AI — Chat Completions (`api.sarvam.ai/v1/chat/completions`, `sarvam-105b`) | Extracts structured financial events from a transcript | `POST /api/extract` | Transcript text out; structured JSON event array in | Route returns `502`; frontend shows `errorMessage` | No — both voice and typed-text paths depend on this call; there is no local/offline extraction fallback. |
| PostgreSQL (via `pg` + Drizzle ORM) | System of record for customers, transactions, promises, contact events, phones | `@workspace/db`, used throughout `customers.ts` | Full read/write of all business data | Uncaught DB errors are caught by each route's try/catch and returned as `500`s with generic messages; the process itself does not crash on a single failed query. If `DATABASE_URL` is unset, the process throws at startup and never begins listening. | No — every business feature (saving, reading, balances, follow-up) requires the database. |
| `pino` / `pino-http` | Structured logging | `app.ts`, every route's `req.log.error(...)` calls | Log lines only; explicitly redacts `authorization`, `cookie`, `set-cookie` headers | N/A (logging failures are not specially handled) | Yes — logging is not on the request-serving critical path in a way that would block a response. |

No other third-party runtime services are called anywhere in the traced
code. FACT.

---

## 8. Error and Failure Boundaries

| Scenario | Current behavior |
|---|---|
| Network failure reaching Sarvam (either endpoint) | Caught in a `try/catch`; route returns `502` with a fixed or provider-derived message; logged via `req.log.error`. FACT. |
| AI (extraction) failure — non-OK HTTP status | Returns `502 { error: "Sarvam extraction failed" }`; provider response body is logged but not returned to the client. FACT. |
| AI returns malformed/unparseable JSON in `content` | Caught explicitly; returns `502 { error: "Sarvam returned invalid structured data" }`, and the malformed content is logged. FACT. |
| AI returns a well-formed but empty `events` array | Typed-text path explicitly throws `"Could not find any payment details."` Voice path: no equivalent explicit check was found before transitioning to the review screen — **not currently handled / requires inspection** as a distinct code path from the typed-text one. |
| Speech-to-text failure (no speech detected) | Handled: if `transcript` is empty after trimming, frontend sets `"No speech was detected."` and returns to `"ready"` without calling `/extract`. FACT. |
| Empty input (typed text) | The typed-text "Continue" button is `disabled` when `typedText.trim()` is empty, preventing the request from firing. FACT. |
| Invalid input to `/api/customers/notes` | Server-side Zod validation (`saveCustomerNoteSchema`) rejects with `400` and field-level errors from `parsed.error.flatten().fieldErrors`. FACT. |
| Invalid/unrecognized `promise_date` string | Explicitly handled: `parsePromiseDate` returning `null` for a non-empty input causes the transaction to throw `"Invalid promise date."`, surfaced as a `500` with that message (not a `400`, since it is thrown inside the `db.transaction` block after the initial Zod pass already succeeded). CONCERN: this is a validation failure surfaced with a `500` status rather than a `400`, which is a minor semantic mismatch worth revisiting in hardening, though the message itself is user-appropriate. |
| Persistence failure (DB error) mid-write | Each route wraps its logic in try/catch; on error, `req.log.error` is called and a `500` is returned. Because `/customers/notes` wraps its logic in a single `db.transaction`, a failure partway through **that one event's** write (customer create/update, transaction insert, promise insert, balance read) is rolled back atomically by Postgres. **However**, since the frontend saves multiple events from one transcript via a *sequential loop of separate HTTP requests*, a failure on event 2 of 3 does **not** roll back event 1, which has already been committed in its own separate transaction. Not currently handled — this is a multi-event atomicity gap, not a single-request atomicity gap. |
| Missing customer (looked up by ID, not found) | `GET /customers/:id`, phone-management endpoints, and `/contact-events` all explicitly check for a `null` result and return `404`. FACT. |
| Ambiguous customer (e.g. two people could plausibly be "Sharma") | Not currently handled / requires inspection. The system does not attempt fuzzy matching, disambiguation prompts, or confirmation UI when a name is close-but-not-identical to an existing customer; it will silently create a new, separate customer record. This is a documented design choice (see §5) rather than an oversight, but its consequences for data quality are not otherwise mitigated anywhere in the UI (e.g. no "did you mean an existing customer?" prompt). |
| Duplicate submission (e.g. double-tap on "Save & Continue") | Not currently handled. The "Save & Continue" button has no `disabled` state tied to an in-flight request, unlike the typed-text "Continue" button (which is disabled only on empty input, not on in-flight state) and the "Add phone" button (which does have a `disabled={!newPhone.trim()}` guard, also not an in-flight guard). A rapid double-tap can fire the entire save loop twice, creating duplicate `transactions`/`promise_history` rows. |
| Invalid customer/phone ID route params (non-numeric) | Explicitly handled: every route parameterized by `:id`/`:phoneId` checks `Number.isInteger(...)` and returns `400` if it fails. FACT. |
| Duplicate phone number for the same customer | Explicitly handled: both create and update phone endpoints check for an existing identical phone number on that customer and return `409`. FACT. |

---

## 9. State Ownership

| State | Lives in |
|---|---|
| Current screen (`ready`/`listening`/`review`/`today`/etc.), typed text, transcript, extracted events (pre-save), selected customer detail, phone-editing form state, in-flight error messages | React component state (`useState`) inside `LendenInputScreen.tsx` only. No global store (Redux/Zustand/Context) is used anywhere. FACT. |
| Customer list, individual customer detail, balances, promise status, follow-up priority/reason, payment reliability stats, contact history | Computed server-side on each `GET` request from Postgres; held client-side only as the last-fetched snapshot in component state until the next `loadCustomers()`/`loadCustomer(id)` call. FACT. |
| Recorded audio | A `MediaRecorder` instance and `Blob` chunks held in `useRef`, never persisted to disk or the server beyond the single `/api/transcribe` upload. FACT. |
| Authoritative financial state (customers, transactions, promises, contact events, phones) | PostgreSQL only. FACT. |
| Anything in the URL, cookies, or browser storage | None found. FACT: no `localStorage`, `sessionStorage`, cookies, or URL query/state parameters are used anywhere in the frontend for application state (the only "routing" is the `/preview/:path` mechanism used for the component-preview harness, unrelated to app state). |

---

## 10. Security

- **API keys**: `SARVAM_API_KEY` is read only server-side
  (`process.env.SARVAM_API_KEY` in `extract.ts`/`transcribe.ts`) and is
  never sent to or exposed in the frontend bundle. FACT.
- **Database credentials**: `DATABASE_URL` is read only in `lib/db`
  (server-side package), never referenced from frontend code. FACT.
- **Environment variables in the frontend**: only `VITE_API_URL` (the
  API's base URL, not a secret) is baked into the client bundle at build
  time via Vite's `import.meta.env`. FACT.
- **Client/server boundary**: clean — no server-only secret is imported
  into any file under `artifacts/mockup-sandbox`. FACT.
- **Input validation**: present but inconsistent in strength. `Zod` is used
  for `POST /api/customers/notes` (`saveCustomerNoteSchema`) but not for
  `POST /api/extract` (a hand-rolled `typeof req.body?.transcript === "string"`
  check), not for `POST /api/contact-events` (manual `Number.isInteger`
  and literal-value checks), and not for the phone-management endpoints
  (manual trimming/type checks). FACT — validation exists everywhere in
  some form, but its rigor and consistency vary by route.
- **Authentication / authorization**: **none exists anywhere in the
  system.** Every route under `/api` is unauthenticated and
  unauthorized — there is no login, no session, no API key required from
  clients, no per-user or per-business data scoping. `cors()` is applied
  with no configuration (i.e., permissive defaults). `cookie-parser` is a
  declared dependency but is never wired into the Express app. FACT — this
  matches the README's own "Honest Production Readiness" disclosure, which
  explicitly names authentication and multi-tenancy as not yet built.
- **Sensitive data exposure**: Customer names, phone numbers, and financial
  amounts are returned in full by `GET /customers` and `GET /customers/:id`
  to any caller — there is no scoping, since there is no concept of "whose
  data this is" in the schema (no `businessId`/`ownerId`/tenant column
  anywhere). FACT. The `pino` logger redacts `authorization`/`cookie`
  headers but does not redact request or response bodies, so customer
  names/amounts/phone numbers can appear in application logs at `error`
  level whenever a route logs `req.body` or similar (worth confirming
  during the audit exactly which error logs include body contents — this
  document does not assert that they do, only that no redaction exists to
  prevent it).

---

## 11. Deployment

- **Frontend**: Vite-built static SPA. The README states it is deployed to
  Vercel (`https://lenden-omega.vercel.app/`). INFERENCE (from README +
  the presence of a Vite build script) rather than FACT, since no
  `vercel.json` or other Vercel-specific config file exists in the
  repository — deployment configuration for Vercel, if any beyond
  framework auto-detection, is not present in the codebase and must live
  in the Vercel project's own dashboard settings.
- **Backend**: Express server bundled with esbuild into a single ESM file
  (`dist/index.mjs`) and started with `node --enable-source-maps`. The
  README states it is deployed to Render
  (`https://lenden-0xu3.onrender.com/api/healthz`). INFERENCE similarly —
  no `render.yaml` or Dockerfile exists in the repository; Render's build
  command is presumably configured directly in Render's dashboard to run
  `pnpm --filter @workspace/api-server run build` and
  `pnpm --filter @workspace/api-server run start` (this is the only build/
  start pair defined for the API server package, but the actual Render
  configuration itself is external to this repo and was not verifiable
  from the code alone).
- **Build process**: `pnpm run build` at the repo root runs a full
  TypeScript typecheck (`tsc --build` across `lib/*`, then package-level
  typechecks under `artifacts/*` and `scripts`) followed by each package's
  own `build` script where present. FACT.
- **Runtime requirements**: Node.js (engine version not pinned in any
  `package.json` at the time of this audit — `replit.md` states "Node.js
  24" as a documentation note, not a `package.json` `engines` field), a
  reachable PostgreSQL instance, and a valid `SARVAM_API_KEY`. FACT for the
  latter two (enforced by throwing at startup/request-time respectively);
  INFERENCE for the exact Node version actually running in production.
- **Required environment variables** (server): `PORT` (throws at startup
  if missing/invalid), `DATABASE_URL` (throws at import time if missing),
  `SARVAM_API_KEY` (checked per-request in `extract.ts`/`transcribe.ts`,
  returns `500` if missing rather than crashing the whole server),
  `LOG_LEVEL` (optional, defaults to `"info"`), `NODE_ENV` (used to decide
  whether to enable `pino-pretty` transport). FACT.
- **Required environment variables** (frontend build): `VITE_API_URL`
  (defaults to empty string, meaning same-origin requests, if unset),
  `BASE_PATH` (defaults to `"/"`, affects Vite's `base` config and static
  asset paths). FACT.
- **Production assumptions embedded in code**: the server assumes it is
  always reachable at whatever origin the frontend's `VITE_API_URL` was
  built with — there is no runtime service discovery or environment
  detection beyond that single build-time variable. `cors()` is called
  with no allow-list, so in production any origin can call the API. FACT.

---

## 12. Known Architectural Concerns

This section only lists observations. None of these are fixed as part of
this task.

1. **CONCERN — Multi-event save is not atomic across events.** A single
   voice transcript can produce up to 3 events, saved via 3 sequential,
   independent HTTP requests, each in its own DB transaction. A failure on
   the 2nd or 3rd request leaves the 1st (or 1st+2nd) already committed,
   with no compensating action and no clear UI indication of *which*
   events actually saved versus failed. (FACT: sequential loop, confirmed
   in code. INFERENCE: this is likely to confuse a business owner about
   what was actually recorded after a partial failure.)

2. **CONCERN — No duplicate-submission guard on the primary save action.**
   The "Save & Continue" button is not disabled while its save loop is
   in-flight, unlike some other buttons in the same file that do have
   (non-loading-related) `disabled` guards. A double-tap can duplicate
   financial records. FACT (absence of `disabled` confirmed by search).

3. **CONCERN — Two independently-maintained promise-status/follow-up rule
   sets.** The list endpoint (`GET /customers`) and the detail endpoint
   (`GET /customers/:id`) each compute `priority`/`recommendedAction`/
   `reason` with separately written logic that is similar but not
   textually identical (e.g. differing thresholds' exact wording, and the
   list endpoint's high-balance thresholds — ₹50,000 / ₹20,000 — do not
   appear in the detail endpoint's logic at all, which instead branches
   only on promise status). A future change to one is not guaranteed to be
   mirrored in the other. FACT (both blocks read and compared directly).

4. **CONCERN — Denormalized promise fields on `customers` can drift from
   `promise_history`.** Both are written together today, but there is no
   database constraint or single-writer abstraction preventing future code
   from updating one without the other. INFERENCE (based on schema
   design, not an observed bug).

5. **CONCERN — Dead schema (`customer_history` table) with no code path.**
   Increases cognitive load for anyone reading the schema and risks being
   mistaken for the actual history mechanism (`promise_history` +
   `transactions` play that role instead). FACT.

6. **CONCERN — `transactions.source` does not reliably distinguish input
   method.** Every insert site hardcodes `source: "voice"` regardless of
   whether the save originated from the voice or typed-text flow (both
   converge on the same `/api/customers/notes` call with no `source` field
   in the request body). The `"type"` enum value is unreachable in
   practice today. FACT.

7. **CONCERN — Customer identity is a fragile, case-insensitive exact-name
   match with no disambiguation UI.** This is an intentional design choice
   (documented in code comments) rather than an oversight, but it means
   minor AI transliteration inconsistencies (e.g. "Sharma" one time,
   "Sharma Ji" another) will silently fragment one real customer into
   multiple records, with no merge tool anywhere in the API or UI. FACT
   (design) + INFERENCE (real-world consequence).

8. **CONCERN — No authentication, authorization, or tenant isolation.**
   Already disclosed by the project's own README as a known gap, but worth
   restating precisely: every endpoint is fully open, and the schema has
   no concept of "which business owns this customer," so multi-tenant use
   is not just unauthenticated but structurally unsupported without a
   schema change. FACT.

9. **CONCERN — AI extraction output is not independently re-validated
   server-side before being handed to the client.** The API trusts
   Sarvam's `strict` JSON-schema mode to guarantee shape; there is no
   defensive Zod (or similar) parse of the extraction response before
   `res.json(extracted)`. A provider-side schema violation would surface
   as an unhandled shape mismatch in the frontend rather than a clean
   error. FACT (absence of a validation step confirmed by reading the full
   route).

10. **CONCERN — Empty-events edge case unhandled on the voice path.** The
    typed-text flow explicitly throws when zero events are returned; no
    equivalent check was found on the voice (`transcribe`) flow before
    transitioning to the review screen. Not currently handled / requires
    inspection to confirm actual runtime behavior (e.g. whether the review
    screen renders acceptably with zero events or errors ungracefully).

11. **CONCERN — Inconsistent input-validation rigor across routes.** Zod is
    used on the highest-stakes write (`/customers/notes`) but not on
    `/extract`, `/contact-events`, or the phone-management routes, which
    instead use ad hoc manual checks. Not a correctness bug observed today,
    but an inconsistency worth normalizing during hardening. FACT.

12. **CONCERN — Orval/OpenAPI codegen pipeline is present but effectively
    dead weight.** It only covers `/healthz` and is not used by the
    frontend for any business-logic call, despite the workspace being
    structured as if it were the intended API-contract mechanism. FACT.

13. **CONCERN — No automated tests exist anywhere in the repository.**
    Every behavior described in this document — balance derivation,
    promise matching, follow-up priority, promise-date parsing — is
    currently unverified by any regression suite. FACT.

14. **CONCERN — No global Express error-handling middleware.** Each route
    hand-rolls its own try/catch; a route that forgets to catch a thrown
    error (or a bug in shared code invoked by multiple routes) would
    surface as an unhandled rejection / default Express error response
    rather than a controlled, consistently-shaped error payload. FACT
    (`middlewares/` is empty; `app.ts` registers no error-handling
    middleware after the router).

15. **FACT (confirmed bug) — `"<weekday> next month"` phrasing never
    returns a value.** In `parsePromiseDate`, the `weekdayNextMonthMatch`
    branch (matching input like `"friday next month"`) computes `result`
    and sets its date/hours, but the `if (weekdayNextMonthMatch) { ... }`
    block closes with no `return result;` statement
    (`customers.ts`, the block ending at the closing brace right before the
    `din baad` check). Execution falls through to the next pattern check,
    which does not match, so the function ultimately returns `null` for
    this phrasing — which then causes the caller to throw
    `"Invalid promise date."` even though the input matched a supported
    pattern. Note the sibling branch `nextMonthWeekdayMatch` (`"next month
    <weekday>"`, checked earlier) *does* return correctly — only the
    `"<weekday> next month"` word order is affected. This is a confirmed
    logic bug, not a hypothesis, though it is being documented rather than
    fixed as part of this task.
