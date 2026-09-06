import { afterAll, beforeEach } from "vitest";

/**
 * Safety gate: tests must run against a disposable database, never against
 * DATABASE_URL (which may be a real dev/production database). @workspace/db
 * reads DATABASE_URL at import time, so we validate and then redirect it to
 * TEST_DATABASE_URL *before* anything in this file imports @workspace/db or
 * the app.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set.\n\n" +
      "Tests must run against a disposable Postgres database, never against " +
      "DATABASE_URL. Set TEST_DATABASE_URL to a throwaway database and push " +
      "the schema to it once, e.g.:\n\n" +
      "  createdb lenden_test\n" +
      "  DATABASE_URL=postgres://localhost:5432/lenden_test \\\n" +
      "    pnpm --filter @workspace/db run push --force\n\n" +
      "Then run tests with:\n\n" +
      "  TEST_DATABASE_URL=postgres://localhost:5432/lenden_test pnpm --filter @workspace/api-server run test\n",
  );
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run tests " +
      "against what may be a real development or production database. Point " +
      "TEST_DATABASE_URL at a separate, disposable database.",
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.LOG_LEVEL ??= "silent";

const { pool } = await import("@workspace/db");

const TEST_TABLES = [
  "contact_events",
  "promise_history",
  "customer_phones",
  "transactions",
  "customers",
] as const;

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE ${TEST_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});
