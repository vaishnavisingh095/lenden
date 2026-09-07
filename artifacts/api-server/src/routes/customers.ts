import { Router, type IRouter } from "express";
import {
  db,
  customersTable,
  transactionsTable,
  promiseHistoryTable,
  contactEventsTable,
  customerPhonesTable,
  idempotencyClaimsTable,
} from "@workspace/db";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

export type FifoPromiseInput = {
  id: number;
  promiseDate: Date;
  promiseAmount: string; // numeric string; caller must exclude amount-less promises
  createdAt: Date;
};

export type FifoPaymentInput = {
  amount: string; // numeric string, negative for a payment (e.g. "-500.00")
  date: Date;
};

export type FifoAllocationResult = {
  fulfilled: boolean;
  amountAllocated: number;
  fulfilledAt: Date | null;
};

/**
 * Derives FIFO promise-allocation state from a customer's complete
 * promise/payment history. Pure function — no DB access, deterministic,
 * safe to re-run on every read. See decisions.md, Promise Allocation.
 *
 * Ordering: oldest promiseDate first, then createdAt, then id, as the
 * deterministic tie-breakers. Payments are applied in date order; each
 * payment fills the oldest not-yet-fulfilled promise(s) it can, with any
 * leftover continuing to the next-oldest open promise. A payment with no
 * remaining open promise to apply to is simply an ordinary payment — it
 * has no further effect here.
 *
 * Note on the tie-break chain in practice: Postgres freezes now() to
 * transaction-start time, so multiple promises created in the same
 * /customers/notes/batch call share an identical createdAt. In that
 * (common) case, id — not createdAt — is what actually breaks the tie.
 * This does not affect correctness (id is a valid total order), only
 * which tier of the chain is doing the work.
 *
 * Money is handled in integer paise internally to avoid floating-point
 * drift across repeated additions/subtractions.
 */
export function deriveFifoPromiseAllocations(
  promises: FifoPromiseInput[],
  payments: FifoPaymentInput[],
): Map<number, FifoAllocationResult> {
  const toPaise = (value: string | number) => Math.round(Number(value) * 100);

  const sortedPromises = [...promises].sort((a, b) => {
    const byDate = a.promiseDate.getTime() - b.promiseDate.getTime();
    if (byDate !== 0) return byDate;

    const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreatedAt !== 0) return byCreatedAt;

    return a.id - b.id;
  });

  const sortedPayments = [...payments].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const remainingPaise = new Map<number, number>(
    sortedPromises.map((promise) => [promise.id, toPaise(promise.promiseAmount)]),
  );
  const fulfilledAt = new Map<number, Date>();

  for (const payment of sortedPayments) {
    let availablePaise = Math.abs(toPaise(payment.amount));

    for (const promise of sortedPromises) {
      if (availablePaise <= 0) break;

      const owedPaise = remainingPaise.get(promise.id)!;
      if (owedPaise <= 0) continue;

      const appliedPaise = Math.min(availablePaise, owedPaise);
      const nextOwedPaise = owedPaise - appliedPaise;

      remainingPaise.set(promise.id, nextOwedPaise);
      availablePaise -= appliedPaise;

      if (nextOwedPaise <= 0 && !fulfilledAt.has(promise.id)) {
        fulfilledAt.set(promise.id, payment.date);
      }
    }
  }

  const result = new Map<number, FifoAllocationResult>();

  for (const promise of sortedPromises) {
    const owedPaise = remainingPaise.get(promise.id)!;
    const totalPaise = toPaise(promise.promiseAmount);

    result.set(promise.id, {
      fulfilled: owedPaise <= 0,
      amountAllocated: (totalPaise - owedPaise) / 100,
      fulfilledAt: fulfilledAt.get(promise.id) ?? null,
    });
  }

  return result;
}

