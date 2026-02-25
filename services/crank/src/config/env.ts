import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: process.env.CRATE_ENV_PATH || ".env" });

const EnvSchema = z.object({
  L1_RPC_URL: z.string().url(),
  ER_RPC_URL: z.string().url(),
  ER_WS_URL: z.string().optional(),
  PROGRAM_ID: z.string().min(32),
  ANCHOR_WALLET: z.string().default("~/.config/solana/id.json"),
  ER_VALIDATOR: z.string().min(32),
  ROUND_DURATION_SECONDS: z.coerce.number().int().positive().default(45),
  MOVE_INTERVAL_MS: z.coerce.number().int().positive().default(100),
  MAX_MOVE_RETRIES: z.coerce.number().int().positive().default(5),
  MAX_STEP_RETRIES: z.coerce.number().int().positive().default(5),
  STUCK_ROUND_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  WS_PATH: z.string().default("/ws"),
  WS_MAX_SUBSCRIPTIONS_PER_SOCKET: z.coerce.number().int().positive().default(5),
  WS_MAX_CONNECTIONS_PER_IP_PER_MIN: z.coerce.number().int().positive().default(60),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PORT: z.coerce.number().int().positive().default(8787),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(): AppEnv {
  return EnvSchema.parse(process.env);
}
