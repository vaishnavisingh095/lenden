import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { newEventId } from "../test/helpers";

/**
 * REGRESSION TEST — malformed request body / global error boundary.
 *
 * Before this fix, a request body that failed express.json()'s parse
 * reached Express's default error handler, which returned an HTML page
 * containing a full stack trace and the server's filesystem path — a
 * distinct leak from the route-level DB error disclosure fixed earlier
 * (that fix lives inside route handler catch blocks; this failure never
 * reaches a route handler at all). See failure-recovery.md and
 * architecture.md §12 item 19.
 */

const FORBIDDEN_SUBSTRINGS = [
  "at ",
  "node_modules",
  ".ts:",
  ".js:",
  "syntaxerror",
  "insert into",
  "params:",
  "select ",
];

describe("Global error boundary — malformed request body", () => {
  it("returns a safe JSON 400 for malformed JSON, not Express's default HTML error page", async () => {
    const res = await request(app)
      .post("/api/customers/notes")
      .set("Content-Type", "application/json")
      .send("{ this is not valid json");

    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
    expect(res.body).toHaveProperty("error");

    const bodyText = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(bodyText).not.toContain(forbidden);
    }

    // The raw text response must not be an HTML error page either.
    expect(res.text.toLowerCase()).not.toContain("<!doctype html");
    expect(res.text.toLowerCase()).not.toContain("<pre>");
  });

  it("does not leak the server filesystem path", async () => {
    const res = await request(app)
      .post("/api/customers/notes/batch")
      .set("Content-Type", "application/json")
      .send('{"events": [invalid');

    expect(res.status).toBe(400);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/\/Users\//);
    expect(bodyText).not.toMatch(/\/home\//);
  });

  it("malformed JSON to a GET-only-shaped path still returns JSON, not HTML, for the body-parse failure", async () => {
    const res = await request(app)
      .post("/api/contact-events")
      .set("Content-Type", "application/json")
      .send("not json at all {{{");

    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
  });

  it("does not double-send a response for a body-parse failure (no crash, exactly one JSON response)", async () => {
    // A supertest request that gets a clean, single, well-formed response
    // (rather than a hung connection or an error from Node's own
    // "ERR_HTTP_HEADERS_SENT") is itself the evidence here.
    const res = await request(app)
      .post("/api/customers/notes")
      .set("Content-Type", "application/json")
      .send("{{{{");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Malformed request body.");
  });
});

describe("Global error boundary does not interfere with existing intentional application errors", () => {
  it("validation failure still returns its normal 400 with field-level details", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "",
      amount: 500,
      amount_type: "received",
    });

    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it("idempotency conflict still returns 409 with its specific message", async () => {
    const id = newEventId();

    const first = await request(app).post("/api/customers/notes").send({
      client_event_id: id,
      customer_name: "Global Error Boundary Conflict Test",
      amount: 500,
      amount_type: "received",
    });
    expect(first.status).toBe(201);

    const conflicting = await request(app).post("/api/customers/notes").send({
      client_event_id: id,
      customer_name: "Global Error Boundary Conflict Test",
      amount: 999,
      amount_type: "received",
    });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error).toContain(id);
  });

  it("ambiguous customer identity still returns 409", async () => {
    const sharedName = "Global Error Boundary Ambiguous Test";
    const { db, customersTable } = await import("@workspace/db");
    await db.insert(customersTable).values([
      { customerName: sharedName, phone: "6660001111", paymentStatus: "outstanding" },
      { customerName: sharedName, phone: "6660002222", paymentStatus: "outstanding" },
    ]);

    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: sharedName,
      amount: 500,
      amount_type: "outstanding",
    });

    expect(res.status).toBe(409);
  });

  it("a genuine unclassified DB error (numeric overflow) still returns a sanitized 500, not leaked SQL", async () => {
    const res = await request(app).post("/api/customers/notes").send({
      client_event_id: newEventId(),
      customer_name: "Global Error Boundary DB Error Test",
      amount: 999999999999999,
      amount_type: "outstanding",
    });

    expect(res.status).toBe(500);
    const bodyText = JSON.stringify(res.body).toLowerCase();
    expect(bodyText).not.toContain("insert into");
    expect(bodyText).not.toContain("params:");
  });
});
