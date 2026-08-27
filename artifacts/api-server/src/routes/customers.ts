import { Router, type IRouter } from "express";
import {
  db,
  customersTable,
  transactionsTable,
  promiseHistoryTable,
  contactEventsTable,
  customerPhonesTable,
} from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const parsePromiseDate = (
  value: string | null | undefined,
): Date | null => {
  if (!value?.trim()) return null;

  const input = value.trim().toLowerCase();

  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

    // ISO date: 2026-08-30
  const isoDateMatch = input.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  );

  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]) - 1;
    const day = Number(isoDateMatch[3]);

    const result = new Date(year, month, day);
    result.setHours(0, 0, 0, 0);

    return result;
  }

  // Month + day: "August 24", "Aug 24"
  // Use the current year instead of letting JavaScript guess one.
  const monthDayMatch = input.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})$/,
  );

  if (monthDayMatch) {
    const months: Record<string, number> = {
      january: 0,
      jan: 0,
      february: 1,
      feb: 1,
      march: 2,
      mar: 2,
      april: 3,
      apr: 3,
      may: 4,
      june: 5,
      jun: 5,
      july: 6,
      jul: 6,
      august: 7,
      aug: 7,
      september: 8,
      sep: 8,
      sept: 8,
      october: 9,
      oct: 9,
      november: 10,
      nov: 10,
      december: 11,
      dec: 11,
    };

    const today = new Date();
    const month = months[monthDayMatch[1]];
    const day = Number(monthDayMatch[2]);

    const result = new Date(
      today.getFullYear(),
      month,
      day,
    );

    result.setHours(0, 0, 0, 0);

    return result;
  }

  // Day + month: "24 August", "24 Aug"
  const dayMonthMatch = input.match(
    /^(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/,
  );

  if (dayMonthMatch) {
    const months: Record<string, number> = {
      january: 0,
      jan: 0,
      february: 1,
      feb: 1,
      march: 2,
      mar: 2,
      april: 3,
      apr: 3,
      may: 4,
      june: 5,
      jun: 5,
      july: 6,
      jul: 6,
      august: 7,
      aug: 7,
      september: 8,
      sep: 8,
      sept: 8,
      october: 9,
      oct: 9,
      november: 10,
      nov: 10,
      december: 11,
      dec: 11,
    };

    const today = new Date();
    const day = Number(dayMonthMatch[1]);
    const month = months[dayMonthMatch[2]];

    const result = new Date(
      today.getFullYear(),
      month,
      day,
    );

    result.setHours(0, 0, 0, 0);

    return result;
  }

  // Simple weekday: Monday, Friday, etc.
  if (weekdays[input] !== undefined) {
    const result = new Date();
    const targetDay = weekdays[input];

    const difference =
      (targetDay - result.getDay() + 7) % 7;

    result.setDate(
      result.getDate() + (difference || 7),
    );

    result.setHours(0, 0, 0, 0);

    return result;
  }

  // "next Friday"
  const nextWeekdayMatch = input.match(
    /^next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/,
  );

  if (nextWeekdayMatch) {
    const result = new Date();
    const targetDay = weekdays[nextWeekdayMatch[1]];

    const difference =
      (targetDay - result.getDay() + 7) % 7;

    result.setDate(
      result.getDate() + (difference || 7),
    );

    result.setHours(0, 0, 0, 0);

    return result;
  }

  // "next month Friday"
  const nextMonthWeekdayMatch = input.match(
    /^next\s+month\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/,
  );

  if (nextMonthWeekdayMatch) {
    const today = new Date();

    const targetDay =
      weekdays[nextMonthWeekdayMatch[1]];

    const result = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1,
    );

    const difference =
      (targetDay - result.getDay() + 7) % 7;

    result.setDate(
      result.getDate() + difference,
    );

    result.setHours(0, 0, 0, 0);

    return result;
  }

  // "Friday next month"
  const weekdayNextMonthMatch = input.match(
    /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+next\s+month$/,
  );

  if (weekdayNextMonthMatch) {
    const today = new Date();

    const targetDay =
      weekdays[weekdayNextMonthMatch[1]];

    const result = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1,
    );

    const difference =
      (targetDay - result.getDay() + 7) % 7;

    result.setDate(
      result.getDate() + difference,
    );

    result.setHours(0, 0, 0, 0);
      }

  // Hinglish: "10 din baad", "5 din baad"
  const daysAfterMatch = input.match(
    /^(\d+)\s+din\s+baad$/,
  );

  if (daysAfterMatch) {
    const days = Number(daysAfterMatch[1]);

    const result = new Date();
    result.setDate(result.getDate() + days);
    result.setHours(0, 0, 0, 0);

    

    return result;
  }

  return null;
};


const saveCustomerNoteSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required"),

  phone: z.string().trim().optional().nullable(),

  transcript: z.string().trim().optional().nullable(),

  amount: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((value, context) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      const amount = typeof value === "number" ? value : Number(value);

      if (!Number.isFinite(amount) || amount < 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Amount must be a non-negative number",
        });

        return z.NEVER;
      }

      return amount.toFixed(2);
    }),

  amount_type: z
    .enum(["received", "promised", "outstanding"])
    .optional()
    .nullable(),

  promise_date: z.string().trim().optional().nullable(),

  notes: z.string().trim().optional().default(""),
});


router.post("/customers/notes", async (req, res) => {
  const parsed = saveCustomerNoteSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid customer note",
      details: parsed.error.flatten().fieldErrors,
    });

    return;
  }

  try {
    const saved = await db.transaction(async (tx) => {
      const {
  customer_name,
  phone,
  amount,
  amount_type,
  promise_date,
  notes,
} = parsed.data;

      const promiseDate = parsePromiseDate(promise_date);

if (promise_date && !promiseDate) {
  throw new Error("Invalid promise date.");
}
      /*
       * Find the customer case-insensitively.
       *
       * Example:
       * "Ramesh" and "ramesh" → same customer.
       */
      const existingCustomers = await tx
        .select()
        .from(customersTable)
        .where(
          sql`lower(${customersTable.customerName}) = lower(${customer_name})`,
        )
        .limit(1);

      let customer = existingCustomers[0];
      if (customer && phone) {
  const [updatedCustomer] = await tx
    .update(customersTable)
    .set({
      phone,
      updatedAt: new Date(),
    })
    .where(sql`${customersTable.id} = ${customer.id}`)
    .returning();
    

  customer = updatedCustomer;
}

      /*
       * If this customer does not exist, create them.
       *
       * The old amount/paymentStatus fields are kept populated for
       * backward compatibility with the existing database.
       *
       * NEW balance calculations will NOT use those fields.
       */
      if (!customer) {
        const [createdCustomer] = await tx
          .insert(customersTable)
          .values({
  customerName: customer_name,
  phone,
  amount,
  paymentStatus: amount_type ?? "outstanding",
  promiseAmount:
    amount_type === "promised" ? amount : null,
  promiseDate:
    amount_type === "promised" ? promiseDate : null,
  notes,
})
          .returning();

        customer = createdCustomer;
      }

      /*
       * PROMISED:
       *
       * No transaction is created.
       * A promise is NOT money received.
       * Therefore it does NOT change the balance.
       */
      if (amount_type === "promised") {
        const [updatedCustomer] = await tx
          .update(customersTable)
          .set({
            promiseAmount: amount,
            promiseDate,
            notes,
            updatedAt: new Date(),
          })
          .where(sql`${customersTable.id} = ${customer.id}`)
          .returning();
          await tx.insert(promiseHistoryTable).values({
          customerId: customer.id,
          promiseDate: promiseDate!,
          promiseAmount: amount,
          fulfilled: false,
        });

        const [balanceRow] = await tx
          .select({
            balance: sql<string>`
              COALESCE(SUM(${transactionsTable.amount}), 0)
            `,
          })
          .from(transactionsTable)
          .where(
            sql`${transactionsTable.customerId} = ${customer.id}`,
          );

        return {
          customer: updatedCustomer,
          transaction: null,
          balance: Number(balanceRow?.balance ?? "0"),
        };
      }

      /*
       * RECEIVED:
       * Customer actually paid us.
       *
       * Store the transaction amount as negative.
       *
       * Example:
       * ₹2,500 received → -2500
       */
if (amount_type === "received") {
  if (amount === null) {
    throw new Error(
      "Amount is required when a payment is received.",
    );
  }

  const [transaction] = await tx
    .insert(transactionsTable)
    .values({
      customerId: customer.id,
      amount: `-${amount}`,
      type: "payment",
      source: "voice",
      notes,
    })
    .returning();

  // Match this payment to the oldest unfulfilled promise
  // that was due on or before the payment date.
  const [matchingPromise] = await tx
    .select()
    .from(promiseHistoryTable)
        .where(
      sql`
        ${promiseHistoryTable.customerId} = ${customer.id}
        AND ${promiseHistoryTable.fulfilled} = false
        AND ${promiseHistoryTable.promiseDate} <= ${transaction.date}
        AND ${promiseHistoryTable.promiseAmount} = ${amount}
      `,
    )
    .orderBy(sql`${promiseHistoryTable.promiseDate} DESC`)
    .limit(1);

  if (matchingPromise) {
    await tx
      .update(promiseHistoryTable)
      .set({
        fulfilled: true,
      })
      .where(
        sql`${promiseHistoryTable.id} = ${matchingPromise.id}`,
      );
  }

  const [balanceRow] = await tx
    .select({
      balance: sql<string>`
        COALESCE(SUM(${transactionsTable.amount}), 0)
      `,
    })
    .from(transactionsTable)
    .where(
      sql`${transactionsTable.customerId} = ${customer.id}`,
    );

  return {
    customer,
    transaction,
    balance: Number(balanceRow?.balance ?? "0"),
  };
}

      /*
       * OUTSTANDING:
       * Customer owes us money.
       *
       * Store the transaction amount as positive.
       *
       * Example:
       * ₹2,500 credit purchase → +2500
       */
      if (amount === null) {
        throw new Error(
          "Amount is required when recording an outstanding amount.",
        );
      }

      const [transaction] = await tx
        .insert(transactionsTable)
        .values({
          customerId: customer.id,
          amount,
          type: "purchase",
          source: "voice",
          notes,
        })
        .returning();

      const [balanceRow] = await tx
        .select({
          balance: sql<string>`
            COALESCE(SUM(${transactionsTable.amount}), 0)
          `,
        })
        .from(transactionsTable)
        .where(
          sql`${transactionsTable.customerId} = ${customer.id}`,
        );

      return {
        customer,
        transaction,
        balance: Number(balanceRow?.balance ?? "0"),
      };
    });

    res.status(201).json(saved);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not save customer note",
    );

    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Could not save customer note",
    });
  }
});

