import { Router, type IRouter } from "express";
import { db, customersTable, transactionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

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
        amount,
        amount_type,
        promise_date,
        notes,
      } = parsed.data;

      const promiseDate = promise_date ? new Date(promise_date) : null;

      if (promise_date && Number.isNaN(promiseDate?.getTime())) {
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
router.get("/customers/:id", async (req, res) => {
  const customerId = Number(req.params.id);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({
      error: "Invalid customer id",
    });

    return;
  }

  try {
    const [customer] = await db
      .select({
        id: customersTable.id,
        customerName: customersTable.customerName,
        promiseAmount: customersTable.promiseAmount,
        promiseDate: customersTable.promiseDate,
        notes: customersTable.notes,
      })
      .from(customersTable)
      .where(sql`${customersTable.id} = ${customerId}`)
      .limit(1);

    if (!customer) {
      res.status(404).json({
        error: "Customer not found",
      });

      return;
    }

    const transactions = await db
      .select({
        id: transactionsTable.id,
        amount: transactionsTable.amount,
        type: transactionsTable.type,
        date: transactionsTable.date,
        source: transactionsTable.source,
        notes: transactionsTable.notes,
      })
      .from(transactionsTable)
      .where(
        sql`${transactionsTable.customerId} = ${customerId}`,
      )
      .orderBy(sql`${transactionsTable.date} DESC`);

    const balance = transactions.reduce(
      (total, transaction) =>
        total + Number(transaction.amount),
      0,
    );

    res.json({
      customer,
      balance,
      transactions,
    });
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not load customer history",
    );

    res.status(500).json({
      error: "Could not load customer history",
    });
  }
});
router.get("/customers", async (_req, res) => {
  try {
    const customers = await db
      .select({
        id: customersTable.id,
        customerName: customersTable.customerName,
        promiseAmount: customersTable.promiseAmount,
        promiseDate: customersTable.promiseDate,
        notes: customersTable.notes,

        balance: sql<string>`
          COALESCE(SUM(${transactionsTable.amount}), 0)
        `,

        lastTransactionDate: sql<Date | null>`
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

    res.json(
      customers.map((customer) => ({
        ...customer,
        balance: Number(customer.balance),
      })),
    );
  } catch (error) {
    _req.log.error(
      { err: error },
      "Could not load customers",
    );

    res.status(500).json({
      error: "Could not load customers",
    });
  }
});
export default router;
