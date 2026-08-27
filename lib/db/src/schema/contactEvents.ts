import {
  pgEnum,
  pgTable,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { customersTable } from "./customers";

export const contactMethodEnum = pgEnum("contact_method", [
  "call",
  "whatsapp",
]);

export const contactEventsTable = pgTable("contact_events", {
  id: serial("id").primaryKey(),

  customerId: integer("customer_id")
    .references(() => customersTable.id)
    .notNull(),

  method: contactMethodEnum("method").notNull(),

  timestamp: timestamp("timestamp", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const insertContactEventSchema = createInsertSchema(
  contactEventsTable,
).omit({
  id: true,
  timestamp: true,
});

export type InsertContactEvent = z.infer<
  typeof insertContactEventSchema
>;

export type ContactEvent =
  typeof contactEventsTable.$inferSelect;