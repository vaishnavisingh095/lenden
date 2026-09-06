import { describe, expect, it } from "vitest";
import { parsePromiseDate } from "./customers";

/**
 * CHARACTERIZATION TESTS.
 *
 * These document the current behavior of parsePromiseDate for the two
 * "weekday + next month" phrasings, per audit finding A5. No parsing logic
 * has been changed — these tests only record what the function does today.
 */
describe("parsePromiseDate — 'weekday next month' phrasing (characterization)", () => {
  it("CURRENTLY returns null for 'Friday next month' even though a date is computed internally (BUG — see audit finding A5: the computed result is never returned)", () => {
    const result = parsePromiseDate("Friday next month");

    expect(result).toBeNull();
  });

  it("currently parses 'next month Friday' (opposite word order) to a Friday in next calendar month", () => {
    const result = parsePromiseDate("next month Friday");

    expect(result).toBeInstanceOf(Date);

    const now = new Date();
    const expectedMonth = (now.getMonth() + 1) % 12;

    expect(result?.getDay()).toBe(5); // Friday
    expect(result?.getMonth()).toBe(expectedMonth);
  });

  it("currently parses other weekday + 'next month' combinations consistently as null (not specific to Friday)", () => {
    expect(parsePromiseDate("Monday next month")).toBeNull();
    expect(parsePromiseDate("Wednesday next month")).toBeNull();
  });
});
