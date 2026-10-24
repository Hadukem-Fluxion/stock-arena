import { sql } from "drizzle-orm";
import type { Asset } from "@stock-arena/game-core";
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["active", "suspended", "banned"]);
export const platform = pgEnum("platform", ["discord", "telegram"]);
export const tickerState = pgEnum("ticker_state", ["live", "paused"]);
export const flagState = pgEnum("flag_state", ["open", "cleared", "actioned"]);
export const priceSource = pgEnum("price_source", ["xstocks", "fluxion_pool"]);
export const staffRole = pgEnum("staff_role", ["owner", "admin", "moderator", "support"]);

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
    model: text("model", { enum: ["classic", "prediction"] })
      .default("classic")
      .notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
    lastSettledAt: instant("last_settled_at"),
    requestId: uuid("request_id"),
  },
  (table) => [
    unique("hl_runs_user_day_run_unique").on(table.userId, table.day, table.runNumber),
    unique("hl_runs_request_unique").on(table.userId, table.requestId),
    check("hl_runs_run_number", sql`${table.runNumber} BETWEEN 1 AND 3`),
  ],
);

export const hlPredictions = pgTable(
  "hl_predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => hlRuns.id),
    position: integer("position").notNull(),
    ticker: text("ticker").notNull(),
    referenceTicker: text("reference_ticker").notNull(),
    asset: jsonb("asset").$type<Asset>().notNull(),
    offeredAt: instant("offered_at").notNull(),
    direction: text("direction", { enum: ["up", "down"] }),
    lockedAt: instant("locked_at"),
    scheduledOpenAt: instant("scheduled_open_at"),
    state: text("state", {
      enum: ["offered", "waiting_open", "waiting_start", "pending", "won", "lost", "equal", "void"],
    })
      .default("offered")
      .notNull(),
    startPrice: numeric("start_price"),
    startTakenAt: instant("start_taken_at"),
    targetAt: instant("target_at"),
    endPrice: numeric("end_price"),
    endTakenAt: instant("end_taken_at"),
    settledAt: instant("settled_at"),
  },
  (table) => [
    unique("hl_predictions_position_unique").on(table.runId, table.position),
    index("hl_predictions_pending_idx").on(table.settledAt, table.lockedAt),
    uniqueIndex("hl_predictions_one_pending")
      .on(table.runId)
      .where(sql`${table.settledAt} IS NULL`),
    check(
      "hl_predictions_direction",
      sql`${table.direction} IS NULL OR ${table.direction} IN ('up', 'down')`,
    ),
    check(
      "hl_predictions_state",
      sql`${table.state} IN ('offered', 'waiting_open', 'waiting_start', 'pending', 'won', 'lost', 'equal', 'void')`,
    ),
    check("hl_predictions_lock", sql`(${table.direction} IS NULL) = (${table.lockedAt} IS NULL)`),
    check(
      "hl_predictions_start",
      sql`(${table.startPrice} IS NULL) = (${table.startTakenAt} IS NULL)`,
    ),
    check("hl_predictions_end", sql`(${table.endPrice} IS NULL) = (${table.endTakenAt} IS NULL)`),
  ],
);