export const parsePromiseDate = (
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


export const saveCustomerNoteSchema = z
  .object({
    // Required: identifies this logical event so retries and duplicate
    // submissions can be recognized instead of creating a second record.
    // See decisions.md, Idempotency.
    client_event_id: z.string().trim().min(1, "client_event_id is required"),

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

    // Required: an ambiguous or missing amount_type must be rejected, not
    // silently interpreted as "outstanding". See decisions.md #5.
    amount_type: z.enum(["received", "promised", "outstanding"]),

    promise_date: z.string().trim().optional().nullable(),

    notes: z.string().trim().optional().default(""),
  })
  .superRefine((data, ctx) => {
    // received/outstanding require a real, nonzero amount. See decisions.md #6.
    if (
      (data.amount_type === "received" || data.amount_type === "outstanding") &&
      data.amount !== null &&
      Number(data.amount) <= 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "Amount must be greater than zero for this transaction type.",
      });
    }
  });


type SaveCustomerNoteInput = z.infer<typeof saveCustomerNoteSchema>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thrown when a client_event_id has already been used with a payload that
 * differs in its financially meaningful fields. Distinguished from other
 * errors so callers can map it to 409 instead of 500.
 */
class IdempotencyConflictError extends Error {
  constructor(public readonly clientEventId: string) {
    super(
      `client_event_id "${clientEventId}" was already used with a different payload.`,
    );
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Thrown when customer identity cannot be resolved safely: either the
 * supplied name or phone already matches more than one existing customer,
 * or a supplied phone conflicts with a different phone already on file for
 * a name-matched customer. See decisions.md, Customer Identity, #4 and #5
 * — ambiguity must be surfaced, not silently guessed.
 */
class AmbiguousCustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousCustomerError";
  }
}

/** True for a Postgres lock_timeout error (SQLSTATE 55P03), surfaced by
 * node-postgres/Drizzle as error.cause, not the top-level error. */
function isLockTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.cause !== undefined &&
    error.cause !== null &&
    typeof error.cause === "object" &&
    "code" in error.cause &&
    (error.cause as { code?: unknown }).code === "55P03"
  );
}

/** Maps a known event-processing error to its HTTP status; 500 otherwise. */
function statusForEventError(error: unknown): number {
  if (error instanceof IdempotencyConflictError) return 409;
  if (error instanceof AmbiguousCustomerError) return 409;
  if (isLockTimeoutError(error)) return 503;
  return 500;
}

/** Wraps an error from one event in a batch with the index it occurred at. */
class BatchEventError extends Error {
  constructor(
    public readonly index: number,
    public readonly clientEventId: string | undefined,
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "Could not save this event.");
    this.name = "BatchEventError";
  }
}

/**
 * Finds every existing customer matching a phone number, checking both the
 * legacy single customers.phone field and the multi-phone customer_phones
 * table (a customer's phone can live in either, depending on when it was
 * added). Returns full customer rows, deduplicated by id.
 */
/**
 * Canonical form of a phone number for comparison and locking: digits
 * only, and — since this product operates on Indian mobile numbers — the
 * last 10 digits, so a country-code prefix (+91, 0091, a leading trunk 0)
 * doesn't make an otherwise-identical number look like a different one.
 * This is the ONE normalization function used for both lookup and the
 * advisory lock key, so the two can never disagree about what counts as
 * "the same phone." See decisions.md, Phone Normalization.
 */
function normalizePhone(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  return digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
}

async function findCustomersByPhone(tx: Tx, phone: string) {
  const targetPhone = normalizePhone(phone);

  const [directRows, phoneTableRows] = await Promise.all([
    tx
      .select({ id: customersTable.id, phone: customersTable.phone })
      .from(customersTable)
      .where(isNotNull(customersTable.phone)),
    tx
      .select({ id: customerPhonesTable.customerId, phone: customerPhonesTable.phone })
      .from(customerPhonesTable),
  ]);

  const ids = new Set<number>();

  for (const row of directRows) {
    if (row.phone && normalizePhone(row.phone) === targetPhone) {
      ids.add(row.id);
    }
  }

  for (const row of phoneTableRows) {
    if (normalizePhone(row.phone) === targetPhone) {
      ids.add(row.id);
    }
  }

  if (ids.size === 0) {
    return [];
  }

  return tx.select().from(customersTable).where(inArray(customersTable.id, [...ids]));
}

