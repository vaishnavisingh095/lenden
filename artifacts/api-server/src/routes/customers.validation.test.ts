import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

/**
 * CHARACTERIZATION TESTS.
 *
 * These document current input-handling behavior of POST /customers/notes
 * that the audit flagged as risky. No validation logic has been changed —
 * these tests only record what the endpoint does today.
 */
describe("POST /api/customers/notes — validation edge cases (characterization)", () => {
  it("CURRENTLY treats a null amount_type as an outstanding (debt) transaction (BUG — see audit finding A7: an ambiguous extraction result silently becomes a recorded debt instead of being rejected)", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Null Amount Type Test",
      amount: 500,
      amount_type: null,
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction).not.toBeNull();
    expect(res.body.transaction.type).toBe("purchase");
    expect(Number(res.body.transaction.amount)).toBeCloseTo(500, 2);
    expect(res.body.balance).toBeCloseTo(500, 2);
  });

  it("CURRENTLY accepts amount: 0 for a received payment and creates a no-op transaction row (BUG — see audit finding A11)", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Zero Amount Test",
      amount: 0,
      amount_type: "received",
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction).not.toBeNull();
    expect(res.body.transaction.type).toBe("payment");
    expect(Number(res.body.transaction.amount)).toBeCloseTo(0, 2);
    expect(res.body.balance).toBeCloseTo(0, 2);
  });

  it("still rejects a negative amount (confirms this guard remains intact)", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Negative Amount Test",
      amount: -100,
      amount_type: "received",
    });

    expect(res.status).toBe(400);
  });
});
