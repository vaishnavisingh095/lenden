import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId, isoDateDaysFromNow } from "../test/helpers";

async function getPromises(customerId: number) {
  const detail = await request(app).get(`/api/customers/${customerId}`);
  return detail.body.promises as Array<{
    id: number;
    promiseDate: string;
    promiseAmount: string | null;
    fulfilled: boolean;
    amountAllocated: number | null;
  }>;
}

/**
 * REGRESSION TESTS (Phase 3 — see decisions.md, Promise Allocation).
 *
 * Promise fulfillment is derived at read time from a customer's complete
 * promise/payment history (deriveFifoPromiseAllocations), not trusted from
 * the stored `fulfilled` column for amount-bearing promises. These tests
 * go through the actual API (GET /customers/:id), not the raw DB column,
 * since the column is no longer authoritative for these cases.
 */
describe("Promise fulfillment matching (FIFO, read-time derived)", () => {
  it("a partial payment leaves the promise open with partial progress recorded", async () => {
    const customerName = "Iqbal Partial Payment";

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(3),
    });
    expect(promised.status).toBe(201);
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 2000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const [promise] = await getPromises(customerId);
    expect(promise.fulfilled).toBe(false);
    expect(promise.amountAllocated).toBeCloseTo(2000, 2);
  });

  it("a second payment completing the remainder fulfills a previously partially-paid promise", async () => {
    const customerName = "Iqbal Two Installments";

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(3),
    });
    const customerId = promised.body.customer.id;

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 2000,
      amount_type: "received",
    });
    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });

    const [promise] = await getPromises(customerId);
    expect(promise.fulfilled).toBe(true);
    expect(promise.amountAllocated).toBeCloseTo(3000, 2);
  });

  it("overpayment fulfills the promise; the excess is left unaccounted for when there is no next open promise", async () => {
    const customerName = "Iqbal Overpayment";

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(3),
    });
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3500,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const [promise] = await getPromises(customerId);
    expect(promise.fulfilled).toBe(true);
    expect(promise.amountAllocated).toBeCloseTo(3000, 2);
  });

  it("overpayment rolls its excess into the next-oldest open promise", async () => {
    const customerName = "Iqbal Overpayment Rollover";

    const olderPromise = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-5),
    });
    const customerId = olderPromise.body.customer.id;

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 500,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-2),
    });

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1200,
      amount_type: "received",
    });

    const promises = await getPromises(customerId);
    const older = promises.find((p) => Number(p.promiseAmount) === 1000)!;
    const newer = promises.find((p) => Number(p.promiseAmount) === 500)!;

    expect(older.fulfilled).toBe(true);
    expect(older.amountAllocated).toBeCloseTo(1000, 2);
    expect(newer.fulfilled).toBe(false);
    expect(newer.amountAllocated).toBeCloseTo(200, 2);
  });

  it("an early payment (before the promise date) is eligible and fulfills the promise", async () => {
    const customerName = "Iqbal Early Payment";

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(5), // due in the future
    });
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const [promise] = await getPromises(customerId);
    expect(promise.fulfilled).toBe(true);
  });

  it("never automatically fulfills a promise saved without an amount, regardless of later payments", async () => {
    const customerName = "Vague Promise Customer";

    const promised = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: null,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-1),
    });
    const customerId = promised.body.customer.id;

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });

    const [promise] = await getPromises(customerId);
    expect(promise.promiseAmount).toBeNull();
    // Only explicit owner confirmation can change this — see
    // customers.promiseConfirmation.test.ts.
    expect(promise.fulfilled).toBe(false);
  });

  it("with two same-amount promises, the oldest promiseDate is fulfilled first, not the most recently created", async () => {
    const customerName = "Two Promises Same Amount";

    const olderPromise = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-5),
    });
    const customerId = olderPromise.body.customer.id;

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-2),
    });

    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });

    const promises = await getPromises(customerId);
    const sorted = [...promises].sort(
      (a, b) => new Date(a.promiseDate).getTime() - new Date(b.promiseDate).getTime(),
    );
    const [older, newer] = sorted;

    expect(older.fulfilled).toBe(true); // the actually-oldest promise is matched first
    expect(newer.fulfilled).toBe(false);
  });

  it("a promise entered out of order (an older due date, logged after a newer one already exists) still allocates correctly by promiseDate", async () => {
    const customerName = "Out Of Order Historical Entry";

    // Log the *newer* promise first.
    const newerPromise = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 500,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-2),
    });
    const customerId = newerPromise.body.customer.id;

    // Pay against it before the older promise is ever entered.
    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 500,
      amount_type: "received",
    });

    // Now log the *older* promise (a backdated entry, logged late).
    await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 500,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-5),
    });

    // Re-reading now (full replay) attributes the earlier payment to the
    // actually-oldest promise, even though it was entered into the system
    // after the payment happened — see decisions.md, Promise Allocation, #13.
    const promises = await getPromises(customerId);
    const older = promises.find((p) => new Date(p.promiseDate) < new Date(isoDateDaysFromNow(-3)))!;
    const newer = promises.find((p) => new Date(p.promiseDate) >= new Date(isoDateDaysFromNow(-3)))!;

    expect(older.fulfilled).toBe(true);
    expect(newer.fulfilled).toBe(false);
  });
});
