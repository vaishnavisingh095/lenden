import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

/**
 * CHARACTERIZATION TESTS (P0).
 *
 * POST /customers/notes has no idempotency key and no unique constraint on
 * transactions, so a repeated logical event creates a repeated ledger row.
 * These tests document that current behavior — see audit finding A2.
 */
describe("POST /api/customers/notes — duplicate submissions (characterization)", () => {
  it("CURRENTLY creates two transaction rows for two identical sequential submissions (BUG — no idempotency, see audit finding A2)", async () => {
    const payload = {
      customer_name: "Sequential Duplicate Ramesh",
      amount: 1000,
      amount_type: "received",
    };

    const first = await request(app).post("/api/customers/notes").send(payload);
    const second = await request(app).post("/api/customers/notes").send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const customerId = first.body.customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    expect(detail.body.transactions).toHaveLength(2);
    expect(detail.body.balance).toBeCloseTo(-2000, 2);
  });

  it("CURRENTLY creates two transaction rows for two concurrent identical submissions against an existing customer (BUG — no idempotency or locking, see audit finding A2)", async () => {
    const customerName = "Concurrent Duplicate Ramesh";

    // Create the customer first so this test isolates the duplicate-transaction
    // race from the separate customer-identity race (see
    // customers.identity.test.ts for the latter).
    const setupRes = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 1,
      amount_type: "received",
    });
    expect(setupRes.status).toBe(201);
    const customerId = setupRes.body.customer.id;

    const payload = {
      customer_name: customerName,
      amount: 750,
      amount_type: "received",
    };

    const [first, second] = await Promise.all([
      request(app).post("/api/customers/notes").send(payload),
      request(app).post("/api/customers/notes").send(payload),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const detail = await request(app).get(`/api/customers/${customerId}`);

    // 1 setup transaction (-1) + 2 duplicate transactions (-750 each) = 3 rows.
    expect(detail.body.transactions).toHaveLength(3);
    expect(detail.body.balance).toBeCloseTo(-1501, 2);
  });
});
