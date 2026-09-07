import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId, isoDateDaysFromNow } from "../test/helpers";

async function createAmountLessPromise(customerName: string) {
  const res = await request(app).post("/api/customers/notes").send({
    client_event_id: newEventId(),
    customer_name: customerName,
    amount: null,
    amount_type: "promised",
    promise_date: isoDateDaysFromNow(-1),
  });
  return res.body.customer.id as number;
}

async function getPromises(customerId: number) {
  const detail = await request(app).get(`/api/customers/${customerId}`);
  return detail.body.promises as Array<{ id: number; promiseAmount: string | null; fulfilled: boolean }>;
}

/**
 * REGRESSION TESTS (Phase 3 — see decisions.md, Amount-less Promise
 * Confirmation).
 *
 * An amount-less promise has no amount to allocate payments against, so it
 * can never be fulfilled automatically. The only state transition is this
 * explicit owner action.
 */
describe("PATCH /api/customers/:id/promises/:promiseId — amount-less confirmation", () => {
  it("confirms an amount-less promise as fulfilled", async () => {
    const customerId = await createAmountLessPromise("Confirm Test Customer");
    const [promise] = await getPromises(customerId);

    const res = await request(app)
      .patch(`/api/customers/${customerId}/promises/${promise.id}`)
      .send({ fulfilled: true });

    expect(res.status).toBe(200);
    expect(res.body.fulfilled).toBe(true);

    const [updated] = await getPromises(customerId);
    expect(updated.fulfilled).toBe(true);
  });

  it("unconfirms a previously confirmed amount-less promise", async () => {
    const customerId = await createAmountLessPromise("Unconfirm Test Customer");
    const [promise] = await getPromises(customerId);

    await request(app)
      .patch(`/api/customers/${customerId}/promises/${promise.id}`)
      .send({ fulfilled: true });

    const res = await request(app)
      .patch(`/api/customers/${customerId}/promises/${promise.id}`)
      .send({ fulfilled: false });

    expect(res.status).toBe(200);
    expect(res.body.fulfilled).toBe(false);
  });

  it("a payment never silently fulfills an amount-less promise, even after many payments", async () => {
    const customerName = "No Silent Fulfillment Customer";
    const customerId = await createAmountLessPromise(customerName);

    for (const amount of [500, 1000, 250]) {
      await request(app).post("/api/customers/notes").send({
        client_event_id: newEventId(),
        customer_name: customerName,
        amount,
        amount_type: "received",
      });
    }

    const [promise] = await getPromises(customerId);
    expect(promise.fulfilled).toBe(false);
  });

  it("rejects confirmation on a promise that has a stated amount", async () => {
    const res1 = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Amount Bearing Confirm Rejection",
      amount: 1000,
      amount_type: "promised",
      promise_date: isoDateDaysFromNow(3),
    });
    const customerId = res1.body.customer.id;
    const [promise] = await getPromises(customerId);

    const res = await request(app)
      .patch(`/api/customers/${customerId}/promises/${promise.id}`)
      .send({ fulfilled: true });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a promise that does not belong to the given customer", async () => {
    const customerAId = await createAmountLessPromise("Promise Owner A");
    const customerBId = await createAmountLessPromise("Promise Owner B");
    const [promiseA] = await getPromises(customerAId);

    const res = await request(app)
      .patch(`/api/customers/${customerBId}/promises/${promiseA.id}`)
      .send({ fulfilled: true });

    expect(res.status).toBe(404);
  });

  it("rejects a non-boolean fulfilled value", async () => {
    const customerId = await createAmountLessPromise("Non Boolean Test Customer");
    const [promise] = await getPromises(customerId);

    const res = await request(app)
      .patch(`/api/customers/${customerId}/promises/${promise.id}`)
      .send({ fulfilled: "yes" });

    expect(res.status).toBe(400);
  });

  it("two concurrent confirmations of the same promise both succeed and end in the confirmed state", async () => {
    const customerId = await createAmountLessPromise("Concurrent Confirm Customer");
    const [promise] = await getPromises(customerId);

    const [first, second] = await Promise.all([
      request(app).patch(`/api/customers/${customerId}/promises/${promise.id}`).send({ fulfilled: true }),
      request(app).patch(`/api/customers/${customerId}/promises/${promise.id}`).send({ fulfilled: true }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const [updated] = await getPromises(customerId);
    expect(updated.fulfilled).toBe(true);
  });
});