router.get("/customers", async (req, res) => {
  try {
    const customers = await db
      .select({
        id: customersTable.id,
        customerName: customersTable.customerName,
        phone: customersTable.phone,
        promiseAmount: customersTable.promiseAmount,
        promiseDate: customersTable.promiseDate,
        notes: customersTable.notes,
        balance: sql<string>`
          COALESCE(
            SUM(${transactionsTable.amount}),
            0
          )
        `,
        lastTransactionDate: sql<string | null>`
          MAX(${transactionsTable.date})
        `,
      })
      .from(customersTable)
      .leftJoin(
        transactionsTable,
        sql`${transactionsTable.customerId} = ${customersTable.id}`,
      )
      .groupBy(
        customersTable.id,
        customersTable.customerName,
        customersTable.promiseAmount,
        customersTable.promiseDate,
        customersTable.notes,
      )
      .orderBy(customersTable.customerName);
      const customerIds = customers.map((customer) => customer.id);

const phoneRows =
  customerIds.length > 0
    ? await db
        .select({
          customerId: customerPhonesTable.customerId,
          phone: customerPhonesTable.phone,
        })
        .from(customerPhonesTable)
        .where(
          inArray(
            customerPhonesTable.customerId,
            customerIds,
          ),
        )
    : [];

const phonesByCustomer = new Map<number, string[]>();

for (const row of phoneRows) {
  const existing = phonesByCustomer.get(row.customerId) ?? [];
  existing.push(row.phone);
  phonesByCustomer.set(row.customerId, existing);
}

        return res.json(
      customers.map((customer) => ({
        ...customer,
        balance: Number(customer.balance ?? "0"),
        phoneNumbers: phonesByCustomer.get(customer.id) ?? [],
      })),
    );
    } catch (error) {
    req.log.error(
      { err: error },
      "Could not load customers",
    );

    return res.status(500).json({
      error: "Could not load customers",
    });
  }
});
      


