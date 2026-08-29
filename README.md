# Lenden

<p align="center">
  <strong>Your business remembers — even when the paperwork doesn't.</strong>
</p>

<p align="center">
  <a href="https://lenden-omega.vercel.app/">Live Demo</a> ·
  <a href="https://github.com/vaishnavisingh095/lenden">GitHub Repository</a> ·
  <a href="https://lenden-0xu3.onrender.com/api/healthz">API Health</a>
</p>

---

## Where this started

My father runs a B2B business selling building materials — cement, steel, hardware — on credit. Customers buy today and promise to pay later. Some pay in a week. Some take 90+ days. Some he has to send a person on a bike to physically go collect from.

He already knows who owes him what — it's in his head, in a diary, in WhatsApp messages, in phone calls. The problem was never "he has no record." The problem is that his real business runs in a form no software can read: spoken language, memory, and paper.

I tried updating his Khatabook for him. Adding every customer, every transaction, by hand — it was hectic enough that I'd only get around to it once every few months. If *I* found manual entry tedious, a business owner running the operation day to day never will.

That's the actual problem Lenden solves: not "give small businesses a ledger" — every app already does that — but **remove typing entirely** for a business owner who's never going to do it.

## Why existing tools don't solve this

I looked closely at what's already out there before building anything.

| Tool | What it requires you to already have |
|---|---|
| Khatabook, OkCredit | You still type every transaction by hand |
| CredFlow, Vasooli, Vasool AI | Tally, Busy, or an equivalent ERP already in place |
| collects.io, collect.AI, HighRadius | A formal accounting system with structured invoices |
| Credgenics | You're a bank or NBFC, not a small business |

Every one of them assumes the hard part — turning real-world business activity into structured data — is already solved. None of them actually solve it. Lenden is built specifically for the businesses that don't have Tally, won't type, and have never had "clean data" to begin with — which, in India, is most small B2B businesses.

## What Lenden does

A business owner speaks naturally — in Hindi, Hinglish, or English — the way he'd talk to a person, not fill out a form:

> "Sharma ji ne teen hazaar diye, do hazaar ka naya saamaan liya, aur bola baaki paisa Monday tak dega."

Lenden transcribes it, and extracts every distinct financial event in that one sentence:

```json
{
  "events": [
    { "customer_name": "Sharma", "amount": 3000, "amount_type": "received" },
    { "customer_name": "Sharma", "amount": 2000, "amount_type": "outstanding" },
    { "customer_name": "Sharma", "amount": null, "amount_type": "promised", "promise_date": "Monday" }
  ]
}
```

Nothing saves without the owner reviewing and confirming it first — financial data can't be "AI probably got it right."

### Core features

**🎙️ Voice-first, zero typing** — the input is speech, not a form. Text entry exists as a fallback, not the primary path.

**🌐 Hindi, Hinglish, English** — built around how people actually talk, including mid-sentence language switching, not a translated English UI.

**🧠 Real transaction ledger, not a flat balance** — every purchase, payment, and adjustment is its own record. Balance is always calculated from history, never overwritten. A promise ("I'll pay Monday") is stored separately and never silently counted as money received.

**📞 One-tap action, owner stays in control** — Call and WhatsApp buttons open the owner's own phone and WhatsApp with a message pre-filled. He still hits send himself. Lenden never contacts a customer automatically or without the owner seeing it first.

**📅 Promise tracking with correct status** — every promise is tracked as upcoming, due today, overdue, or paid, matched automatically against actual payments.

**📊 Payment Reliability — historical fact, not a prediction** — for each customer: average days late, promises kept vs. broken, average follow-ups needed before payment. This is a summary of what already happened, not a forecast. We deliberately avoid claiming Lenden "predicts" future behavior — with the amount of history any single business realistically has, that claim wouldn't be honest.

**⭐ Follow-up recommendations with a reason, not a black box** — Lenden tells the owner who needs attention and *why* ("payment is overdue and there's still an outstanding balance"), using a simple, explainable priority score — not an opaque AI judgment a business owner has to just trust.

## Product flow

```
Owner speaks naturally
        ↓
Sarvam speech-to-text (Hindi/Hinglish/English)
        ↓
AI extracts 1–3 structured events
        ↓
Owner reviews & confirms — nothing saves unconfirmed
        ↓
Ledger updated (purchase / payment / promise)
        ↓
Business Memory: balance, history, promises, reliability
        ↓
Follow-up priority + one-tap Call / WhatsApp
```

