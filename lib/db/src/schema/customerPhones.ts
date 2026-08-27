import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const customerPhonesTable = pgTable("customer_phones", {
  id: serial("id").primaryKey(),

  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),

  phone: text("phone").notNull(),

  label: text("label"),

  isPrimary: boolean("is_primary").notNull().default(false),

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