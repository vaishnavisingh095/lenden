import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TESTS — P2-3, phone normalization.
 *
 * Phone-first identity resolution only works if formatting differences
 * (spaces, dashes, a +91 country code) don't make the same real phone
 * number look like two different ones. See decisions.md, Phone
 * Normalization.
 */
describe("Phone normalization", () => {
  it("a +91-prefixed phone resolves to the same customer as its bare 10-digit form", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Format A",
      phone: "9990001111",
      amount: 500,
      amount_type: "outstanding",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Format B", // different name, same real phone
      phone: "+91 9990001111",
      amount: 200,
      amount_type: "outstanding",
    });
    expect(second.status).toBe(201);

    expect(second.body.customer.id).toBe(first.body.customer.id);
  });

  it("a phone with spaces/dashes resolves to the same customer as its plain-digits form", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Format C",
      phone: "9990002222",
      amount: 500,
      amount_type: "outstanding",
    });

    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Format D",
      phone: "999-000-2222",
      amount: 200,
      amount_type: "outstanding",
    });

    expect(second.body.customer.id).toBe(first.body.customer.id);
  });

  it("a leading-zero trunk-prefixed phone resolves to the same customer", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Format E",
      phone: "9990003333",
      amount: 500,
      amount_type: "outstanding",
    });

    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Format F",
      phone: "09990003333",
      amount: 200,
      amount_type: "outstanding",
    });

    expect(second.body.customer.id).toBe(first.body.customer.id);
  });

  it("still detects a changed-phone conflict when the normalized forms genuinely differ", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Conflict Still Works",
      phone: "9990004444",
      amount: 500,
      amount_type: "outstanding",
    });
    const customerId = first.body.customer.id;

    const conflicting = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Phone Conflict Still Works",
      phone: "9990005555", // genuinely different number
      amount: 200,
      amount_type: "outstanding",
    });
    expect(conflicting.status).toBe(409);

    const detail = await request(app).get(`/api/customers/${customerId}`);
    expect(detail.body.customer.phone).toBe("9990004444"); // untouched
  });
});
