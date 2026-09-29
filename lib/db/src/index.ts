import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Session-scoped advisory locks must stay pinned to one PostgreSQL connection
// while a request is running. Keep them in a separate small pool so those
// pinned sessions cannot starve the Drizzle query pool used by route handlers.
export const accountRequestLockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