// GET ONE CUSTOMER
router.get("/customers/:id", async (req, res) => {
  try {
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId)) {
      return res.status(400).json({
        error: "Invalid customer ID.",
      });
    }

    const [customer] = await db
      .select({
        id: customersTable.id,
        customerName: customersTable.customerName,
        phone: customersTable.phone,
        promiseAmount: customersTable.promiseAmount,
        promiseDate: customersTable.promiseDate,
        notes: customersTable.notes,
      })
      .from(customersTable)
      .where(
        sql`${customersTable.id} = ${customerId}`,
      )
      .limit(1);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    const transactions = await db
      .select({
        id: transactionsTable.id,
        amount: transactionsTable.amount,
        type: transactionsTable.type,
        date: transactionsTable.date,
        notes: transactionsTable.notes,
      })
      .from(transactionsTable)
      .where(
        sql`${transactionsTable.customerId} = ${customerId}`,
      )
      .orderBy(
        sql`${transactionsTable.date} DESC`,
      );

    const [balanceRow] = await db
      .select({
        balance: sql<string>`
          COALESCE(
            SUM(${transactionsTable.amount}),
            0
          )
        `,
      })
      .from(transactionsTable)
      .where(
        sql`${transactionsTable.customerId} = ${customerId}`,
      );

       const promises = await db
      .select({
        id: promiseHistoryTable.id,
        promiseDate: promiseHistoryTable.promiseDate,
        promiseAmount: promiseHistoryTable.promiseAmount,
        fulfilled: promiseHistoryTable.fulfilled,
      })
      .from(promiseHistoryTable)
      .where(
        sql`${promiseHistoryTable.customerId} = ${customerId}`,
      )
      .orderBy(
        sql`${promiseHistoryTable.promiseDate} ASC`,
      );
          const contactHistory = await db
      .select({
        id: contactEventsTable.id,
        method: contactEventsTable.method,
        timestamp: contactEventsTable.timestamp,
      })
      .from(contactEventsTable)
      .where(
        sql`${contactEventsTable.customerId} = ${customerId}`,
      )
      .orderBy(
        sql`${contactEventsTable.timestamp} DESC`,
      );

    const paymentTransactions = transactions.filter(
      (transaction) => transaction.type === "payment",
    );

    const fulfilledPromises = promises.filter(
      (promise) => promise.fulfilled,
    );

    const brokenPromises = promises.filter(
      (promise) =>
        !promise.fulfilled &&
        promise.promiseDate <= new Date(),
    );
        const currentPromise =
      [...promises]
        .filter((promise) => !promise.fulfilled)
        .sort(
          (a, b) =>
            new Date(a.promiseDate).getTime() -
            new Date(b.promiseDate).getTime(),
        )[0] ??
      (customer.promiseAmount && customer.promiseDate
        ? {
            promiseDate: new Date(customer.promiseDate),
            promiseAmount: customer.promiseAmount,
            fulfilled: false,
          }
        : null);

    let promiseStatus:
      | "upcoming"
      | "due_today"
      | "overdue"
      | "paid"
      | null = null;

    if (currentPromise) {
      const today = new Date();
      const promiseDate = new Date(currentPromise.promiseDate);

      const isSameDay =
        promiseDate.getFullYear() === today.getFullYear() &&
        promiseDate.getMonth() === today.getMonth() &&
        promiseDate.getDate() === today.getDate();

      if (promiseDate < today && !isSameDay) {
        promiseStatus = "overdue";
      } else if (isSameDay) {
        promiseStatus = "due_today";
      } else {
        promiseStatus = "upcoming";
      }
    } else if (fulfilledPromises.length > 0) {
      promiseStatus = "paid";
    }
        const lastContact = contactHistory[0] ?? null;

    let followUpPriority:
      | "high"
      | "medium"
      | "low" = "low";

    let recommendedAction:
      | "call"
      | "whatsapp"
      | "none" = "none";

    let followUpReason = "No follow-up needed right now.";

    if (balanceRow && Number(balanceRow.balance) > 0) {
      if (promiseStatus === "overdue") {
        followUpPriority = "high";
        recommendedAction = customer.phone
          ? "whatsapp"
          : "none";
        followUpReason =
          "Payment is overdue and there is still an outstanding balance.";
      } else if (promiseStatus === "due_today") {
        followUpPriority = "high";
        recommendedAction = customer.phone
          ? "whatsapp"
          : "none";
        followUpReason =
          "The payment promise is due today and there is still an outstanding balance.";
      } else if (promiseStatus === "upcoming") {
        followUpPriority = "low";
        recommendedAction = "none";
        followUpReason =
          "The payment promise is still upcoming.";
      } else {
  followUpPriority = "medium";

  if (customer.phone) {
    recommendedAction = "whatsapp";
    followUpReason =
      "There is an outstanding balance that still needs follow-up.";
  } else {
    recommendedAction = "none";
    followUpReason =
      `₹${Number(balanceRow?.balance ?? "0").toLocaleString("en-IN")} is outstanding, but no phone number is available for direct follow-up.`;
  }
}
    }

    const followUp = {
      priority: followUpPriority,
      recommendedAction,
      reason: followUpReason,
      lastContact: lastContact
        ? {
            method: lastContact.method,
            timestamp: lastContact.timestamp,
          }
        : null,
    };
    
    let totalDaysLate = 0;
    let totalFollowUps = 0;
    let matchedFulfilledPromises = 0;

    for (const promise of fulfilledPromises) {
      const matchingPayment = paymentTransactions.find(
        (payment) =>
          new Date(payment.date) >=
            new Date(promise.promiseDate) &&
          promise.promiseAmount !== null &&
          Number(payment.amount) ===
            -Number(promise.promiseAmount),
      );

      if (!matchingPayment) {
        continue;
      }

      const promiseDate = new Date(promise.promiseDate);
      const paymentDate = new Date(matchingPayment.date);

      const daysLate = Math.max(
        0,
        Math.floor(
          (paymentDate.getTime() - promiseDate.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );

      totalDaysLate += daysLate;

      const followUps = await db
        .select({
          id: contactEventsTable.id,
        })
        .from(contactEventsTable)
        .where(
          sql`
            ${contactEventsTable.customerId} = ${customerId}
            AND ${contactEventsTable.timestamp} >= ${promiseDate}
            AND ${contactEventsTable.timestamp} <= ${paymentDate}
          `,
        );

      totalFollowUps += followUps.length;
      matchedFulfilledPromises += 1;
    }

        return res.json({
      customer,
      balance: Number(balanceRow?.balance ?? "0"),
      transactions,
      contactHistory,
      promiseStatus,
      followUp,
      paymentReliability: {
        averageDaysLate:
          matchedFulfilledPromises > 0
            ? Number(
                (
                  totalDaysLate /
                  matchedFulfilledPromises
                ).toFixed(1),
              )
            : 0,
        promisesKept: fulfilledPromises.length,
        promisesBroken: brokenPromises.length,
        totalPromises: promises.length,
        averageFollowUps:
          matchedFulfilledPromises > 0
            ? Number(
                (
                  totalFollowUps /
                  matchedFulfilledPromises
                ).toFixed(1),
              )
            : 0,
      },
    });
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not load customer history",
    );

    return res.status(500).json({
      error: "Could not load customer history.",
    });
  }
});
router.post("/contact-events", async (req, res) => {
  try {
    const customerId = Number(req.body?.customerId);
    const method = req.body?.method;

    if (!Number.isInteger(customerId)) {
      return res.status(400).json({
        error: "Invalid customer ID.",
      });
    }

    if (method !== "call" && method !== "whatsapp") {
      return res.status(400).json({
        error: "Invalid contact method.",
      });
    }

    const [customer] = await db
      .select({
        id: customersTable.id,
      })
      .from(customersTable)
      .where(
        sql`${customersTable.id} = ${customerId}`,
      )
      .limit(1);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    const [event] = await db
      .insert(contactEventsTable)
      .values({
        customerId,
        method,
      })
      .returning();

    return res.status(201).json(event);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not log contact event",
    );

    return res.status(500).json({
      error: "Could not log contact event.",
    });
  }
});
// GET CUSTOMER PHONE NUMBERS
router.get("/customers/:id/phones", async (req, res) => {
  try {
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId)) {
      return res.status(400).json({
        error: "Invalid customer ID.",
      });
    }

    const [customer] = await db
      .select({
        id: customersTable.id,
        phone: customersTable.phone,
      })
      .from(customersTable)
      .where(sql`${customersTable.id} = ${customerId}`)
      .limit(1);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    const phones = await db
      .select()
      .from(customerPhonesTable)
      .where(sql`${customerPhonesTable.customerId} = ${customerId}`)
      .orderBy(sql`${customerPhonesTable.isPrimary} DESC`);

    // Keep the existing customers.phone number visible even if it
    // has not yet been migrated into customer_phones.
    if (
      customer.phone &&
      !phones.some((phone) => phone.phone === customer.phone)
    ) {
      phones.unshift({
        id: 0,
        customerId,
        phone: customer.phone,
        label: "Primary",
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return res.json(phones);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not load customer phone numbers",
    );

    return res.status(500).json({
      error: "Could not load customer phone numbers.",
    });
  }
});

