import { describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, idempotencyClaimsTable } from "@workspace/db";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TESTS — P0-1, cross-table idempotency ledger.
 *
 * Invariant: one client_event_id = one logical financial event across the
 * entire write system, regardless of event type or which table it ends up
 * writing to. See decisions.md, Idempotency.
 *
 * Concurrency scenarios (B, D, E, F) repeat the race many times within one
 * test rather than trusting a single attempt, per the adversarial review's
 * explicit instruction not to rely on one lucky race.
 */

const CONCURRENCY_TRIALS = 10;

async function getClaim(clientEventId: string) {
  const [claim] = await db
    .select()
    .from(idempotencyClaimsTable)
    .where(eq(idempotencyClaimsTable.clientEventId, clientEventId));
  return claim;
}

describe("Idempotency ledger — P0-1", () => {
  // A. Sequential same-ID same-payload replay.
  it("A: sequential same id, same payload → second call replays, no duplicate", async () => {
    const payload = {
      client_event_id: newEventId(),
      customer_name: "Ledger A",
      amount: 500,
      amount_type: "received",
    };

    const first = await request(app).post("/api/customers/notes").send(payload);
    const second = await request(app).post("/api/customers/notes").send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.transaction.id).toBe(first.body.transaction.id);

    const detail = await request(app).get(`/api/customers/${first.body.customer.id}`);
    expect(detail.body.transactions).toHaveLength(1);
  });

  // B. Concurrent same-ID same-payload requests.
  it("B: concurrent same id, same payload, repeated trials → always exactly one row created", async () => {
    for (let trial = 0; trial < CONCURRENCY_TRIALS; trial += 1) {
      const payload = {
        client_event_id: newEventId(),
        customer_name: `Ledger B ${trial}`,
        amount: 500,
        amount_type: "received",
      };

      const [a, b] = await Promise.all([
        request(app).post("/api/customers/notes").send(payload),
        request(app).post("/api/customers/notes").send(payload),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 201]);

      const customerId = (a.status === 201 ? a : b).body.customer.id;
      const detail = await request(app).get(`/api/customers/${customerId}`);
      expect(detail.body.transactions).toHaveLength(1);
    }
  });

  // C. Sequential same-ID conflicting payload.
  it("C: sequential same id, conflicting payload → 409, no new row, original untouched", async () => {
    const id = newEventId();

    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: id,
      customer_name: "Ledger C",
      amount: 500,
      amount_type: "received",
    });
    expect(first.status).toBe(201);

    const conflicting = await request(app).post("/api/customers/notes").send({
      client_event_id: id,
      customer_name: "Ledger C",
      amount: 999, // different amount, same id
      amount_type: "received",
    });
    expect(conflicting.status).toBe(409);

    const detail = await request(app).get(`/api/customers/${first.body.customer.id}`);
    expect(detail.body.transactions).toHaveLength(1);
    expect(Number(detail.body.transactions[0].amount)).toBeCloseTo(-500, 2);
  });

  // D. Concurrent same-ID conflicting payload.
  it("D: concurrent same id, conflicting payload, repeated trials → exactly one 201/200, the other 409, never two rows", async () => {
    for (let trial = 0; trial < CONCURRENCY_TRIALS; trial += 1) {
      const id = newEventId();
      const customerName = `Ledger D ${trial}`;

      const [a, b] = await Promise.all([
        request(app).post("/api/customers/notes").send({
          client_event_id: id,
          customer_name: customerName,
          amount: 500,
          amount_type: "received",
        }),
        request(app).post("/api/customers/notes").send({
          client_event_id: id,
          customer_name: customerName,
          amount: 999, // conflicting amount, same id
          amount_type: "received",
        }),
      ]);

      const statuses = [a.status, b.status].sort();
      // Exactly one succeeds (201, first to claim the id); the other sees
      // a real conflict against it (409). Whichever wins is not asserted —
      // only that the outcome is unambiguous and singular.
      expect(statuses).toEqual([201, 409]);

      const winner = a.status === 201 ? a : b;
      const detail = await request(app).get(`/api/customers/${winner.body.customer.id}`);
      expect(detail.body.transactions).toHaveLength(1);
    }
  });

  // E. Same client_event_id: received vs promised, under true concurrency.
  // This is the exact P0-1 scenario: two different event types racing on
  // the same id must never both succeed.
  it("E: concurrent same id, received vs promised, repeated trials → never both succeed, never split across tables", async () => {
    for (let trial = 0; trial < CONCURRENCY_TRIALS; trial += 1) {
      const id = newEventId();

      const [received, promised] = await Promise.all([
        request(app).post("/api/customers/notes").send({
          client_event_id: id,
          customer_name: `Ledger E Received ${trial}`,
          amount: 500,
          amount_type: "received",
        }),
        request(app).post("/api/customers/notes").send({
          client_event_id: id,
          customer_name: `Ledger E Promised ${trial}`,
          amount: 500,
          amount_type: "promised",
          promise_date: "2027-01-01",
        }),
      ]);

      const statuses = [received.status, promised.status].sort();
      // Different customer names AND different types — this can never be
      // a valid replay of each other, so exactly one succeeds and the
      // other is rejected as a conflict.
      expect(statuses).toEqual([201, 409]);

      const claim = await getClaim(id);
      expect(claim).toBeDefined();
      // The claim points to exactly one kind of row, never both.
      const pointsToTransaction = claim!.transactionId !== null;
      const pointsToPromise = claim!.promiseId !== null;
      expect(pointsToTransaction && pointsToPromise).toBe(false);
      expect(pointsToTransaction || pointsToPromise).toBe(true);
    }
  });

  // F. Same client_event_id: different customers, under true concurrency.
  it("F: concurrent same id, different customers, repeated trials → never both succeed", async () => {
    for (let trial = 0; trial < CONCURRENCY_TRIALS; trial += 1) {
      const id = newEventId();

      const [customerA, customerB] = await Promise.all([
        request(app).post("/api/customers/notes").send({
          client_event_id: id,
          customer_name: `Ledger F Customer A ${trial}`,
          amount: 500,
          amount_type: "outstanding",
        }),
        request(app).post("/api/customers/notes").send({
          client_event_id: id,
          customer_name: `Ledger F Customer B ${trial}`,
          amount: 500,
          amount_type: "outstanding",
        }),
      ]);

      const statuses = [customerA.status, customerB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const claim = await getClaim(id);
      expect(claim).toBeDefined();

      // Only the winner's customer exists with a transaction under this claim.
      const winner = customerA.status === 201 ? customerA : customerB;
      expect(claim!.customerId).toBe(winner.body.customer.id);
    }
  });

  // G. Failed transaction followed by retry with the same ID.
  it("G: a failed (rolled-back) attempt leaves no usable idempotency claim, so a corrected retry with the same id succeeds", async () => {
    const id = newEventId();

    const failed = await request(app).post("/api/customers/notes").send({
      client_event_id: id,
      customer_name: "Ledger G",
      amount: null, // triggers "Amount is required..." after the claim would be taken
      amount_type: "outstanding",
    });
    expect(failed.status).toBe(500);

    // The claim itself must not have survived the rollback.
    const claimAfterFailure = await getClaim(id);
    expect(claimAfterFailure).toBeUndefined();

    const retried = await request(app).post("/api/customers/notes").send({
      client_event_id: id, // same id reused
      customer_name: "Ledger G",
      amount: 2000, // corrected
      amount_type: "outstanding",
    });
    expect(retried.status).toBe(201);

    const claimAfterRetry = await getClaim(id);
    expect(claimAfterRetry).toBeDefined();
    expect(claimAfterRetry!.transactionId).toBe(retried.body.transaction.id);
  });

  // H. Duplicate client_event_id inside one batch.
  it("H: duplicate client_event_id within one batch payload → deduplicated, exactly one claim/row", async () => {
    const id = newEventId();

    const res = await request(app).post("/api/customers/notes/batch").send({
      events: [
        { client_event_id: id, customer_name: "Ledger H", amount: 500, amount_type: "received" },
        { client_event_id: id, customer_name: "Ledger H", amount: 500, amount_type: "received" },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.events[0].replayed).toBe(false);
    expect(res.body.events[1].replayed).toBe(true);
    expect(res.body.events[0].transaction.id).toBe(res.body.events[1].transaction.id);

    const detail = await request(app).get(`/api/customers/${res.body.events[0].customer.id}`);
    expect(detail.body.transactions).toHaveLength(1);
  });

  // I. Entire batch replay.
  it("I: retrying an entire already-succeeded batch replays every event, creates nothing new", async () => {
    const events = [
      { client_event_id: newEventId(), customer_name: "Ledger I", amount: 500, amount_type: "received" },
      { client_event_id: newEventId(), customer_name: "Ledger I", amount: 200, amount_type: "outstanding" },
    ];

    const first = await request(app).post("/api/customers/notes/batch").send({ events });
    expect(first.status).toBe(201);

    const retried = await request(app).post("/api/customers/notes/batch").send({ events });
    expect(retried.status).toBe(200); // fully replayed, nothing new committed
    expect(retried.body.events.every((e: { replayed: boolean }) => e.replayed)).toBe(true);

    const detail = await request(app).get(`/api/customers/${first.body.events[0].customer.id}`);
    expect(detail.body.transactions).toHaveLength(2);
  });

  // J. Partial/failed batch must roll back idempotency state too.
  it("J: a partially-failed batch leaves no idempotency claims for ANY event in it, including the ones that would have succeeded", async () => {
    const goodId = newEventId();
    const badId = newEventId();
    const customerName = "Ledger J";

    const failedBatch = await request(app).post("/api/customers/notes/batch").send({
      events: [
        { client_event_id: goodId, customer_name: customerName, amount: 500, amount_type: "received" },
        { client_event_id: badId, customer_name: customerName, amount: null, amount_type: "outstanding" },
      ],
    });
    expect(failedBatch.status).toBe(500);

    // Direct evidence: neither id has a surviving claim.
    expect(await getClaim(goodId)).toBeUndefined();
    expect(await getClaim(badId)).toBeUndefined();

    // A corrected retry, reusing both ids, must succeed cleanly.
    const retried = await request(app).post("/api/customers/notes/batch").send({
      events: [
        { client_event_id: goodId, customer_name: customerName, amount: 500, amount_type: "received" },
        { client_event_id: badId, customer_name: customerName, amount: 200, amount_type: "outstanding" },
      ],
    });
    expect(retried.status).toBe(201);

    const detail = await request(app).get(`/api/customers/${retried.body.events[0].customer.id}`);
    expect(detail.body.transactions).toHaveLength(2);
  });
});
