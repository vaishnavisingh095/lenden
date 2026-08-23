import { Router, type IRouter } from "express";
import { db, customersTable, customerHistoryTable } from "@workspace/db";
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
            const promiseDate = parsed.data.promise_date
        ? new Date(parsed.data.promise_date)
        : null;

      const paymentStatus = parsed.data.amount_type ?? "outstanding";

      const [customer] = await tx
        .insert(customersTable)
        .values({
          customerName: parsed.data.customer_name,
          amount: parsed.data.amount,
          paymentStatus,
          promiseDate,
          notes: parsed.data.notes,
        })
        .returning();

      const [history] = await tx
        .insert(customerHistoryTable)
        .values({
          customerId: customer.id,
          amount: parsed.data.amount,
          paymentStatus,
          promiseDate,
          notes: parsed.data.notes,
        })
        .returning();

      return {
        customer,
        history,
      };
    });

    res.status(201).json(saved);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not save customer note",
    );

    res.status(500).json({
      error: "Could not save customer note",
    });
  }
});

export default router;
