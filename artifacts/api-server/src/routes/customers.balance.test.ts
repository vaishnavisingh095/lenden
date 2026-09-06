import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

/**
 * INVARIANT / REGRESSION TEST.
 *
 * balance must always equal SUM(transactions.amount) for a customer. This
 * is expected to pass today — there is no separate stored balance column
 * anywhere to drift out of sync (see audit finding, Balance Invariant
 * section: balance is computed fresh via SQL SUM on every read).
 */
describe("Balance invariant", () => {
  it("balance always equals the sum of that customer's transaction amounts after a mix of purchase/payment writes", async () => {
    const customerName = "Balance Invariant Test";

    const outstanding1 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 2000,
      amount_type: "outstanding",
    });
    expect(outstanding1.status).toBe(201);
    const customerId = outstanding1.body.customer.id;

    const received1 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 500,
      amount_type: "received",
    });
    expect(received1.status).toBe(201);

    const outstanding2 = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 1500,
      amount_type: "outstanding",
    });
    expect(outstanding2.status).toBe(201);

    const detail = await request(app).get(`/api/customers/${customerId}`);
    expect(detail.status).toBe(200);

    const independentlySummedBalance = detail.body.transactions.reduce(
      (sum: number, t: { amount: string }) => sum + Number(t.amount),
      0,
    );

    expect(detail.body.balance).toBeCloseTo(independentlySummedBalance, 2);
    expect(detail.body.balance).toBeCloseTo(2000 - 500 + 1500, 2);
  });
});