/** Observed halt onsets survive restarts and price retention. */
export const tickerHalts = pgTable(
  "ticker_halts",
  {
    ticker: text("ticker").notNull(),
    takenAt: instant("taken_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ticker, table.takenAt] })],
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
    tradable: boolean("tradable"),
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
  oracleState: tickerState("oracle_state"),
  oracleReason: text("oracle_reason"),
  nextChangeAt: instant("next_change_at"),
  tradingPeriod: text("trading_period"),
  tradingHalted: boolean("trading_halted"),
  periodChangeAt: instant("period_change_at"),
  lastClosedAt: instant("last_closed_at"),
  lastSession: jsonb("last_session").$type<LastSessionSnapshot>(),
  lastOpenedAt: instant("last_opened_at"),
  updatedAt: instant("updated_at").defaultNow().notNull(),
});

export const gameControls = pgTable(
  "game_controls",
  {
    game: text("game", { enum: ["checkin", "quiz", "higher_lower"] }).primaryKey(),
    paused: boolean("paused").default(false).notNull(),
    reason: text("reason").default("").notNull(),
    updatedAt: instant("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("game_controls_game", sql`${table.game} IN ('checkin', 'quiz', 'higher_lower')`),
  ],
);

/** Manual override is independent of the oracle's current health result. */
export const tickerControls = pgTable("ticker_controls", {
  ticker: text("ticker").primaryKey(),
  paused: boolean("paused").default(false).notNull(),
  reason: text("reason").default("").notNull(),
  updatedAt: instant("updated_at").defaultNow().notNull(),
});

export const seasons = pgTable(
  "seasons",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at"),
  },
  (table) => [
    unique("seasons_start_unique").on(table.startsAt),
    check("seasons_dates", sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
  ],
);

export const rewardControl = pgTable(
  "reward_control",
  {
    id: integer("id").primaryKey(),
  },
  (t) => [check("reward_control_singleton", sql`${t.id} = 1`)],
);
export const rewardDestinations = pgTable("reward_destinations", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  bybitUid: text("bybit_uid").notNull().default(""),
  mantleAddress: text("mantle_address").notNull().default(""),
  changedAt: instant("changed_at").notNull(),
});
export const rewardDestinationHistory = pgTable(
  "reward_destination_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    actor: text("actor").notNull(),
    oldValues: jsonb("old_values").$type<{ bybitUid: string; mantleAddress: string }>().notNull(),
    newValues: jsonb("new_values").$type<{ bybitUid: string; mantleAddress: string }>().notNull(),
    changedAt: instant("changed_at").notNull(),
  },
  (t) => [
    index("reward_history_user_idx").on(t.userId, t.changedAt),
    check("reward_history_actor", sql`${t.actor} IN ('player','staff')`),
  ],
);
export const rewardLocks = pgTable("reward_locks", {
  seasonId: text("season_id")
    .primaryKey()
    .references(() => seasons.id),
  locked: boolean("locked").notNull().default(false),
  updatedAt: instant("updated_at").notNull(),
});
export const rewardPrizes = pgTable(
  "reward_prizes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id),
    rankFrom: integer("rank_from").notNull(),
    rankTo: integer("rank_to").notNull(),
    description: text("description").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [check("reward_prize_ranks", sql`${t.rankFrom} > 0 AND ${t.rankTo} >= ${t.rankFrom}`)],
);
export const rewardSnapshots = pgTable(
  "reward_snapshots",
  {
    seasonId: text("season_id")
      .primaryKey()
      .references(() => seasons.id),
    seasonName: text("season_name").notNull(),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    topN: integer("top_n").notNull(),
    createdAt: instant("created_at").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [check("reward_snapshot_top", sql`${t.topN} > 0`)],
);
export type RewardIdentity = { platform: "discord" | "telegram"; platformUserId: string };
export const rewardEntries = pgTable(
  "reward_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => rewardSnapshots.seasonId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rank: integer("rank").notNull(),
    points: bigint("points", { mode: "number" }).notNull(),
    displayName: text("display_name").notNull(),
    identities: jsonb("identities").$type<RewardIdentity[]>().notNull(),
    eligibility: text("eligibility").notNull().default("review_required"),
    prizeDescription: text("prize_description").notNull(),
  },
  (t) => [
    unique("reward_entry_rank").on(t.seasonId, t.rank),
    unique("reward_entry_user").on(t.seasonId, t.userId),
    check("reward_entry_positive_rank", sql`${t.rank} > 0`),
  ],
);
export const rewardEvents = pgTable(
  "reward_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => rewardEntries.id),
    version: integer("version").notNull(),
    status: text("status").$type<"pending" | "approved" | "delivered" | "void">().notNull(),
    note: text("note").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    unique("reward_event_version").on(t.entryId, t.version),
    check("reward_event_status", sql`${t.status} IN ('pending','approved','delivered','void')`),
    check("reward_event_version_positive", sql`${t.version} >= 0`),
  ],
);

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

export const flagNotes = pgTable(
  "flag_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => flags.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    note: text("note").notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (table) => [index("flag_notes_flag_idx").on(table.flagId, table.createdAt)],
);

/** Serializes bank edits/imports with the first frozen daily selection. */
export const quizBankControl = pgTable(
  "quiz_bank_control",
  {
    id: integer("id").primaryKey(),
  },
  (table) => [check("quiz_bank_control_singleton", sql`${table.id} = 1`)],
);

export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id),
    reason: text("reason").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
    ipHash: text("ip_hash"),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("admin_actions_created_idx").on(table.createdAt, table.id),
    index("admin_actions_actor_idx").on(table.adminId, table.createdAt),
  ],
);

export const staff = pgTable("staff", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  role: staffRole("role").notNull(),
  grantedBy: uuid("granted_by")
    .notNull()
    .references(() => users.id),
  grantedAt: instant("granted_at").defaultNow().notNull(),
  revokedAt: instant("revoked_at"),
});

// A permanent singleton serializes bootstrap and last-owner checks across API instances.
export const adminControl = pgTable(
  "admin_control",
  {
    id: integer("id").primaryKey(),
    bootstrappedAt: instant("bootstrapped_at"),
  },
  (table) => [check("admin_control_singleton", sql`${table.id} = 1`)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    revokedAt: instant("revoked_at"),
  },
  (table) => [index("admin_sessions_user_idx").on(table.userId)],
);

export const adminOauthStates = pgTable("admin_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  expiresAt: instant("expires_at").notNull(),
});
