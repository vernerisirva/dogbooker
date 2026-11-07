import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  date,
  integer,
  bigint,
  jsonb,
  uniqueIndex,
  time as pgTime,
} from "drizzle-orm/pg-core";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  dogName: text("dog_name"),
  role: text("role").notNull(),
  passwordHash: text("password_hash")
    .notNull()
    .default("managed-by-better-auth"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const sessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});
export const accounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: time("access_token_expires_at"),
    refreshTokenExpiresAt: time("refresh_token_expires_at"),
    scope: text("scope"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_account_provider_unique").on(t.providerId, t.accountId),
  ],
);
export const verifications = pgTable("auth_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const rateLimits = pgTable("auth_rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const entries = pgTable("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  note: text("note"),
  status: text("status").notNull().default("active"),
  bookingStatus: text("booking_status"),
  cancelledAt: time("cancelled_at"),
  arrivalTime: pgTime("arrival_time"),
  pickupTime: pgTime("pickup_time"),
  arrivalRevision: integer("arrival_revision").notNull().default(0),
  arrivalResubmissionRequired: boolean("arrival_resubmission_required")
    .notNull()
    .default(false),
  pickupResubmissionRequired: boolean("pickup_resubmission_required")
    .notNull()
    .default(false),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  rateLimit: rateLimits,
};

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => entries.id),
    event: text("event").notNull(),
    eventVersion: integer("event_version").notNull().default(0),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    recipientEmail: text("recipient_email").notNull(),
    payload: jsonb("payload").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: time("available_at").notNull().defaultNow(),
    firstAttemptAt: time("first_attempt_at"),
    leaseToken: uuid("lease_token"),
    lockedUntil: time("locked_until"),
    providerId: text("provider_id"),
    lastError: text("last_error"),
    createdAt: time("created_at").notNull().defaultNow(),
    sentAt: time("sent_at"),
  },
  (t) => [
    uniqueIndex("notification_jobs_booking_event_version_key").on(
      t.bookingId,
      t.event,
      t.eventVersion,
    ),
  ],
);

export const timeWindowSettings = pgTable("time_window_settings", {
  id: boolean("id").primaryKey().default(true),
  revision: integer("revision").notNull().default(0),
  arrivalStart: pgTime("arrival_start").notNull().default("06:00"),
  arrivalEnd: pgTime("arrival_end").notNull().default("23:00"),
  pickupStart: pgTime("pickup_start").notNull().default("06:00"),
  pickupEnd: pgTime("pickup_end").notNull().default("23:00"),
});
export const timeWindowOverrides = pgTable("time_window_overrides", {
  date: date("date").primaryKey(),
  arrivalStart: pgTime("arrival_start").notNull(),
  arrivalEnd: pgTime("arrival_end").notNull(),
  pickupStart: pgTime("pickup_start").notNull(),
  pickupEnd: pgTime("pickup_end").notNull(),
});
export const bookingTimeProposals = pgTable("booking_time_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => entries.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  proposerRole: text("proposer_role").notNull(),
  requestsArrival: boolean("requests_arrival").notNull().default(false),
  requestsPickup: boolean("requests_pickup").notNull().default(false),
  status: text("status").notNull().default("pending"),
  currentArrival: pgTime("current_arrival"),
  currentPickup: pgTime("current_pickup"),
  proposedArrival: pgTime("proposed_arrival"),
  proposedPickup: pgTime("proposed_pickup"),
  createdAt: time("created_at").notNull().defaultNow(),
  resolvedAt: time("resolved_at"),
});

export const reminderScheduleRuns = pgTable(
  "reminder_schedule_runs",
  {
    reminderDate: date("reminder_date").notNull(),
    event: text("event").notNull(),
    wakeAt: time("wake_at").notNull(),
    runId: text("run_id").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reminder_schedule_runs_pkey").on(t.reminderDate, t.event),
  ],
);
