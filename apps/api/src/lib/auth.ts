import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@chat/db";
import { env } from "./env.js";
import * as schema from "@chat/db/schema";

export function createAuth() {
  const db = getDb(env.DATABASE_URL);
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_URL, env.API_URL, "http://localhost:3000", ...env.EXTRA_ORIGINS],
    session: { cookieCache: { enabled: true } },
    advanced: {
      crossSubDomainCookies: { enabled: false },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
