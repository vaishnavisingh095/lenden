import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

/**
 * CHARACTERIZATION TESTS (P1).
 *
 * Invariant under test (not yet enforced by any implementation): the same
 * identifiable real-world customer must not silently fork into multiple
 * ledgers. These tests document where that currently fails — see audit
 * findings A3 (phone is not used to resolve identity) and A10 (no unique
 * constraint on customer name, so concurrent creation can race). No fix
 * (e.g. a unique lower(customer_name) constraint, or phone-first lookup) is
 * implemented here.
 */
describe("Customer identity resolution (characterization)", () => {
  it("CURRENTLY creates a separate customer record when the same phone number is used under a different name (BUG — see audit finding A3: phone-first resolution is documented in the code but not implemented)", async () => {
    const phone = "9990001111";

    const first = await request(app).post("/api/customers/notes").send({
      customer_name: "Sharma ji",
      phone,
      amount: 500,
      amount_type: "outstanding",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/customers/notes").send({
      customer_name: "Sharma Hardware",
      phone,
      amount: 300,
      amount_type: "outstanding",
    });
    expect(second.status).toBe(201);

    // Same phone, but resolved to two different customer ledgers.
    expect(second.body.customer.id).not.toBe(first.body.customer.id);
    expect(first.body.customer.phone).toBe(phone);
    expect(second.body.customer.phone).toBe(phone);
  });

  it("CURRENTLY can fork a brand-new customer name into multiple separate ledgers under concurrent submissions (race — see audit finding A10: no unique constraint on customer_name, no locking on the lookup-then-insert). No fix is implemented; if this assertion ever fails, rerun before concluding the race window closed by chance", async () => {
    const customerName = `Concurrent New Customer ${Date.now()}`;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post("/api/customers/notes").send({
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

    expect(customerIds.size).toBeGreaterThan(1);
  });
});