/** Every phone number already on file for a customer, across both storage locations, in canonical form. */
async function getKnownPhones(tx: Tx, customerId: number): Promise<Set<string>> {
  const [customerRow] = await tx
    .select({ phone: customersTable.phone })
    .from(customersTable)
    .where(eq(customersTable.id, customerId));

  const phoneRows = await tx
    .select({ phone: customerPhonesTable.phone })
    .from(customerPhonesTable)
    .where(eq(customerPhonesTable.customerId, customerId));

  const known = new Set<string>();

  if (customerRow?.phone) {
    known.add(normalizePhone(customerRow.phone));
  }

  for (const row of phoneRows) {
    known.add(normalizePhone(row.phone));
  }

  return known;
}

/**
 * Resolves the customer for an event, or creates one if none exists.
 * Phone-first when a phone is supplied, falling back to name only when
 * phone resolution finds no candidates. Ambiguity (a name or phone already
 * matching more than one customer, or a supplied phone conflicting with a
 * different one already on file) is surfaced via AmbiguousCustomerError
 * rather than guessed. See decisions.md, Customer Identity.
 *
 * Concurrency: a brand-new name/phone combination racing with another
 * identical request could otherwise create two customer rows (no unique
 * constraint exists on either field — see decisions.md #6 for why not).
 * pg_advisory_xact_lock serializes concurrent resolution attempts for the
 * same key without asserting global uniqueness. The name key is always
 * locked; the phone key is additionally locked when supplied, in a fixed
 * order (phone before name), so two requests can never deadlock by
 * acquiring the two locks in opposite orders. A bounded lock_timeout
 * ensures a stuck request fails fast rather than blocking indefinitely.
 */
async function resolveOrCreateCustomer(
  tx: Tx,
  params: {
    customerName: string;
    phone: string | null | undefined;
    amount: string | null;
    amountType: "received" | "promised" | "outstanding";
    promiseDate: Date | null;
    notes: string;
  },
) {
  const { customerName, phone, amount, amountType, promiseDate, notes } = params;
  const normalizedName = customerName.trim().toLowerCase();

  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);

  if (phone) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${normalizePhone(phone)}`}))`,
    );
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-name:${normalizedName}`}))`,
  );

  if (phone) {
    const phoneMatches = await findCustomersByPhone(tx, phone);

    if (phoneMatches.length === 1) {
      return phoneMatches[0];
    }

    if (phoneMatches.length > 1) {
      throw new AmbiguousCustomerError(
        `Phone ${phone} already matches more than one existing customer.`,
      );
    }
    // Zero phone matches — fall back to name resolution.
  }

  const nameMatches = await tx
    .select()
    .from(customersTable)
    .where(sql`lower(${customersTable.customerName}) = ${normalizedName}`);

  if (nameMatches.length > 1) {
    throw new AmbiguousCustomerError(
      `"${customerName}" already matches more than one existing customer.`,
    );
  }

  if (nameMatches.length === 1) {
    const matched = nameMatches[0];

    if (phone) {
      const knownPhones = await getKnownPhones(tx, matched.id);

      if (knownPhones.size > 0 && !knownPhones.has(normalizePhone(phone))) {
        throw new AmbiguousCustomerError(
          `"${customerName}" is already known with a different phone number.`,
        );
      }

      if (knownPhones.size === 0) {
        const [updated] = await tx
          .update(customersTable)
          .set({ phone, updatedAt: new Date() })
          .where(eq(customersTable.id, matched.id))
          .returning();

        return updated;
      }
    }

    return matched;
  }

  // No existing customer found by phone or name — create one.
  //
  // The old amount/paymentStatus fields are kept populated for backward
  // compatibility with the existing database. NEW balance calculations do
  // NOT use those fields.
  const [created] = await tx
    .insert(customersTable)
    .values({
      customerName,
      phone,
      amount,
      paymentStatus: amountType,
      promiseAmount: amountType === "promised" ? amount : null,
      promiseDate: amountType === "promised" ? promiseDate : null,
      notes,
    })
    .returning();

  return created;
}

