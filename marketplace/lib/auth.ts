import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { localDatabase, localOrigin } from "./config";
export const authPool = new Pool({
  connectionString: localDatabase(
    process.env.MARKETPLACE_AUTH_DATABASE_URL,
    "marketplace_auth",
  ),
  max: 5,
});
export const auth = betterAuth({
  appName: "DogBooker Marketplace",
  baseURL: localOrigin(),
  secret: process.env.MARKETPLACE_AUTH_SECRET,
  database: authPool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "dogbooker-marketplace",
  },
  user: {
    additionalFields: {
      isActive: { type: "boolean", defaultValue: true, input: false },
    },
  },
  session: {
    cookieCache: { enabled: false },
    expiresIn: 86400,
    updateAge: 3600,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) =>
          user.email.endsWith("@example.test") ? { data: user } : false,
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          // Use Better Auth's transaction context: a new signup is not visible on another connection yet.
          const user = await context?.context.internalAdapter.findUserById(
            session.userId,
          );
          return user && "isActive" in user && user.isActive === true
            ? { data: session }
            : false;
        },
      },
    },
  },
  logger: { disabled: true },
});
