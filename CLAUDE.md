# Lenden — Claude Code Engineering Instructions

You are the implementation agent for this repository. These instructions
are mandatory.

Follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for every implementation,
debugging, testing, refactoring, and documentation task in this repository.
If an instruction here and the Code of Conduct ever appear to conflict,
the Code of Conduct's principles (evidence over assumption, no AI slop,
financial correctness, the AI boundary, failure-first engineering) win.

## Before implementation

Before writing code, you must:

1. Understand the existing implementation — read it, don't assume it.
2. Identify the exact files/components affected.
3. Explain the current behavior, in your own words, based on what the code
   actually does.
4. Identify the invariant or requirement being changed.
5. Identify the important failure modes the change interacts with.
6. Prefer the smallest viable implementation.
7. Avoid speculative architecture — build for the requirement in front of
   you, not for an imagined future one.

## Before changing business logic

State, explicitly, before touching the code:

- current behavior
- desired behavior
- why the current behavior is incorrect (not just "different")
- the invariant being established
- the affected data/state
- edge cases that behavior touches
- the regression tests required to prove the change

Do this even for a change that looks small. Lenden's business logic is
financial; "small" changes here have historically been the ones that
silently corrupt a balance or a promise record.

## Testing

- Inspect the existing tests before adding new ones — don't duplicate
  coverage that already exists, and don't work around a test you don't
  understand.
- Reproduce important bugs with a real test before fixing them, when it is
  practical to do so.
- Distinguish characterization tests (what the system currently does) from
  regression tests (what the system must keep doing after a fix). Don't
  conflate the two.
- Never rewrite a test merely to make it pass. If a test is wrong, say why
  it's wrong and fix the test deliberately — don't loosen an assertion to
  clear a red run.
- Never delete a failing test without explaining, in writing, why it no
  longer applies.
- Test important invariants, not test-count metrics. One test that proves a
  real invariant is worth more than ten tests that don't.
- Test concurrency, idempotency, and failure paths wherever the change
  touches them — this is a ledger; those paths are not edge cases here,
  they're the normal case under real usage.

## Debugging

Follow this sequence, in order, and show your work at each step:

symptom → reproduction → hypotheses → evidence → root cause → smallest
robust fix → regression test

Do not jump directly from symptom to a speculative fix. A fix without an
identified root cause is a guess, and guesses on financial logic are not
acceptable.

## External dependencies

For Sarvam, PostgreSQL, or any other external dependency, consider:

- timeout
- the dependency being unavailable
- a malformed response
- an empty response
- an unexpected status code
- rate limits
- retries
- an ambiguous failure (did the operation happen or not?)

Do not add retry logic automatically. First determine whether retrying is
actually safe for that specific operation and whether the operation is
idempotent. A retry on a non-idempotent write is how duplicate financial
records get created.

## Database

Treat PostgreSQL as the sole authority for persistent financial state.

Do not introduce:

- caches
- queues
- event buses
- repository layers
- additional ORM abstraction layers
- service layers
- new databases

unless there is a demonstrated requirement — not a hypothetical one. If you
think one of these is needed, state the specific requirement that current
architecture cannot meet, first.

## Security

Never:

- expose secrets
- hardcode API keys
- weaken validation to make a test or a demo pass
- bypass server-side authorization/validation because the client already
  checked it
- log sensitive financial or customer information unnecessarily

## Documentation

Documentation must describe the actual implementation, as it exists right
now. Never document an intended architecture as though it already exists.

If the implementation diverges from `architecture.md` or `plan.md`, update
that documentation to match reality as part of the same change — don't
leave it stale for someone else to discover later.

## Communication

Reports must be concise and evidence-based. For every meaningful change,
report:

- What changed
- Why
- Tests run
- Test result
- Remaining risks
- Files changed

Do not use filler such as "robust and scalable solution," "enterprise-grade
architecture," "seamless integration," "best practices," or
"production-ready" unless the specific claim is demonstrated in the same
report, with evidence.

## Stop conditions

Stop and ask for a decision — do not proceed on your own judgment — when:

- business semantics are ambiguous
- a financial rule is unclear
- two reasonable architectures have materially different trade-offs
- a change could destroy or migrate existing data
- a proposed fix requires broad scope expansion beyond what was asked
- the simplest safe implementation is unclear

Do not silently invent product rules. When in doubt about what Lenden
_should_ do financially, that is a product decision, not an implementation
detail — surface it rather than resolving it yourself.
