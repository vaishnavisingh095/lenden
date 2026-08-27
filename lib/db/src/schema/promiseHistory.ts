import {
  pgTable,
  serial,
  integer,
  numeric,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { customersTable } from "./customers";

export const promiseHistoryTable = pgTable("promise_history", {
  id: serial("id").primaryKey(),

  customerId: integer("customer_id")
    .references(() => customersTable.id)
    .notNull(),

  promiseDate: timestamp("promise_date", {
    withTimezone: true,
  }).notNull(),

  promiseAmount: numeric("promise_amount", {
    precision: 14,
    scale: 2,
  }),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  fulfilled: boolean("fulfilled")
    .default(false)
    .notNull(),
});

export const insertPromiseHistorySchema = createInsertSchema(
  promiseHistoryTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertPromiseHistory = z.infer<
  typeof insertPromiseHistorySchema
>;

export type PromiseHistory =
  typeof promiseHistoryTable.$inferSelect;