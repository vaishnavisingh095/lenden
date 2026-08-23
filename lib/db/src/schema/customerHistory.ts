import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { customersTable, paymentStatusEnum } from "./customers";

export const customerHistoryTable = pgTable("customer_history", {
  id: serial("id").primaryKey(),

  customerId: integer("customer_id")
    .references(() => customersTable.id)
    .notNull(),

  amount: numeric("amount", {
    precision: 14,
    scale: 2,
  }),

  paymentStatus: paymentStatusEnum("payment_status").notNull(),

  promiseDate: timestamp("promise_date", {
    withTimezone: true,
  }),

  notes: text("notes"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const insertCustomerHistorySchema = createInsertSchema(
  customerHistoryTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertCustomerHistory = z.infer<
  typeof insertCustomerHistorySchema
>;

export type CustomerHistory =
  typeof customerHistoryTable.$inferSelect;