/** A customer's current balance: SUM(transactions.amount), never cached. */
async function getBalance(tx: Tx, customerId: number): Promise<number> {
  const [balanceRow] = await tx
    .select({
      balance: sql<string>`COALESCE(SUM(${transactionsTable.amount}), 0)`,
    })
    .from(transactionsTable)
    .where(sql`${transactionsTable.customerId} = ${customerId}`);

  return Number(balanceRow?.balance ?? "0");
}

/**
 * The single financial write path. Executes inside the caller's transaction
 * (tx) — it never opens its own — so a single event and a batch of events
 * share identical logic and identical atomicity guarantees.
 *
 * Idempotency: claims client_event_id in idempotency_claims (one global
 * unique constraint, contended on before any other work) before doing
 * anything else. If the claim is lost to a real, committed conflict, the
 * request is resolved as a replay/conflict against whatever that claim
 * points to — regardless of which table or event type it turned out to
 * be. See decisions.md, Idempotency, and replayExistingEvent below.
 */
async function applyFinancialEvent(tx: Tx, event: SaveCustomerNoteInput) {
  const {
    client_event_id,
    customer_name,
    phone,
    amount,
    amount_type,
    promise_date,
    notes,
  } = event;

  // Claim this event's identity first, before any other work — the single
  // global contention point every event races on, regardless of type or
  // which table it will eventually write to. See decisions.md,
  // Idempotency (cross-table ledger).
  const [claim] = await tx
    .insert(idempotencyClaimsTable)
    .values({ clientEventId: client_event_id })
    .onConflictDoNothing({ target: idempotencyClaimsTable.clientEventId })
    .returning();

  if (!claim) {
    const [existingClaim] = await tx
      .select()
      .from(idempotencyClaimsTable)
      .where(eq(idempotencyClaimsTable.clientEventId, client_event_id));

    if (!existingClaim) {
      // Should not happen: a reported insert conflict means Postgres has
      // already confirmed a committed row exists under this id.
      throw new Error("Could not resolve idempotency claim; please retry.");
    }

    return replayExistingEvent(tx, event, existingClaim);
  }

  const promiseDate = parsePromiseDate(promise_date);

  if (promise_date && !promiseDate) {
    throw new Error("Invalid promise date.");
  }

  const customer = await resolveOrCreateCustomer(tx, {
    customerName: customer_name,
    phone,
    amount,
    amountType: amount_type,
    promiseDate,
    notes,
  });

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

    const [insertedPromise] = await tx
      .insert(promiseHistoryTable)
      .values({
        customerId: customer.id,
        promiseDate: promiseDate!,
        promiseAmount: amount,
        fulfilled: false,
      })
      .returning();

    await tx
      .update(idempotencyClaimsTable)
      .set({ customerId: customer.id, promiseId: insertedPromise.id })
      .where(eq(idempotencyClaimsTable.clientEventId, client_event_id));

    return {
      customer: updatedCustomer,
      transaction: null,
      balance: await getBalance(tx, customer.id),
      replayed: false,
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
      throw new Error("Amount is required when a payment is received.");
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

    await tx
      .update(idempotencyClaimsTable)
      .set({ customerId: customer.id, transactionId: transaction.id })
      .where(eq(idempotencyClaimsTable.clientEventId, client_event_id));

    // Promise fulfillment is derived at read time from the customer's
    // complete promise/payment history (see deriveFifoPromiseAllocations)
    // — the stored `fulfilled` column is not authoritative for
    // amount-bearing promises. See decisions.md, Promise Allocation, #12
    // and #14.

    return {
      customer,
      transaction,
      balance: await getBalance(tx, customer.id),
      replayed: false,
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

  await tx
    .update(idempotencyClaimsTable)
    .set({ customerId: customer.id, transactionId: transaction.id })
    .where(eq(idempotencyClaimsTable.clientEventId, client_event_id));

  return {
    customer,
    transaction,
    balance: await getBalance(tx, customer.id),
    replayed: false,
  };
}

/**
 * Called when client_event_id already has a claim. Fetches the customer
 * and the specific transaction-or-promise row the claim points to, and
 * compares the financially meaningful fields of that row against the new
 * request. Identical → returns the original result, nothing new written.
 * Different → throws IdempotencyConflictError, which rolls back the
 * caller's whole transaction (nothing from a rejected event may mutate
 * financial state — see CODE_OF_CONDUCT.md, Invariants).
 */
async function replayExistingEvent(
  tx: Tx,
  event: SaveCustomerNoteInput,
  claim: typeof idempotencyClaimsTable.$inferSelect,
) {
  const { client_event_id, customer_name, amount, amount_type } = event;

  const [existingCustomer] = claim.customerId
    ? await tx
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, claim.customerId))
    : [];

  const [existingTransaction] = claim.transactionId
    ? await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.id, claim.transactionId))
    : [];

  const [existingPromise] = claim.promiseId
    ? await tx
        .select()
        .from(promiseHistoryTable)
        .where(eq(promiseHistoryTable.id, claim.promiseId))
    : [];

  const sameCustomer =
    existingCustomer !== undefined &&
    existingCustomer.customerName.toLowerCase() === customer_name.toLowerCase();

  let matches = sameCustomer;

  if (matches && existingTransaction) {
    const expectedType =
      amount_type === "received"
        ? "payment"
        : amount_type === "outstanding"
          ? "purchase"
          : null; // "promised" can never match a transactions row
    const expectedAmount =
      amount === null
        ? null
        : amount_type === "received"
          ? -Number(amount)
          : Number(amount);

    matches =
      matches &&
      existingTransaction.type === expectedType &&
      expectedAmount !== null &&
      Number(existingTransaction.amount) === expectedAmount;
  } else if (matches && existingPromise) {
    const sameAmount =
      (existingPromise.promiseAmount === null && amount === null) ||
      (existingPromise.promiseAmount !== null &&
        amount !== null &&
        Number(existingPromise.promiseAmount) === Number(amount));

    matches =
      matches &&
      amount_type === "promised" &&
      sameAmount &&
      existingPromise.promiseDate.getTime() ===
        parsePromiseDate(event.promise_date)?.getTime();
  } else {
    // The claim exists but doesn't yet point at a completed write (or
    // points at neither table) — not a valid replay target.
    matches = false;
  }

  if (!matches) {
    throw new IdempotencyConflictError(client_event_id);
  }

  return {
    customer: existingCustomer,
    transaction: existingTransaction ?? null,
    balance: claim.customerId ? await getBalance(tx, claim.customerId) : 0,
    replayed: true,
  };
}

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
    const saved = await db.transaction(async (tx) =>
      applyFinancialEvent(tx, parsed.data),
    );

    res.status(saved.replayed ? 200 : 201).json(saved);
  } catch (error) {
    const status = statusForEventError(error);

    if (status !== 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Could not save customer note",
      });
      return;
    }

    req.log.error(
      { err: error },
      "Could not save customer note",
    );

    // Never return raw internal error detail (SQL, params, schema names) to
    // the client for an unclassified failure — only for the intentional,
    // hand-written errors handled above (status !== 500 branch). See
    // decisions.md, Error Disclosure.
    res.status(500).json({
      error: "Could not save customer note",
    });
  }
});

