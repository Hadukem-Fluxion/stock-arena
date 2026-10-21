import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, createLocalDatabase } from "./client.js";
import { createTestDatabase } from "./test-helpers.js";
import {
  adminActions,
  checkins,
  flags,
  hlRuns,
  identities,
  pointsLedger,
  priceSnapshots,
  quizAttempts,
  quizQuestions,
  referrals,
  tickerStatus,
  users,
} from "./schema.js";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  connection = await createTestDatabase();
}, 30_000);

afterAll(async () => {
  await connection?.close();
});

async function player() {
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: "Test Player" })
    .returning();
  if (!user) throw new Error("Missing test player");
  return user;
}

/** Drizzle retains the original Postgres error as its cause. */
async function rejectsWithCode(query: PromiseLike<unknown>, code: string) {
  try {
    await query;
  } catch (error) {
    let cause: unknown = error;
    while (cause instanceof Error && "cause" in cause && cause.cause) cause = cause.cause;
    expect(cause).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected Postgres error ${code}`);
}

describe("migrations and typed client", () => {
  it("creates missing local directories and preserves data after reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stock-arena-db-"));
    if (!resolve(directory).startsWith(join(resolve(tmpdir()), "stock-arena-db-"))) {
      throw new Error("Unexpected test directory");
    }
    const dataDir = join(directory, "nested", "pglite");
    try {
      const first = createLocalDatabase(dataDir);
      try {
        await first.migrate();
        await first.db.insert(users).values({ displayName: "Persistent Player" });
      } finally {
        await first.close();
      }
      const second = createLocalDatabase(dataDir);
      try {
        await second.migrate();
        expect(await second.db.select({ name: users.displayName }).from(users)).toEqual([
          { name: "Persistent Player" },
        ]);
      } finally {
        await second.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("applies from empty and can run again without losing data", async () => {
    const user = await player();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.status).toBe("active");
    await connection.migrate();
    const result = await connection.db.select().from(users).where(eq(users.id, user.id));
    expect(result).toEqual([user]);
    const tables = await connection.db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "admin_actions",
      "admin_control",
      "admin_oauth_states",
      "admin_sessions",
      "checkins",
      "flags",
      "hl_predictions",
      "hl_rounds",
      "hl_runs",
      "identities",
      "points_ledger",
      "price_snapshots",
      "quiz_attempts",
      "quiz_daily_sets",
      "quiz_questions",
      "referrals",
      "staff",
      "ticker_halts",
      "ticker_status",
      "users",
    ]);
  });

  it("selects PGlite without DATABASE_URL and Postgres with a URL", async () => {
    const local = createDatabase({ databaseUrl: "", dataDir: "memory://" });
    try {
      expect(local.kind).toBe("pglite");
      await local.migrate();
    } finally {
      await local.close();
    }
    const postgres = createDatabase({
      databaseUrl: "postgresql://localhost/driver_selection_only",
    });
    try {
      expect(postgres.kind).toBe("postgres");
    } finally {
      await postgres.close();
    }
  }, 30_000);

  it("stores instants as timestamptz and game days as date", async () => {
    const columns = await connection.db.execute<{ column_name: string; data_type: string }>(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name IN ('created_at', 'updated_at', 'taken_at', 'ended_at',
          'qualified_at', 'platform_created_at', 'day', 'scheduled_day', 'started_at'))
    `);
    for (const column of columns.rows) {
      expect(column.data_type).toBe(
        column.column_name === "started_at"
          ? "ARRAY"
          : ["day", "scheduled_day"].includes(column.column_name)
            ? "date"
            : "timestamp with time zone",
      );
    }
  });

  it("preserves decimal prices, bigint block numbers and timestamp offsets", async () => {
    const takenAt = new Date("2026-10-15T00:30:00-03:00");
    const snapshot = {
      ticker: "AAPL",
      priceUsd: "344.500000000000000001",
      blockNumber: 9007199254740993n,
      takenAt,
    };
    const [stored] = await connection.db.insert(priceSnapshots).values(snapshot).returning();
    expect(stored).toEqual({ ...snapshot, source: "fluxion_pool", tradable: null });
    await connection.db
      .insert(tickerStatus)
      .values({ ticker: "AAPL", state: "paused", reason: "stale" });
  });
});

describe("daily action uniqueness", () => {
  it("rejects a second check-in for the same user and day, but allows another day or user", async () => {
    const user = await player();
    const another = await player();
    const checkin = { userId: user.id, day: "2026-10-15", streak: 1 };
    await connection.db.insert(checkins).values(checkin);
    await rejectsWithCode(connection.db.insert(checkins).values(checkin), "23505");
    await connection.db.insert(checkins).values([
      { ...checkin, day: "2026-10-16", streak: 2 },
      { ...checkin, userId: another.id },
    ]);
  });

  it("rejects duplicate quiz attempts and preserves per-question start times", async () => {
    const user = await player();
    const attempt = {
      userId: user.id,
      day: "2026-10-15",
      questionIds: [randomUUID()],
      answers: [0],
      startedAt: [new Date("2026-10-15T10:00:00Z")],
      score: 0,
    };
    const [stored] = await connection.db.insert(quizAttempts).values(attempt).returning();
    expect(stored).toEqual(attempt);
    await rejectsWithCode(connection.db.insert(quizAttempts).values(attempt), "23505");
  });

  it("allows runs 1..3 and rejects a duplicate run", async () => {
    const user = await player();
    const run = { userId: user.id, day: "2026-10-15", runNumber: 1 };
    await connection.db
      .insert(hlRuns)
      .values([run, { ...run, runNumber: 2 }, { ...run, runNumber: 3 }]);
    await rejectsWithCode(connection.db.insert(hlRuns).values(run), "23505");
  });

  it.each([0, 4])("rejects run_number %i", async (runNumber) => {
    const user = await player();
    await rejectsWithCode(
      connection.db.insert(hlRuns).values({ userId: user.id, day: "2026-10-15", runNumber }),
      "23514",
    );
  });
});