## Architecture

```
┌─────────────────────┐
│      Lenden UI       │
│   React + Vite       │
└──────────┬───────────┘
           │ HTTP / JSON
           ▼
┌─────────────────────┐
│     Express API      │
│      Node.js          │
└──────────┬───────────┘
           │
     ┌─────┼─────┬──────────────┐
     ▼     ▼     ▼              ▼
Transcribe  Extract  Customer   Contact/
 (Sarvam)   (AI)     Ledger    Follow-up
     │     │     │              │
     └─────┴─────┴──────────────┘
                 ▼
          PostgreSQL (Drizzle ORM)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Validation | Zod |
| Database | PostgreSQL, Drizzle ORM |
| Logging | Pino / pino-http |
| Voice / AI | Sarvam AI (Saaras v3 STT) |
| Deployment | Vercel (frontend), Render (backend) |

## API

**Health check**
```
GET /api/healthz
→ { "status": "ok" }
```

**Extract structured events from a transcript**
```
POST /api/extract
{ "transcript": "Sharma ji ne teen hazaar diye..." }
```

**Save a confirmed event to a customer's ledger**
```
POST /api/customers/notes
{ "customer_name": "...", "amount": ..., "amount_type": "received" | "outstanding" | "promised", "promise_date": "...", "notes": "..." }
```

**Get all customers with calculated balance and follow-up status**
```
GET /api/customers
```

**Get one customer's full ledger, promises, contact history, and reliability**
```
GET /api/customers/:id
```

## Local Development

**Prerequisites:** Node.js, pnpm, PostgreSQL, a Sarvam AI API key.

```bash
git clone https://github.com/vaishnavisingh095/lenden.git
cd lenden
pnpm install
```

Create a `.env` file (never commit real secrets):
```
PORT=3000
BASE_PATH=/
DATABASE_URL=your_database_url
SARVAM_API_KEY=your_sarvam_api_key
```

```bash
pnpm typecheck
pnpm build
```

## Honest Production Readiness

This is a working, deployed beta demonstrating the full voice-to-ledger-to-follow-up workflow end to end. It is **not yet hardened for unrestricted real-world business use**. Before real businesses' financial data goes through this:

- User authentication and per-business accounts (multi-tenancy)
- Strict tenant-level data isolation, enforced server-side
- Rate limiting, input hardening, and audit logging
- Automated backups and a tested recovery procedure
- Error monitoring and structured observability
- A full automated test suite covering promise-matching, ledger, and contact-tracking edge cases

I've deliberately scoped this build around proving the actual product thesis — voice-first capture into a real, correct financial ledger with useful follow-up intelligence — rather than production infrastructure that would matter only once real usage exists.

## Roadmap

**Built**
- Voice-first input (Hindi/Hinglish/English) with text fallback
- Multi-event AI extraction from a single natural sentence
- Correct ledger (purchase/payment/promise, calculated balance, no silent overwrites)
- Promise tracking with status and automatic payment matching
- Payment Reliability (historical, not predictive)
- Contact tracking + Follow-up priority engine with plain-language reasoning
- One-tap Call / WhatsApp (owner-initiated, never automated)

**Deliberately not built yet — named, not hidden**
- Photo/notebook OCR digitization
- Automated outbound reminders (WhatsApp Business API / IVR calling)
- A "why is this payment actually stuck" diagnostic engine
- Field-collection route optimization
- Multilingual support beyond Hindi/English

Each of these is a real, considered next step — left out specifically because building them now, untested, would have cost the reliability of what's already working.

## What I actually learned building this

Beyond the technical stack — AI extraction, voice interfaces, a typed API, a real ledger data model — the harder part was resisting the urge to keep adding features once the product was genuinely solving the real problem. The most important engineering decisions in this project were the things I chose *not* to build yet, and being honest about why.

## Author

**Vaishnavi Singh**
[LinkedIn](https://www.linkedin.com/in/vaishnavisingh0/) · [GitHub](https://github.com/vaishnavisingh095)

<p align="center">
  <strong>Lenden — Your business remembers.</strong>
</p>
