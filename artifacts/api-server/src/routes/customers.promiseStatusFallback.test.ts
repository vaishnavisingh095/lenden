import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TEST — P1-4, stale legacy-field fallback.
 *
 * Once a customer's only promise is fully paid, the detail endpoint must
 * report it as paid — not fall back to the legacy customers.promiseDate/
 * promiseAmount fields (which are never cleared once a promise is settled)
 * and incorrectly resurrect it as still-open/overdue. See decisions.md,
 * Legacy Promise Fallback.
 */
describe("Promise status — legacy fallback only applies with zero promise_history rows", () => {
  it("a single fully-paid, past-due promise resolves to promiseStatus 'paid', not 'overdue'", async () => {
    const customerName = "Fallback Fix Single Promise";

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: "2020-01-01", // far in the past
    });
    expect(promised.status).toBe(201);
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const detail = await request(app).get(`/api/customers/${customerId}`);

    expect(detail.body.promises[0].fulfilled).toBe(true);
    expect(detail.body.promiseStatus).toBe("paid");
    expect(detail.body.followUp.reason).not.toMatch(/overdue|missed/i);
  });

  it("a fully-paid promise plus a separate, unrelated positive balance still resolves to 'paid' for the promise (not overdue)", async () => {
    const customerName = "Fallback Fix With Unrelated Balance";

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 5000,
      amount_type: "outstanding",
    });

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: "2020-01-01",
    });
    const customerId = promised.body.customer.id;

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });

    const detail = await request(app).get(`/api/customers/${customerId}`);

    expect(detail.body.promises.find((p: { promiseAmount: string }) => Number(p.promiseAmount) === 1000).fulfilled).toBe(true);
    expect(detail.body.promiseStatus).toBe("paid");
    // The remaining ₹5000 balance still deserves follow-up, but not framed
    // as a missed/overdue promise.
    expect(detail.body.followUp.reason).not.toMatch(/overdue|missed/i);
  });

  it("a customer with genuinely zero promise_history rows still uses the legacy fallback correctly (no regression for that case)", async () => {
    // No promise event at all — customers.promiseAmount/promiseDate stay null,
    // so currentPromise must be null and promiseStatus null.
    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "No Promise At All Customer",
      amount: 500,
      amount_type: "outstanding",
    });
    const customerId = res.body.customer.id;

    const detail = await request(app).get(`/api/customers/${customerId}`);
    expect(detail.body.promises).toHaveLength(0);
    expect(detail.body.promiseStatus).toBeNull();
  });
});