describe("identity and referral constraints", () => {
  it("rejects the same platform account for a second user, while allowing the other platform", async () => {
    const user = await player();
    const another = await player();
    const identity = { userId: user.id, platform: "discord" as const, platformUserId: "123456" };
    await connection.db.insert(identities).values(identity);
    await rejectsWithCode(
      connection.db.insert(identities).values({ ...identity, userId: another.id }),
      "23505",
    );
    await connection.db.insert(identities).values({ ...identity, platform: "telegram" });
  });

  it("allows only one inviter per invitee", async () => {
    const inviter = await player();
    const invitee = await player();
    const anotherInviter = await player();
    await connection.db.insert(referrals).values({ inviterId: inviter.id, inviteeId: invitee.id });
    await rejectsWithCode(
      connection.db
        .insert(referrals)
        .values({ inviterId: anotherInviter.id, inviteeId: invitee.id }),
      "23505",
    );
  });

  it("rejects self-invites", async () => {
    const user = await player();
    await rejectsWithCode(
      connection.db.insert(referrals).values({ inviterId: user.id, inviteeId: user.id }),
      "23514",
    );
  });

  it("rejects references to missing users", async () => {
    await rejectsWithCode(
      connection.db.insert(checkins).values({ userId: randomUUID(), day: "2026-10-15", streak: 1 }),
      "23503",
    );
  });
});

describe("quiz question constraints", () => {
  it("accepts four options and boundary answer indices", async () => {
    for (const answerIndex of [0, 3]) {
      await connection.db.insert(quizQuestions).values({
        prompt: "Test question",
        options: ["A", "B", "C", "D"],
        answerIndex,
        topic: "test",
      });
    }
  });

  it.each(["[]", '["A","B","C"]', '["A","B","C","D","E"]', "{}", "null"])(
    "rejects malformed options %s through SQL",
    async (options) => {
      await rejectsWithCode(
        connection.db.execute(sql`
      INSERT INTO quiz_questions (prompt, options, answer_index, topic)
      VALUES ('Test question', ${options}::jsonb, 0, 'test')
    `),
        "23514",
      );
    },
  );

  it.each([-1, 4])("rejects answer_index %i", async (answerIndex) => {
    await rejectsWithCode(
      connection.db.insert(quizQuestions).values({
        prompt: "Test question",
        options: ["A", "B", "C", "D"],
        answerIndex,
        topic: "test",
      }),
      "23514",
    );
  });
});

describe("append-only points ledger", () => {
  it("rejects UPDATE, DELETE and TRUNCATE, leaving the award unchanged", async () => {
    const user = await player();
    const [award] = await connection.db
      .insert(pointsLedger)
      .values({ userId: user.id, amount: 10, reason: "checkin", refId: "2026-10-15" })
      .returning();
    await rejectsWithCode(
      connection.db
        .update(pointsLedger)
        .set({ amount: 999 })
        .where(eq(pointsLedger.userId, user.id)),
      "55000",
    );
    await rejectsWithCode(
      connection.db.delete(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      "55000",
    );
    await rejectsWithCode(connection.db.execute(sql`TRUNCATE points_ledger`), "55000");
    expect(
      await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
    ).toEqual([award]);
  });

  it("rejects duplicate awards and allows a negative admin_adjustment correction", async () => {
    const user = await player();
    const award = { userId: user.id, amount: 10, reason: "checkin", refId: "2026-10-15" };
    await connection.db.insert(pointsLedger).values(award);
    await rejectsWithCode(connection.db.insert(pointsLedger).values(award), "23505");
    await connection.db
      .insert(pointsLedger)
      .values({ ...award, amount: -10, reason: "admin_adjustment", refId: randomUUID() });
    const [balance] = await connection.db
      .select({ amount: sql<string>`sum(${pointsLedger.amount})` })
      .from(pointsLedger)
      .where(eq(pointsLedger.userId, user.id));
    expect(Number(balance?.amount)).toBe(0);
  });

  it("rolls back an action and its award together", async () => {
    const user = await player();
    await expect(
      connection.db.transaction(async (tx) => {
        await tx.insert(checkins).values({ userId: user.id, day: "2026-10-15", streak: 1 });
        await tx
          .insert(pointsLedger)
          .values({ userId: user.id, amount: 10, reason: "checkin", refId: "2026-10-15" });
        throw new Error("Abort test action");
      }),
    ).rejects.toThrow("Abort test action");
    expect(await connection.db.select().from(checkins).where(eq(checkins.userId, user.id))).toEqual(
      [],
    );
    expect(
      await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
    ).toEqual([]);
  });

  it("records moderation and admin audit rows", async () => {
    const admin = await player();
    const target = await player();
    const [flag] = await connection.db
      .insert(flags)
      .values({ userId: target.id, raisedBy: admin.id, note: "Test flag" })
      .returning();
    expect(flag?.state).toBe("open");
    await connection.db
      .insert(adminActions)
      .values({ adminId: admin.id, targetUserId: target.id, action: "flag", reason: "Test flag" });
  });
});
