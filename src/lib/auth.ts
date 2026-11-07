import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { authSchema, users } from "@/db/schema";
import { eq } from "drizzle-orm";
export const auth = betterAuth({
  appName: "DogBooker",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  advanced: {
    database: { generateId: "uuid" },
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 12,
    cookieCache: { enabled: false },
  },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "owner" },
      dogName: { type: "string", required: false, input: false },
      isActive: { type: "boolean", input: false, defaultValue: true },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: { "/sign-in/email": { window: 60, max: 5 } },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [u] = await db
            .select({ active: users.isActive })
            .from(users)
            .where(eq(users.id, session.userId));
          return u?.active ? { data: session } : false;
        },
      },
    },
  },
  logger: { disabled: process.env.NODE_ENV === "production" },
});
