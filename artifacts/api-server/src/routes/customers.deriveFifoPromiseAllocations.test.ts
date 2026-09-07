import { describe, expect, it } from "vitest";
import { deriveFifoPromiseAllocations, type FifoPromiseInput, type FifoPaymentInput } from "./customers";

function promise(
  id: number,
  promiseDate: string,
  promiseAmount: string,
  createdAt = promiseDate,
): FifoPromiseInput {
  return { id, promiseDate: new Date(promiseDate), promiseAmount, createdAt: new Date(createdAt) };
}

function payment(date: string, amount: string): FifoPaymentInput {
  return { date: new Date(date), amount };
}

describe("deriveFifoPromiseAllocations (unit, no DB)", () => {
  it("exact payment on the due date fulfills the promise", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(1, "2026-01-05", "1000.00")],
      [payment("2026-01-06", "-1000.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: true, amountAllocated: 1000 });
  });

  it("partial payment leaves the promise open with partial progress recorded", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(1, "2026-01-05", "1000.00")],
      [payment("2026-01-06", "-600.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: false, amountAllocated: 600 });
  });

  it("a second, later payment completes a promise that was previously only partially paid", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(1, "2026-01-05", "1000.00")],
      [payment("2026-01-06", "-600.00"), payment("2026-01-10", "-400.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: true, amountAllocated: 1000 });
    expect(result.get(1)?.fulfilledAt).toEqual(new Date("2026-01-10"));
  });

  it("overpayment beyond one promise's amount rolls the excess to the next-oldest open promise", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(1, "2026-01-05", "1000.00"), promise(2, "2026-01-08", "500.00")],
      [payment("2026-01-09", "-1200.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: true, amountAllocated: 1000 });
    expect(result.get(2)).toMatchObject({ fulfilled: false, amountAllocated: 200 });
  });

  it("overpayment with no further open promise leaves the excess unaccounted for (an ordinary payment)", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(1, "2026-01-05", "1000.00")],
      [payment("2026-01-06", "-1500.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: true, amountAllocated: 1000 });
  });

  it("early payment (before the promise date) is still eligible to fulfill the promise", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(1, "2026-01-10", "1000.00")],
      [payment("2026-01-03", "-1000.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: true, amountAllocated: 1000 });
  });

  it("a payment with no applicable promise is simply not allocated to anything", () => {
    const result = deriveFifoPromiseAllocations([], [payment("2026-01-06", "-500.00")]);

    expect(result.size).toBe(0);
  });

  it("two same-amount promises: the oldest promiseDate is allocated first, not the most recently created", () => {
    const result = deriveFifoPromiseAllocations(
      [promise(2, "2026-01-08", "1000.00"), promise(1, "2026-01-02", "1000.00")], // deliberately out of array order
      [payment("2026-01-09", "-1000.00")],
    );

    expect(result.get(1)).toMatchObject({ fulfilled: true }); // id 1 has the earlier promiseDate
    expect(result.get(2)).toMatchObject({ fulfilled: false });
  });

  it("equal promiseDate: createdAt breaks the tie", () => {
    const result = deriveFifoPromiseAllocations(
      [
        promise(1, "2026-01-05", "1000.00", "2026-01-05T12:00:00Z"),
        promise(2, "2026-01-05", "1000.00", "2026-01-05T09:00:00Z"), // created earlier, same promiseDate
      ],
      [payment("2026-01-06", "-1000.00")],
    );

    expect(result.get(2)).toMatchObject({ fulfilled: true }); // earlier createdAt wins the tie
    expect(result.get(1)).toMatchObject({ fulfilled: false });
  });

  it("equal promiseDate and createdAt: id breaks the tie", () => {
    const sameInstant = "2026-01-05T12:00:00Z";
    const result = deriveFifoPromiseAllocations(
      [
        promise(5, "2026-01-05", "1000.00", sameInstant),
        promise(2, "2026-01-05", "1000.00", sameInstant),
      ],
      [payment("2026-01-06", "-1000.00")],
    );

    expect(result.get(2)).toMatchObject({ fulfilled: true }); // lower id wins the tie
    expect(result.get(5)).toMatchObject({ fulfilled: false });
  });

  it("out-of-order historical entry: a promise entered after the fact still allocates correctly by its own promiseDate, regardless of array/insertion order", () => {
    // Promise for Jan 1 is passed in *after* a Jan 8 promise, simulating a
    // promise logged late (see decisions.md, Promise Allocation, #13).
    const result = deriveFifoPromiseAllocations(
      [promise(2, "2026-01-08", "500.00"), promise(1, "2026-01-01", "500.00")],
      [payment("2026-01-09", "-500.00")],
    );

    // Regardless of the order these were passed in, id 1 (earlier
    // promiseDate) is allocated first.
    expect(result.get(1)).toMatchObject({ fulfilled: true });
    expect(result.get(2)).toMatchObject({ fulfilled: false });
  });

  it("is a pure function: calling it twice with the same input gives the same result", () => {
    const promises = [promise(1, "2026-01-05", "1000.00")];
    const payments = [payment("2026-01-06", "-600.00")];

    const first = deriveFifoPromiseAllocations(promises, payments);
    const second = deriveFifoPromiseAllocations(promises, payments);

    expect(first.get(1)).toEqual(second.get(1));
  });
});
