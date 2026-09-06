import { describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, promiseHistoryTable } from "@workspace/db";
import app from "../app";
import { isoDateDaysFromNow } from "../test/helpers";

async function getPromiseHistory(customerId: number) {
  return db
    .select()
    .from(promiseHistoryTable)
    .where(eq(promiseHistoryTable.customerId, customerId));
}

/**
 * CHARACTERIZATION TESTS (P1).
 *
 * These document current promise-fulfillment matching behavior — see audit
 * finding A4 (exact-amount, non-early matching) and A6 (amount-less
 * promises). No allocation/fulfillment rule has been implemented. These
 * tests intentionally do NOT assert what "should" happen for partial
 * payment, overpayment, or amount-less promises — that product rule has not
 * been defined yet.
 */
describe("Promise fulfillment matching (characterization)", () => {
  it("CURRENTLY leaves a promise unfulfilled when only part of the promised amount is paid", async () => {
    const customerName = "Iqbal Partial Payment";

    const promised = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(3),
    });
    expect(promised.status).toBe(201);
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 2000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const history = await getPromiseHistory(customerId);
    expect(history).toHaveLength(1);
    expect(history[0]?.fulfilled).toBe(false);
  });

  it("CURRENTLY leaves a promise unfulfilled when the customer overpays relative to the promised amount", async () => {
    const customerName = "Iqbal Overpayment";

    const promised = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(3),
    });
    expect(promised.status).toBe(201);
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3500,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const history = await getPromiseHistory(customerId);
    expect(history).toHaveLength(1);
    expect(history[0]?.fulfilled).toBe(false);
  });

  it("CURRENTLY leaves a promise unfulfilled when the exact amount is paid before the promised date", async () => {
    const customerName = "Iqbal Early Payment";

    const promised = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(5), // due in the future
    });
    expect(promised.status).toBe(201);
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const history = await getPromiseHistory(customerId);
    expect(history).toHaveLength(1);
    expect(history[0]?.fulfilled).toBe(false);
  });

  it("CURRENTLY never fulfills a promise saved without an amount, regardless of later payments", async () => {
    const customerName = "Vague Promise Customer";

    const promised = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: null,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-1),
    });
    expect(promised.status).toBe(201);
    const customerId = promised.body.customer.id;

    const payment = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const history = await getPromiseHistory(customerId);
    expect(history).toHaveLength(1);
    expect(history[0]?.promiseAmount).toBeNull();
    // Not asserting this "should" become fulfilled — that product rule for
    // amount-less promises has not been defined. This only records that,
    // today, it stays unfulfilled no matter what is paid afterward.
    expect(history[0]?.fulfilled).toBe(false);
  });

  it("CURRENTLY fulfills the most recently due matching promise, not the oldest one, when two unfulfilled promises share the same amount (contradicts the code's own 'oldest unfulfilled promise' comment — see audit finding A9)", async () => {
    const customerName = "Two Promises Same Amount";

    const olderPromise = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-5),
    });
    expect(olderPromise.status).toBe(201);
    const customerId = olderPromise.body.customer.id;

    const newerPromise = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 1000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(-2),
    });
    expect(newerPromise.status).toBe(201);

    const payment = await request(app).post("/api/customers/notes").send({
      customer_name: customerName,
      amount: 1000,
      amount_type: "received",
    });
    expect(payment.status).toBe(201);

    const history = await getPromiseHistory(customerId);
    expect(history).toHaveLength(2);

    const sorted = [...history].sort(
      (a, b) => a.promiseDate.getTime() - b.promiseDate.getTime(),
    );
    const [older, newer] = sorted;

    expect(older?.fulfilled).toBe(false); // the actually-oldest promise stays open
    expect(newer?.fulfilled).toBe(true); // the more recent one is the one matched
  });
});
