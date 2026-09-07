import { describe, expect, it } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TESTS (Phase 4 — see decisions.md, Customer Identity).
 *
 * Invariant: the same identifiable real-world customer must not silently
 * fork into multiple ledgers; genuinely distinct customers must not be
 * silently merged; ambiguous identity must be surfaced, not guessed.
 */
describe("Customer identity resolution", () => {
  it("resolves to the same customer when the same phone is used under a different name (phone-first)", async () => {
    const phone = "9990001111";

    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Sharma ji",
      phone,
      amount: 500,
      amount_type: "outstanding",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Sharma Hardware",
      phone,
      amount: 300,
      amount_type: "outstanding",
    });
    expect(second.status).toBe(201);

    expect(second.body.customer.id).toBe(first.body.customer.id);
  });

  it("resolves by name when no phone is supplied and the name matches exactly one existing customer", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Name Only Customer",
      amount: 500,
      amount_type: "outstanding",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Name Only Customer",
      amount: 200,
      amount_type: "outstanding",
    });
    expect(second.status).toBe(201);

    expect(second.body.customer.id).toBe(first.body.customer.id);
  });

  it("rejects a supplied phone that differs from the phone already on file for a name-matched customer, without overwriting it", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Changed Phone Customer",
      phone: "1111111111",
      amount: 500,
      amount_type: "outstanding",
    });
    expect(first.status).toBe(201);
    const customerId = first.body.customer.id;

    const conflicting = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Changed Phone Customer",
      phone: "2222222222", // different from the phone already on file
      amount: 300,
      amount_type: "outstanding",
    });
    expect(conflicting.status).toBe(409);

    const detail = await request(app).get(`/api/customers/${customerId}`);
    expect(detail.body.customer.phone).toBe("1111111111"); // untouched
    expect(detail.body.transactions).toHaveLength(1); // the conflicting event did not commit
  });

  it("fills in a phone for a name-matched customer that has none on file yet (not a conflict)", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "No Phone Yet Customer",
      amount: 500,
      amount_type: "outstanding",
    });
    expect(first.status).toBe(201);
    const customerId = first.body.customer.id;

    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "No Phone Yet Customer",
      phone: "3333333333",
      amount: 200,
      amount_type: "outstanding",
    });
    expect(second.status).toBe(201);
    expect(second.body.customer.id).toBe(customerId);
    expect(second.body.customer.phone).toBe("3333333333");
  });

  it("returns an explicit ambiguity (not a silent pick) when a name already matches more than one existing customer", async () => {
    // Seed two genuinely distinct pre-existing customers sharing a name —
    // this can happen from legacy data or a manually-resolved ambiguity;
    // the write path itself does not create this state (see the "changed
    // phone" test above), so it's seeded directly here.
    const sharedName = "Legacy Duplicate Name";
    await db.insert(customersTable).values([
      { customerName: sharedName, phone: "4444444444", paymentStatus: "outstanding" },
      { customerName: sharedName, phone: "5555555555", paymentStatus: "outstanding" },
    ]);

    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: sharedName,
      amount: 100,
      amount_type: "outstanding",
    });

    expect(res.status).toBe(409);
  });

  it("returns an explicit ambiguity (not a silent pick) when a phone already matches more than one existing customer", async () => {
    const sharedPhone = "6666666666";
    await db.insert(customersTable).values([
      { customerName: "Ambiguous Phone A", phone: sharedPhone, paymentStatus: "outstanding" },
      { customerName: "Ambiguous Phone B", phone: sharedPhone, paymentStatus: "outstanding" },
    ]);

    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Ambiguous Phone A", // matches one of the two by name too
      phone: sharedPhone,
      amount: 100,
      amount_type: "outstanding",
    });

    expect(res.status).toBe(409);
  });

  it("does not merge two customers with genuinely different names and different phones", async () => {
    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Distinct Customer One",
      phone: "7777777777",
      amount: 100,
      amount_type: "outstanding",
    });
    const second = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Distinct Customer Two",
      phone: "8888888888",
      amount: 200,
      amount_type: "outstanding",
    });

    expect(second.body.customer.id).not.toBe(first.body.customer.id);
  });

  it("does not fork a brand-new customer name into multiple ledgers under concurrent submissions", async () => {
    const customerName = `Concurrent New Customer Name ${newEventId()}`;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post("/api/customers/notes").send({
          client_event_id: newEventId(),
          customer_name: customerName,
          amount: 100,
          amount_type: "outstanding",
        }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const customerIds = new Set(responses.map((res) => res.body.customer.id));
    expect(customerIds.size).toBe(1);
  });

  it("does not fork a brand-new phone into multiple ledgers under concurrent submissions", async () => {
    const phone = `9${Date.now()}`.slice(0, 10);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        request(app).post("/api/customers/notes").send({
          client_event_id: newEventId(),
          customer_name: `Concurrent Phone Customer ${index}`, // different names, same new phone
          phone,
          amount: 100,
          amount_type: "outstanding",
        }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const customerIds = new Set(responses.map((res) => res.body.customer.id));
    expect(customerIds.size).toBe(1);
  });

  it("does not fork a brand-new name+phone combination when one concurrent request supplies the phone and the other does not", async () => {
    const uniqueId = newEventId();
    const customerName = `Cross Key Race Customer ${uniqueId}`;
    const phone = `8${Date.now()}`.slice(0, 10);

    const [withPhone, withoutPhone] = await Promise.all([
      request(app).post("/api/customers/notes").send({
        client_event_id: newEventId(),
        customer_name: customerName,
        phone,
        amount: 100,
        amount_type: "outstanding",
      }),
      request(app).post("/api/customers/notes").send({
        client_event_id: newEventId(),
        customer_name: customerName,
        amount: 200,
        amount_type: "outstanding",
      }),
    ]);

    expect(withPhone.status).toBe(201);
    expect(withoutPhone.status).toBe(201);
    expect(withoutPhone.body.customer.id).toBe(withPhone.body.customer.id);
  });

  it("fails fast with a clear error instead of hanging indefinitely when the resolution lock cannot be acquired", async () => {
    const customerName = `Lock Timeout Customer ${newEventId()}`;
    const normalizedName = customerName.trim().toLowerCase();

    // Hold the same advisory lock key this customer name would use, for
    // longer than the route's bounded lock_timeout (2s).
    let releaseHold: () => void = () => {};
    const holdReady = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-name:${normalizedName}`}))`,
      );
      releaseHold();
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });

    await holdReady;

    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: customerName,
      amount: 100,
      amount_type: "outstanding",
    });

    expect(res.status).toBe(503);

    await holder;
  }, 10000);
});