router.post("/customers/notes/batch", async (req, res) => {
  const rawEvents = req.body?.events;

  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    res.status(400).json({ error: "A non-empty events array is required." });
    return;
  }

  const parsedEvents: SaveCustomerNoteInput[] = [];
  const validationErrors: Record<number, unknown> = {};

  rawEvents.forEach((rawEvent, index) => {
    const parsed = saveCustomerNoteSchema.safeParse(rawEvent);

    if (!parsed.success) {
      validationErrors[index] = parsed.error.flatten().fieldErrors;
    } else {
      parsedEvents[index] = parsed.data;
    }
  });

  if (Object.keys(validationErrors).length > 0) {
    res.status(400).json({
      error: "One or more events in this batch are invalid.",
      details: validationErrors,
    });
    return;
  }

  try {
    const saved = await db.transaction(async (tx) => {
      const results = [];

      for (let index = 0; index < parsedEvents.length; index += 1) {
        try {
          results.push(await applyFinancialEvent(tx, parsedEvents[index]));
        } catch (error) {
          throw new BatchEventError(
            index,
            parsedEvents[index].client_event_id,
            error,
          );
        }
      }

      return results;
    });

    // Mirror the single-event route: 200 when every event in the batch
    // was a pure replay (nothing new committed), 201 if anything was
    // actually created. See decisions.md, Batch Replay Status.
    const allReplayed = saved.every((result) => result.replayed);
    res.status(allReplayed ? 200 : 201).json({ events: saved });
  } catch (error) {
    if (error instanceof BatchEventError) {
      const status = statusForEventError(error.cause);

      if (status === 500) {
        req.log.error({ err: error.cause }, "Could not save event batch");
      }

      res.status(status).json({
        error:
          "This batch was not saved. No event from it was committed.",
        failedEvent: {
          index: error.index,
          client_event_id: error.clientEventId,
        },
        // Only safe, hand-written error messages (idempotency conflict,
        // ambiguous customer, lock timeout) are ever shown verbatim — an
        // unclassified failure never leaks its raw internal detail. See
        // decisions.md, Error Disclosure.
        message: status === 500 ? "Could not save this event." : error.message,
      });
      return;
    }

    req.log.error({ err: error }, "Could not save event batch");

    res.status(500).json({ error: "Could not save event batch" });
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
  customers.map((customer) => {
    const balance = Number(customer.balance ?? "0");
    const phoneNumbers =
      phonesByCustomer.get(customer.id) ?? [];

    let priority: "high" | "medium" | "low" = "low";
    let recommendedAction:
      | "call"
      | "whatsapp"
      | "none" = "none";

    let reason = "No follow-up needed right now.";

    if (balance > 0) {
      if (customer.promiseDate) {
        const promiseDate = new Date(customer.promiseDate);
        const today = new Date();

        const isSameDay =
          promiseDate.getFullYear() === today.getFullYear() &&
          promiseDate.getMonth() === today.getMonth() &&
          promiseDate.getDate() === today.getDate();

        const isOverdue =
          promiseDate < today && !isSameDay;

        if (isOverdue) {
          priority = "high";
          recommendedAction =
            phoneNumbers.length > 0 || customer.phone
              ? "call"
              : "none";

          reason =
            "Payment promise was missed and the balance is still outstanding.";
        } else if (isSameDay) {
          priority = "high";
          recommendedAction =
            phoneNumbers.length > 0 || customer.phone
              ? "call"
              : "none";

          reason =
            "Payment promise is due today and the balance is still outstanding.";
        } else {
          priority = "low";
          recommendedAction = "none";

          reason =
            "Payment promise is still upcoming.";
        }
      } else if (balance >= 50000) {
        priority = "high";
        recommendedAction =
          phoneNumbers.length > 0 || customer.phone
            ? "call"
            : "none";

        reason =
          "High outstanding amount needs attention.";
      } else if (balance >= 20000) {
        priority = "medium";
        recommendedAction =
          phoneNumbers.length > 0 || customer.phone
            ? "whatsapp"
            : "none";

        reason =
          "Outstanding balance needs follow-up.";
      } else {
        priority = "low";
        recommendedAction =
          phoneNumbers.length > 0 || customer.phone
            ? "whatsapp"
            : "none";

        reason =
          "Smaller outstanding balance can be followed up when convenient.";
      }
    }

    return {
      ...customer,
      balance,
      phoneNumbers,
      followUp: {
        priority,
        recommendedAction,
        reason,
      },
    };
  }),
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
        createdAt: promiseHistoryTable.createdAt,
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

    // Fulfillment is derived from complete history for amount-bearing
    // promises (never trusting the stored `fulfilled` column as
    // authoritative for them — decisions.md #14). Amount-less promises
    // have no history to derive from, so their stored `fulfilled` value is
    // authoritative — it only ever changes via explicit owner confirmation
    // (decisions.md, Amount-less Promise Confirmation).
    const fifoAllocations = deriveFifoPromiseAllocations(
      promises
        .filter((promise) => promise.promiseAmount !== null)
        .map((promise) => ({
          id: promise.id,
          promiseDate: promise.promiseDate,
          promiseAmount: promise.promiseAmount!,
          createdAt: promise.createdAt,
        })),
      paymentTransactions.map((transaction) => ({
        amount: transaction.amount,
        date: transaction.date,
      })),
    );

    const promisesWithDerivedStatus = promises.map((promise) => {
      if (promise.promiseAmount === null) {
        return {
          ...promise,
          amountAllocated: null as number | null,
          fulfilledAt: null as Date | null,
        };
      }

      const allocation = fifoAllocations.get(promise.id);

      return {
        ...promise,
        fulfilled: allocation?.fulfilled ?? false,
        amountAllocated: allocation?.amountAllocated ?? 0,
        fulfilledAt: allocation?.fulfilledAt ?? null,
      };
    });

    const fulfilledPromises = promisesWithDerivedStatus.filter(
      (promise) => promise.fulfilled,
    );

    const brokenPromises = promisesWithDerivedStatus.filter(
      (promise) =>
        !promise.fulfilled &&
        promise.promiseDate <= new Date(),
    );
        // The legacy customers.promiseAmount/promiseDate fallback is only
        // valid when this customer has NO promise_history rows at all
        // (old data predating that table). Once promise_history has any
        // rows, it is authoritative — even when every one of them is
        // fulfilled, which must resolve to "no current promise" (and thus
        // promiseStatus "paid" below), not to a stale legacy value that is
        // never cleared when a promise is paid off. See decisions.md,
        // Legacy Promise Fallback.
        const currentPromise =
      promisesWithDerivedStatus.length > 0
        ? ([...promisesWithDerivedStatus]
            .filter((promise) => !promise.fulfilled)
            .sort(
              (a, b) =>
                new Date(a.promiseDate).getTime() -
                new Date(b.promiseDate).getTime(),
            )[0] ?? null)
        : customer.promiseAmount && customer.promiseDate
          ? {
              promiseDate: new Date(customer.promiseDate),
              promiseAmount: customer.promiseAmount,
              fulfilled: false,
            }
          : null;

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
      // Amount-less promises are fulfilled only by explicit owner
      // confirmation (decisions.md, Amount-less Promise Confirmation),
      // with no derivable completion date — they don't contribute to the
      // days-late/follow-up averages below.
      if (!promise.fulfilledAt) {
        continue;
      }

      const promiseDate = new Date(promise.promiseDate);
      const paymentDate = new Date(promise.fulfilledAt);

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
      promises: promisesWithDerivedStatus,
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
// CONFIRM OR UNCONFIRM AN AMOUNT-LESS PROMISE
//
// Amount-less promises have no amount to allocate payments against, so
// they can never be fulfilled by FIFO derivation. The only way one changes
// state is this explicit owner action. See decisions.md, Amount-less
// Promise Confirmation.
router.patch(
  "/customers/:id/promises/:promiseId",
  async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      const promiseId = Number(req.params.promiseId);

      if (!Number.isInteger(customerId) || !Number.isInteger(promiseId)) {
        return res.status(400).json({
          error: "Invalid customer or promise ID.",
        });
      }

      if (typeof req.body?.fulfilled !== "boolean") {
        return res.status(400).json({
          error: "A boolean 'fulfilled' value is required.",
        });
      }

      const [existing] = await db
        .select()
        .from(promiseHistoryTable)
        .where(
          sql`
            ${promiseHistoryTable.id} = ${promiseId}
            AND ${promiseHistoryTable.customerId} = ${customerId}
          `,
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({
          error: "Promise not found.",
        });
      }

      if (existing.promiseAmount !== null) {
        return res.status(400).json({
          error:
            "This promise has a stated amount — its fulfillment is derived from payment history, not set directly.",
        });
      }

      const [updated] = await db
        .update(promiseHistoryTable)
        .set({ fulfilled: req.body.fulfilled })
        .where(sql`${promiseHistoryTable.id} = ${promiseId}`)
        .returning();

      return res.json(updated);
    } catch (error) {
      req.log.error(
        { err: error },
        "Could not update promise confirmation",
      );

      return res.status(500).json({
        error: "Could not update promise confirmation.",
      });
    }
  },
);

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
