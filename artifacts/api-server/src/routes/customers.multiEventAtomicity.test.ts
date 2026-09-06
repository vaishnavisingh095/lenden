import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

/**
 * CHARACTERIZATION TESTS (P0).
 *
 * A single transcript's events are saved as independent HTTP requests, each
 * in its own DB transaction, with no outer transaction spanning the whole
 * transcript. These tests document that current behavior — see audit
 * finding A1 (partial persistence) and its interaction with A2 (no
 * idempotency) on naive retry.
 */
describe("POST /api/customers/notes — multi-event atomicity (characterization)", () => {
  it("CURRENTLY leaves an earlier event committed when a later event from the same transcript fails (BUG — no cross-event transaction, see audit finding A1)", async () => {
    const customerName = "Sharma Partial Failure";

    const event1 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(event1.status).toBe(201);

    const event2 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: null,
      amount_type: "outstanding",
    });
    expect(event2.status).toBe(500); // "Amount is required when recording an outstanding amount."

    const customerId = event1.body.customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    // Event 1 is still committed even though event 2 (same transcript) failed.
    expect(detail.body.transactions).toHaveLength(1);
    expect(detail.body.balance).toBeCloseTo(-3000, 2);
  });

  it("CURRENTLY duplicates the already-succeeded event when the whole transcript is retried after a partial failure (BUG — compounds A1 with A2)", async () => {
    const customerName = "Sharma Retry After Partial Failure";

    // First attempt: event 1 succeeds, event 2 fails (missing amount).
    const firstEvent1 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(firstEvent1.status).toBe(201);

    const failedEvent2 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: null,
      amount_type: "outstanding",
    });
    expect(failedEvent2.status).toBe(500);

    // Naive retry: resubmit the whole transcript, including the event that
    // already succeeded, now with the second event corrected.
    const retryEvent1 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(retryEvent1.status).toBe(201);

    const retryEvent2 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 2000,
      amount_type: "outstanding",
    });
    expect(retryEvent2.status).toBe(201);

    const customerId = firstEvent1.body.customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    const paymentRows = detail.body.transactions.filter(
      (t: { type: string }) => t.type === "payment",
    );
    const purchaseRows = detail.body.transactions.filter(
      (t: { type: string }) => t.type === "purchase",
    );

    expect(paymentRows).toHaveLength(2); // the "received 3000" event now exists twice
    expect(purchaseRows).toHaveLength(1); // the outstanding event is correctly single
    expect(detail.body.balance).toBeCloseTo(-3000 * 2 + 2000, 2);
  });
});
