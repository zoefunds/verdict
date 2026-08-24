import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

// Fly.io / Docker Postgres: keep the pool modest, this is a single-region
// always-on API, not a serverless function fleet.
const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
