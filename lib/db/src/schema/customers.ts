import {
  pgEnum,
  pgTable,
  serial,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentStatusEnum = pgEnum("payment_status", [
  "received",
  "promised",
  "outstanding",
]);


export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),

  customerName: text("customer_name").notNull(),

  amount: numeric("amount", {
    precision: 14,
    scale: 2,
  }),

  paymentStatus: paymentStatusEnum("payment_status").notNull(),

  promiseAmount: numeric("promise_amount", {
    precision: 14,
    scale: 2,
  }),

  promiseDate: timestamp("promise_date", {
    withTimezone: true,
  }),

  notes: text("notes"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const insertCustomerSchema = createInsertSchema(
  customersTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

export type Customer = typeof customersTable.$inferSelect;