// ADD CUSTOMER PHONE NUMBER
router.post("/customers/:id/phones", async (req, res) => {
  try {
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId)) {
      return res.status(400).json({
        error: "Invalid customer ID.",
      });
    }

    const phone =
      typeof req.body?.phone === "string"
        ? req.body.phone.trim()
        : "";

    const label =
      typeof req.body?.label === "string"
        ? req.body.label.trim()
        : null;

    if (!phone) {
      return res.status(400).json({
        error: "Phone number is required.",
      });
    }

    const [customer] = await db
      .select({
        id: customersTable.id,
        phone: customersTable.phone,
      })
      .from(customersTable)
      .where(sql`${customersTable.id} = ${customerId}`)
      .limit(1);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    const existingPhones = await db
      .select()
      .from(customerPhonesTable)
      .where(sql`${customerPhonesTable.customerId} = ${customerId}`);

    const alreadyExists =
      existingPhones.some((item) => item.phone === phone) ||
      customer.phone === phone;

    if (alreadyExists) {
      return res.status(409).json({
        error: "This phone number is already saved.",
      });
    }

    const shouldBePrimary =
      existingPhones.length === 0 && !customer.phone;

    const [createdPhone] = await db
      .insert(customerPhonesTable)
      .values({
        customerId,
        phone,
        label: label || (shouldBePrimary ? "Primary" : null),
        isPrimary: shouldBePrimary,
      })
      .returning();

    // Preserve the existing customers.phone field for the first number.
    if (!customer.phone) {
      await db
        .update(customersTable)
        .set({
          phone,
          updatedAt: new Date(),
        })
        .where(sql`${customersTable.id} = ${customerId}`);
    }

    return res.status(201).json(createdPhone);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not add customer phone number",
    );

    return res.status(500).json({
      error: "Could not add customer phone number.",
    });
  }
});

