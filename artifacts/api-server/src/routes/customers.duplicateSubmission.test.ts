import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TESTS (Phase 2 — see decisions.md, Idempotency).
 *
 * These previously documented confirmed-broken behavior: a retried or
 * concurrently-duplicated request created a second ledger row every time,
 * because there was no way to recognize "this is the same logical event"
 * (audit finding A2). client_event_id now makes that recognizable. A
 * genuine retry reuses the same client_event_id as the original attempt —
 * that is the scenario these tests exercise.
 */
describe("POST /api/customers/notes — idempotent retries", () => {
  it("does not duplicate a transaction when the same client_event_id is retried sequentially", async () => {
    const payload = {
      client_event_id: newEventId(),
      customer_name: "Sequential Duplicate Ramesh",
      amount: 1000,
      amount_type: "received",
    };

    const first = await request(app).post("/api/customers/notes").send(payload);
    const second = await request(app).post("/api/customers/notes").send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200); // replayed, not newly created
    expect(second.body.transaction.id).toBe(first.body.transaction.id);

    const customerId = first.body.customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    expect(detail.body.transactions).toHaveLength(1);
    expect(detail.body.balance).toBeCloseTo(-1000, 2);
  });

  it("does not duplicate a transaction when the same client_event_id is submitted concurrently", async () => {
    const customerName = "Concurrent Duplicate Ramesh";

    // Create the customer first so this test isolates the idempotency
    // mechanism from the separate customer-identity race (see
    // customers.identity.test.ts for that one).
    const setupRes = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1,
      amount_type: "received",
    });
    expect(setupRes.status).toBe(201);
    const customerId = setupRes.body.customer.id;

    const payload = {
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 750,
      amount_type: "received",
    };

    const [first, second] = await Promise.all([
      request(app).post("/api/customers/notes").send(payload),
      request(app).post("/api/customers/notes").send(payload),
    ]);

    // Exactly one of the two should have created the row (201); the other
    // must recognize the race and replay instead of duplicating (200).
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 201]);

    const detail = await request(app).get(`/api/customers/${customerId}`);

    // 1 setup transaction (-1) + exactly 1 of the "duplicate" submissions (-750) = 2 rows.
    expect(detail.body.transactions).toHaveLength(2);
    expect(detail.body.balance).toBeCloseTo(-751, 2);
  });

  it("rejects a reused client_event_id whose payload materially differs from the original (409)", async () => {
    const eventId = newEventId();

    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: eventId,
      customer_name: "Conflict Test Customer",
      amount: 1000,
      amount_type: "received",
    });
    expect(first.status).toBe(201);

    const conflicting = await request(app).post("/api/customers/notes").send({
      client_event_id: eventId,
      customer_name: "Conflict Test Customer",
      amount: 500, // different amount under the same event id
      amount_type: "received",
    });
    expect(conflicting.status).toBe(409);

    const customerId = first.body.customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    // The conflicting attempt must not have mutated anything.
    expect(detail.body.transactions).toHaveLength(1);
    expect(detail.body.balance).toBeCloseTo(-1000, 2);
  });
});
