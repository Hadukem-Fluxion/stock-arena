import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["active", "suspended", "banned"]);
export const platform = pgEnum("platform", ["discord", "telegram"]);
export const tickerState = pgEnum("ticker_state", ["live", "paused"]);
export const flagState = pgEnum("flag_state", ["open", "cleared", "actioned"]);
export const priceSource = pgEnum("price_source", ["xstocks", "fluxion_pool"]);

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: instant("created_at").defaultNow().notNull(),
  status: userStatus("status").default("active").notNull(),
});

export const identities = pgTable(
  "identities",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    platform: platform("platform").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    platformCreatedAt: instant("platform_created_at"),
  },
  (table) => [primaryKey({ columns: [table.platform, table.platformUserId] })],
);

export const checkins = pgTable(
  "checkins",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    streak: integer("streak").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").unique(),
    explanation: text("explanation").default("").notNull(),
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<[string, string, string, string]>().notNull(),
    answerIndex: integer("answer_index").notNull(),
    topic: text("topic").notNull(),
    active: boolean("active").default(true).notNull(),
    scheduledDay: date("scheduled_day"),
  },
  (table) => [
    check(
      "quiz_questions_four_options",
      sql`CASE WHEN jsonb_typeof(${table.options}) = 'array' THEN jsonb_array_length(${table.options}) = 4 ELSE false END`,
    ),
    check("quiz_questions_answer_index", sql`${table.answerIndex} BETWEEN 0 AND 3`),
  ],
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    questionIds: uuid("question_ids").array().notNull(),
    answers: integer("answers").array().notNull(),
    startedAt: instant("started_at").array().notNull(),
    score: integer("score").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

/** Private daily snapshot: seed edits cannot change an in-flight quiz or its key. */
export type QuizQuestionSnapshot = {
  id: string;
  topic: string;
  prompt: string;
  options: [string, string, string, string];
  answerIndex: number;
  explanation: string;
};
export const quizDailySets = pgTable("quiz_daily_sets", {
  day: date("day").primaryKey(),
  questions: jsonb("questions").$type<QuizQuestionSnapshot[]>().notNull(),
});

export const hlRuns = pgTable(
  "hl_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    runNumber: integer("run_number").notNull(),
    correctCount: integer("correct_count").default(0).notNull(),
    endedAt: instant("ended_at"),
  },
  (table) => [
    unique("hl_runs_user_day_run_unique").on(table.userId, table.day, table.runNumber),
    check("hl_runs_run_number", sql`${table.runNumber} BETWEEN 1 AND 3`),
  ],
);

export type HlStockSnapshot = { ticker: string; priceUsd: string; change24hPct: number };
/** Private round key and frozen reference prices; never send unanswered changes. */
export const hlRounds = pgTable(
  "hl_rounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => hlRuns.id),
    position: integer("position").notNull(),
    mode: text("mode", { enum: ["live", "last_session"] })
      .default("live")
      .notNull(),
    stocks: jsonb("stocks").$type<[HlStockSnapshot, HlStockSnapshot]>().notNull(),
    winner: text("winner").notNull(),
    choice: text("choice"),
    servedAt: instant("served_at").notNull(),
    answeredAt: instant("answered_at"),
  },
  (table) => [
    unique("hl_rounds_run_position_unique").on(table.runId, table.position),
    check("hl_rounds_position", sql`${table.position} BETWEEN 0 AND 9`),
    check("hl_rounds_mode", sql`${table.mode} IN ('live', 'last_session')`),
    check(
      "hl_rounds_pair",
      sql`jsonb_typeof(${table.stocks}) = 'array' AND jsonb_array_length(${table.stocks}) = 2 AND ${table.stocks}->0->>'ticker' <> ${table.stocks}->1->>'ticker'`,
    ),
    check(
      "hl_rounds_winner",
      sql`${table.winner} IN (${table.stocks}->0->>'ticker', ${table.stocks}->1->>'ticker')`,
    ),
    check(
      "hl_rounds_choice",
      sql`${table.choice} IS NULL OR ${table.choice} IN (${table.stocks}->0->>'ticker', ${table.stocks}->1->>'ticker')`,
    ),
    check("hl_rounds_answer", sql`(${table.choice} IS NULL) = (${table.answeredAt} IS NULL)`),
  ],
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    ticker: text("ticker").notNull(),
    priceUsd: numeric("price_usd").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    source: priceSource("source").default("fluxion_pool").notNull(),
    takenAt: instant("taken_at").notNull(),
  },
  (table) => [index("price_snapshots_ticker_taken_at_idx").on(table.ticker, table.takenAt)],
);

/** Primary-only comparison frozen at closing, independent of snapshot retention. */
export type LastSessionSnapshot = {
  closedAt: string;
  priceUsd: string;
  change24hPct: number;
  closeTakenAt: string;
  baselinePriceUsd: string;
  baselineTakenAt: string;
};

export const tickerStatus = pgTable("ticker_status", {
  ticker: text("ticker").primaryKey(),
  state: tickerState("state").notNull(),
  reason: text("reason"),
  nextChangeAt: instant("next_change_at"),
  tradingPeriod: text("trading_period"),
  tradingHalted: boolean("trading_halted"),
  periodChangeAt: instant("period_change_at"),
  lastClosedAt: instant("last_closed_at"),
  lastSession: jsonb("last_session").$type<LastSessionSnapshot>(),
  updatedAt: instant("updated_at").defaultNow().notNull(),
});

export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    refId: text("ref_id").notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("points_ledger_user_reason_ref_unique").on(table.userId, table.reason, table.refId),
    index("points_ledger_user_created_at_idx").on(table.userId, table.createdAt),
    index("points_ledger_created_at_idx").on(table.createdAt),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id),
    inviteeId: uuid("invitee_id")
      .primaryKey()
      .references(() => users.id),
    qualifiedAt: instant("qualified_at"),
  },
  (table) => [check("referrals_no_self_invite", sql`${table.inviterId} <> ${table.inviteeId}`)],
);

export const flags = pgTable("flags", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  raisedBy: uuid("raised_by")
    .notNull()
    .references(() => users.id),
  note: text("note").notNull(),
  state: flagState("state").default("open").notNull(),
  createdAt: instant("created_at").defaultNow().notNull(),
});

export const adminActions = pgTable("admin_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => users.id),
  reason: text("reason").notNull(),
  createdAt: instant("created_at").defaultNow().notNull(),
});