// UPDATE CUSTOMER PHONE NUMBER
router.patch("/customers/:id/phones/:phoneId", async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const phoneId = Number(req.params.phoneId);

    if (!Number.isInteger(customerId) || !Number.isInteger(phoneId)) {
      return res.status(400).json({
        error: "Invalid customer or phone ID.",
      });
    }

    const phone =
      typeof req.body?.phone === "string"
        ? req.body.phone.trim()
        : "";

    const label =
      typeof req.body?.label === "string"
        ? req.body.label.trim()
        : null;

    if (!phone) {
      return res.status(400).json({
        error: "Phone number is required.",
      });
    }

    const [existing] = await db
      .select()
      .from(customerPhonesTable)
      .where(
        sql`
          ${customerPhonesTable.id} = ${phoneId}
          AND ${customerPhonesTable.customerId} = ${customerId}
        `,
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        error: "Phone number not found.",
      });
    }

    const duplicate = await db
      .select()
      .from(customerPhonesTable)
      .where(
        sql`
          ${customerPhonesTable.customerId} = ${customerId}
          AND ${customerPhonesTable.phone} = ${phone}
          AND ${customerPhonesTable.id} <> ${phoneId}
        `,
      )
      .limit(1);

    if (duplicate.length > 0) {
      return res.status(409).json({
        error: "This phone number is already saved.",
      });
    }

    const [updatedPhone] = await db
      .update(customerPhonesTable)
      .set({
        phone,
        label,
        updatedAt: new Date(),
      })
      .where(
        sql`
          ${customerPhonesTable.id} = ${phoneId}
          AND ${customerPhonesTable.customerId} = ${customerId}
        `,
      )
      .returning();

    return res.json(updatedPhone);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not update customer phone number",
    );

    return res.status(500).json({
      error: "Could not update customer phone number.",
    });
  }
});

