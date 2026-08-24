import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://verdict_app:changeme_local_dev_only@localhost:5432/verdict",
  },
  strict: true,
  verbose: true,
});
