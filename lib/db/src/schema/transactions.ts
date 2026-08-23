import {
  pgEnum,
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { customersTable } from "./customers";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "purchase",
  "payment",
  "adjustment",
]);

export const transactionSourceEnum = pgEnum("transaction_source", [
  "voice",
  "type",
]);

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),

  customerId: integer("customer_id")
    .references(() => customersTable.id)
    .notNull(),

  amount: numeric("amount", {
    precision: 14,
    scale: 2,
  }).notNull(),

  type: transactionTypeEnum("type").notNull(),

  date: timestamp("date", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  source: transactionSourceEnum("source").notNull(),

  notes: text("notes"),
});

export const insertTransactionSchema = createInsertSchema(
  transactionsTable,
).omit({
  id: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

export type Transaction = typeof transactionsTable.$inferSelect;