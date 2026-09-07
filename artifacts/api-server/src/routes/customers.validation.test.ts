import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TESTS (Phase 1 — see decisions.md #5, #6).
 *
 * These previously documented confirmed-broken behavior (a null amount_type
 * silently defaulting to "outstanding"; amount: 0 being accepted). Both are
 * now fixed at the validation layer in saveCustomerNoteSchema. These tests
 * assert the corrected behavior and must not regress.
 */
describe("POST /api/customers/notes — validation edge cases", () => {
  it("rejects a null amount_type instead of silently treating it as outstanding", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Null Amount Type Test",
      amount: 500,
      amount_type: null,
    });

    expect(res.status).toBe(400);
  });

  it("rejects a missing amount_type", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Missing Amount Type Test",
      amount: 500,
    });

    expect(res.status).toBe(400);
  });

  it("rejects amount: 0 for a received payment", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Zero Amount Received Test",
      amount: 0,
      amount_type: "received",
    });

    expect(res.status).toBe(400);
  });

  it("rejects amount: 0 for an outstanding transaction", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      customer_name: "Zero Amount Outstanding Test",
      amount: 0,
      amount_type: "outstanding",
    });

    expect(res.status).toBe(400);
  });

  it("still allows amount: null for a promised event (not a zero — an intentionally unstated amount)", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Amount-less Promise Test",
      amount: null,
      amount_type: "promised",
      promise_date: "2026-12-25",
    });

    expect(res.status).toBe(201);
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
