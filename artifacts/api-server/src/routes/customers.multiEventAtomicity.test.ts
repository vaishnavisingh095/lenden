import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId } from "../test/helpers";

describe("POST /api/customers/notes — single-event route (scope boundary, unchanged)", () => {
  it("still leaves an earlier event committed when a later event from the same transcript fails, when submitted one call at a time (the single-event route was never meant to provide cross-call atomicity — use /customers/notes/batch for that)", async () => {
    const customerName = "Sharma Partial Failure";

    const event1 = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(event1.status).toBe(201);

    const event2 = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: null,
      amount_type: "outstanding",
    });
    expect(event2.status).toBe(500); // "Amount is required when recording an outstanding amount."

    const customerId = event1.body.customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    // Event 1 is still committed even though event 2 (same transcript) failed —
    // expected, since each call to this route is its own transaction.
    expect(detail.body.transactions).toHaveLength(1);
    expect(detail.body.balance).toBeCloseTo(-3000, 2);
  });

  it("does not duplicate the already-succeeded event when the transcript is retried with the same client_event_id per event, and safely accepts a corrected retry of the event whose earlier attempt failed and rolled back", async () => {
    const customerName = "Sharma Retry After Partial Failure";
    const event1Id = newEventId();
    const event2Id = newEventId();

    // First attempt: event 1 succeeds, event 2 fails (missing amount) and
    // rolls back — nothing is ever persisted under event2Id.
    const firstEvent1 = await request(app).post("/api/customers/notes").send({
      client_event_id: event1Id,
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(firstEvent1.status).toBe(201);

    const failedEvent2 = await request(app).post("/api/customers/notes").send({
      client_event_id: event2Id,
      customer_name: customerName,
      amount: null,
      amount_type: "outstanding",
    });
    expect(failedEvent2.status).toBe(500);

    // Retry: event 1 reuses its original id (idempotent replay, no new row);
    // event 2 reuses its original id too, now corrected — safe, because the
    // failed attempt never committed anything under that id.
    const retryEvent1 = await request(app).post("/api/customers/notes").send({
      client_event_id: event1Id,
      customer_name: customerName,
      amount: 3000,
      amount_type: "received",
    });
    expect(retryEvent1.status).toBe(200); // replayed, not a new row

    const retryEvent2 = await request(app).post("/api/customers/notes").send({
      client_event_id: event2Id,
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

    expect(paymentRows).toHaveLength(1); // no longer duplicated
    expect(purchaseRows).toHaveLength(1);
    expect(detail.body.balance).toBeCloseTo(-3000 + 2000, 2);
  });
});

describe("POST /api/customers/notes/batch — atomicity", () => {
  it("commits no event from the batch when one event is invalid", async () => {
    const customerName = "Batch Atomicity Failure";

    const res = await request(app)
      .post("/api/customers/notes/batch")
      .send({
        events: [
          {
            client_event_id: newEventId(),
            customer_name: customerName,
            amount: 3000,
            amount_type: "received",
          },
          {
            client_event_id: newEventId(),
            customer_name: customerName,
            amount: null,
            amount_type: "outstanding",
          },
        ],
      });

    expect(res.status).toBe(500);
    expect(res.body.failedEvent.index).toBe(1);

    const customers = await request(app).get("/api/customers");
    const created = customers.body.find(
      (c: { customerName: string }) => c.customerName === customerName,
    );

    // Neither event committed — not even the customer row, and certainly
    // not the valid "received" event that preceded the invalid one.
    expect(created).toBeUndefined();
  });

  it("commits all events together when the whole batch is valid", async () => {
    const customerName = "Batch Atomicity Success";

    const res = await request(app)
      .post("/api/customers/notes/batch")
      .send({
        events: [
          {
            client_event_id: newEventId(),
            customer_name: customerName,
            amount: 3000,
            amount_type: "received",
          },
          {
            client_event_id: newEventId(),
            customer_name: customerName,
            amount: 2000,
            amount_type: "outstanding",
          },
          {
            client_event_id: newEventId(),
            customer_name: customerName,
            amount: 1000,
            amount_type: "promised",
            promise_date: "2027-01-01",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.events).toHaveLength(3);

    const customerId = res.body.events[0].customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    expect(detail.body.transactions).toHaveLength(2);
    expect(detail.body.balance).toBeCloseTo(-3000 + 2000, 2);
  });

  it("safely retries a batch whose earlier attempt failed and rolled back, reusing the same client_event_ids with the invalid event corrected", async () => {
    const customerName = "Batch Retry Safety";
    const event1Id = newEventId();
    const event2Id = newEventId();

    const failedBatch = await request(app)
      .post("/api/customers/notes/batch")
      .send({
        events: [
          {
            client_event_id: event1Id,
            customer_name: customerName,
            amount: 3000,
            amount_type: "received",
          },
          {
            client_event_id: event2Id,
            customer_name: customerName,
            amount: null,
            amount_type: "outstanding",
          },
        ],
      });
    expect(failedBatch.status).toBe(500);

    const retriedBatch = await request(app)
      .post("/api/customers/notes/batch")
      .send({
        events: [
          {
            client_event_id: event1Id,
            customer_name: customerName,
            amount: 3000,
            amount_type: "received",
          },
          {
            client_event_id: event2Id,
            customer_name: customerName,
            amount: 2000,
            amount_type: "outstanding",
          },
        ],
      });
    expect(retriedBatch.status).toBe(201);

    const customerId = retriedBatch.body.events[0].customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    // Exactly one of each — the failed attempt truly committed nothing, so
    // the retry is a clean, non-duplicating first success.
    expect(detail.body.transactions).toHaveLength(2);
    expect(detail.body.balance).toBeCloseTo(-3000 + 2000, 2);
  });

  it("does not duplicate a batch that is fully retried after it already fully succeeded", async () => {
    const customerName = "Batch Full Retry After Success";
    const events = [
      {
        client_event_id: newEventId(),
        customer_name: customerName,
        amount: 3000,
        amount_type: "received",
      },
      {
        client_event_id: newEventId(),
        customer_name: customerName,
        amount: 2000,
        amount_type: "outstanding",
      },
    ];

    const first = await request(app)
      .post("/api/customers/notes/batch")
      .send({ events });
    expect(first.status).toBe(201);

    const retried = await request(app)
      .post("/api/customers/notes/batch")
      .send({ events });
    // 200, not 201: every event in this batch was a pure replay, nothing
    // new was committed. See decisions.md, Batch Replay Status.
    expect(retried.status).toBe(200);
    expect(retried.body.events.every((e: { replayed: boolean }) => e.replayed)).toBe(true);

    const customerId = first.body.events[0].customer.id;
    const detail = await request(app).get(`/api/customers/${customerId}`);

    expect(detail.body.transactions).toHaveLength(2);
    expect(detail.body.balance).toBeCloseTo(-3000 + 2000, 2);
  });

  it("rejects a request with an empty or missing events array", async () => {
    const empty = await request(app).post("/api/customers/notes/batch").send({ events: [] });
    expect(empty.status).toBe(400);

    const missing = await request(app).post("/api/customers/notes/batch").send({});
    expect(missing.status).toBe(400);
  });
});