// SET PRIMARY CUSTOMER PHONE
router.patch(
  "/customers/:id/phones/:phoneId/primary",
  async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      const phoneId = Number(req.params.phoneId);

      if (!Number.isInteger(customerId) || !Number.isInteger(phoneId)) {
        return res.status(400).json({
          error: "Invalid customer or phone ID.",
        });
      }

      const [phone] = await db
        .select()
        .from(customerPhonesTable)
        .where(
          sql`
            ${customerPhonesTable.id} = ${phoneId}
            AND ${customerPhonesTable.customerId} = ${customerId}
          `,
        )
        .limit(1);

      if (!phone) {
        return res.status(404).json({
          error: "Phone number not found.",
        });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(customerPhonesTable)
          .set({
            isPrimary: false,
            updatedAt: new Date(),
          })
          .where(
            sql`${customerPhonesTable.customerId} = ${customerId}`,
          );

        await tx
          .update(customerPhonesTable)
          .set({
            isPrimary: true,
            updatedAt: new Date(),
          })
          .where(
            sql`
              ${customerPhonesTable.id} = ${phoneId}
              AND ${customerPhonesTable.customerId} = ${customerId}
            `,
          );

        await tx
          .update(customersTable)
          .set({
            phone: phone.phone,
            updatedAt: new Date(),
          })
          .where(sql`${customersTable.id} = ${customerId}`);
      });

      return res.json({
        success: true,
        phone: phone.phone,
      });
    } catch (error) {
      req.log.error(
        { err: error },
        "Could not set primary customer phone",
      );

      return res.status(500).json({
        error: "Could not set primary customer phone.",
      });
    }
  },
);

// DELETE CUSTOMER PHONE
router.delete("/customers/:id/phones/:phoneId", async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const phoneId = Number(req.params.phoneId);

    if (!Number.isInteger(customerId) || !Number.isInteger(phoneId)) {
      return res.status(400).json({
        error: "Invalid customer or phone ID.",
      });
    }

    const [phone] = await db
      .select()
      .from(customerPhonesTable)
      .where(
        sql`
          ${customerPhonesTable.id} = ${phoneId}
          AND ${customerPhonesTable.customerId} = ${customerId}
        `,
      )
      .limit(1);

    if (!phone) {
      return res.status(404).json({
        error: "Phone number not found.",
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(customerPhonesTable)
        .where(
          sql`
            ${customerPhonesTable.id} = ${phoneId}
            AND ${customerPhonesTable.customerId} = ${customerId}
          `,
        );

      if (phone.isPrimary) {
        const [nextPrimary] = await tx
          .select()
          .from(customerPhonesTable)
          .where(
            sql`${customerPhonesTable.customerId} = ${customerId}`,
          )
          .orderBy(sql`${customerPhonesTable.createdAt} ASC`)
          .limit(1);

        await tx
          .update(customerPhonesTable)
          .set({
            isPrimary: Boolean(nextPrimary),
            updatedAt: new Date(),
          })
          .where(
            sql`${customerPhonesTable.id} = ${nextPrimary?.id ?? -1}`,
          );

        await tx
          .update(customersTable)
          .set({
            phone: nextPrimary?.phone ?? null,
            updatedAt: new Date(),
          })
          .where(sql`${customersTable.id} = ${customerId}`);
      }
    });

    return res.status(204).send();
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not delete customer phone number",
    );

    return res.status(500).json({
      error: "Could not delete customer phone number.",
    });
  }
});
export default router;
