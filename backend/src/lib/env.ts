import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BACKEND_PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  SESSION_REFRESH_SECRET: z.string().min(16),
  SESSION_REFRESH_EXPIRES_IN: z.string().default("7d"),
  EVIDENCE_STORAGE_PATH: z.string().default("./storage/uploads"),
  EVIDENCE_MAX_FILE_SIZE_MB: z.coerce.number().default(25),
  GENLAYER_RPC_URL: z.string().optional(),
  GENLAYER_CHAIN_ID: z.string().optional(),
  VERDICT_CONTRACT_ADDRESS: z.string().optional(),
  GENLAYER_INDEXER_START_BLOCK: z.coerce.number().default(0),
  REDIS_URL: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
