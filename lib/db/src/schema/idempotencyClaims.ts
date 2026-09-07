import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { customersTable } from "./customers";
import { transactionsTable } from "./transactions";
import { promiseHistoryTable } from "./promiseHistory";

/**
 * The single, global contention point for client_event_id. Every financial
 * event — regardless of type (received/outstanding/promised) or which
 * table it will eventually write a row into — claims its id here first,
 * before any other work happens. This is what makes idempotency a single
 * database-enforced boundary instead of two independent per-table ones.
 *
 * This table is NOT the financial source of truth. It only protects
 * logical-operation identity and replay; the actual financial facts remain
 * in transactions and promise_history, referenced here by pointer.
 */
export const idempotencyClaimsTable = pgTable("idempotency_claims", {
  id: serial("id").primaryKey(),

  clientEventId: text("client_event_id").notNull().unique(),

  // Populated after the financial write completes, in the same
  // transaction as the claim insert. Null only for the brief window
  // between claiming the id and finishing the write.
  customerId: integer("customer_id").references(() => customersTable.id),
  transactionId: integer("transaction_id").references(
    () => transactionsTable.id,
  ),
  promiseId: integer("promise_id").references(() => promiseHistoryTable.id),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertIdempotencyClaimSchema = createInsertSchema(
  idempotencyClaimsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertIdempotencyClaim = z.infer<
  typeof insertIdempotencyClaimSchema
>;

export type IdempotencyClaim = typeof idempotencyClaimsTable.$inferSelect;
