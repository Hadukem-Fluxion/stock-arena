import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createLocalDatabase,
  users,
  identities,
  hlPredictions,
  hlRuns,
  pointsLedger,
  priceSnapshots,
  tickerStatus,
  tickerHalts,
} from "@stock-arena/db";
import { ASSETS } from "@stock-arena/game-core";
import type { AssetCatalog, PredictionView } from "@stock-arena/game-core";
import { buildServer } from "./server.js";
import { createSessions } from "./auth/session.js";
import { settlePredictions } from "../../worker/src/predictions.js";

const connection = createLocalDatabase();
const secret = "synthetic-prediction-test-session-secret-48-bytes";
let now = new Date("2026-10-20T12:00:00Z");
beforeAll(async () => {
  await connection.migrate();
}, 30_000);
beforeEach(async () => {
  now = new Date("2026-10-20T12:00:00Z");
  await connection.db.delete(priceSnapshots);
  await connection.db.delete(tickerStatus);
  await connection.db.delete(tickerHalts);
});
afterAll(async () => {
  await connection.close();
});
async function setup(count = 3) {
  const catalog: AssetCatalog = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `TEST_${i}`,
      { ...ASSETS.AAPL, name: `Synthetic ${i}`, symbol: `TEST_${i}`, referenceTicker: `REF_${i}` },
    ]),
  );
  const [user] = await connection.db
    .insert(users)
    .values({ displayName: "Prediction player" })
    .returning();
  const identity = { platform: "discord" as const, platformUserId: user!.id };
  await connection.db.insert(identities).values({ ...identity, userId: user!.id });
  const app = buildServer({
    logger: false,
    auth: { database: connection, env: { SESSION_SECRET: secret }, now: () => now },
    higherLower: { catalog, choose: () => 0 },
  });
  await connection.db
    .insert(tickerStatus)
    .values(
      Object.values(catalog).map((asset) => ({
        ticker: asset.referenceTicker,
        state: "live" as const,
        tradingPeriod: "market",
        tradingHalted: false,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  await connection.db.insert(priceSnapshots).values(
    Object.values(catalog).map((asset) => ({
      ticker: asset.referenceTicker,
      source: "xstocks" as const,
      priceUsd: "100",
      takenAt: now,
      tradable: true,
    })),
  );
  const send = async (action = "read", payload: unknown = {}) => {
    const session = await createSessions(secret, () => now).issue({ ...user!, identity });
    return app.inject({
      method: action === "read" ? "GET" : "POST",
      url: action === "read" ? "/api/hl" : `/api/hl/${action}`,
      headers: { authorization: `Bearer ${session.token}` },
      ...(action === "read" ? {} : { payload: payload as Record<string, unknown> }),
    });
  };
  const start = async (requestId = randomUUID()) =>
    (await send("start", { requestId })).json<PredictionView>();
  const pick = async (view: PredictionView, direction = "up") => {
    const run = view.runs.find((run) => run.round?.state === "offered")!;
    return send("pick", { runId: run.id, roundId: run.round!.id, direction });
  };
  return { app, user: user!, catalog, send, start, pick };
}
async function quote(
  at: Date,
  priceUsd: string,
  tradable = true,
  source: "xstocks" | "fluxion_pool" = "xstocks",
) {
  await connection.db
    .insert(priceSnapshots)
    .values({ ticker: "REF_0", priceUsd, takenAt: at, source, tradable });
}
async function result(view: PredictionView, startPrice = "100", endPrice = "101") {
  const round = view.runs[0]!.round!;
  const startAt = new Date(Date.parse(round.lockedAt!) + 15_000),
    endAt = new Date(startAt.getTime() + 900_000);
  await quote(startAt, startPrice);
  now = startAt;
  await settlePredictions(connection, now);
  await quote(endAt, endPrice);
  now = endAt;
  await settlePredictions(connection, now);
}
describe("T26 prediction API and worker", () => {
  describe.each(["read", "next", "pick"] as const)("%s offer recovery", (action) => {
    it.each(["manual", "divergence", "halt", "stale"])(
      "replaces an unlocked %s stock without transferring the pick or consuming the run",
      async (reason) => {
        const { app, start, send, user } = await setup();
        try {
          const original = await start();
          const run = original.runs[0]!;
          const offered = run.round!;
          if (reason === "stale") {
            await connection.db
              .update(priceSnapshots)
              .set({ takenAt: new Date(now.getTime() - 121_000) })
              .where(eq(priceSnapshots.ticker, "REF_0"));
          } else {
            await connection.db
              .update(tickerStatus)
              .set({
                state: "paused",
                reason: reason === "halt" ? "closed" : reason,
                tradingHalted: reason === "halt",
              })
              .where(eq(tickerStatus.ticker, "REF_0"));
          }
          const payload =
            action === "read"
              ? {}
              : action === "next"
                ? { runId: run.id }
                : { runId: run.id, roundId: offered.id, direction: "up" };
          const response = await send(action, payload);
          expect(response.statusCode).toBe(200);
          const view = response.json<PredictionView>();
          expect(view.runsUsed).toBe(1);
          expect(view.runs).toHaveLength(1);
          expect(view.runs[0]).toMatchObject({
            id: run.id,
            correctCount: 0,
            score: 0,
            endedAt: null,
            expiresAt: run.expiresAt,
            round: { ticker: "TEST_1", state: "offered", direction: null, lockedAt: null },
          });
          const rounds = await connection.db
            .select()
            .from(hlPredictions)
            .where(eq(hlPredictions.runId, run.id));
          expect(rounds).toHaveLength(2);
          expect(rounds.find((round) => round.id === offered.id)).toMatchObject({
            position: 0,
            state: "void",
            lockedAt: null,
            settledAt: now,
          });
          expect(rounds.find((round) => round.id !== offered.id)).toMatchObject({
            position: 1,
            state: "offered",
            lockedAt: null,
          });
          const [storedRun] = await connection.db
            .select()
            .from(hlRuns)
            .where(eq(hlRuns.id, run.id));
          expect(storedRun!.lastSettledAt).toBeNull();
          expect(
            await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
          ).toHaveLength(0);
          const again = (await send()).json<PredictionView>();
          expect(again.runs[0]!.round!.id).toBe(view.runs[0]!.round!.id);
          expect(
            (await send("pick", { runId: run.id, roundId: offered.id, direction: "up" }))
              .statusCode,
          ).toBe(409);
          const picked = (
            await send("pick", {
              runId: run.id,
              roundId: view.runs[0]!.round!.id,
              direction: "down",
            })
          ).json<PredictionView>();
          expect(picked.runs[0]!.round).toMatchObject({
            state: "waiting_start",
            ticker: "TEST_1",
            direction: "down",
          });
        } finally {
          await app.close();
        }
      },
    );
    it("returns HL_UNAVAILABLE without changing anything when no replacement exists, then recovers", async () => {
      const { app, start, send, user } = await setup(1);
      try {
        const initial = await start();
        const run = initial.runs[0]!;
        const beforeRun = await connection.db.select().from(hlRuns).where(eq(hlRuns.id, run.id));
        const beforeRounds = await connection.db
          .select()
          .from(hlPredictions)
          .where(eq(hlPredictions.runId, run.id));
        await connection.db.update(tickerStatus).set({ state: "paused", reason: "divergence" });
        const payload =
          action === "read"
            ? {}
            : action === "next"
              ? { runId: run.id }
              : { runId: run.id, roundId: run.round!.id, direction: "up" };
        const response = await send(action, payload);
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: { code: "HL_UNAVAILABLE" } });
        expect(await connection.db.select().from(hlRuns).where(eq(hlRuns.id, run.id))).toEqual(
          beforeRun,
        );
        expect(
          await connection.db.select().from(hlPredictions).where(eq(hlPredictions.runId, run.id)),
        ).toEqual(beforeRounds);
        expect(
          await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
        ).toHaveLength(0);
        await connection.db.update(tickerStatus).set({ state: "live", reason: null });
        const recovered = (await send()).json<PredictionView>();
        expect(recovered.runs[0]!.round!.id).toBe(run.round!.id);
        expect(recovered.runsUsed).toBe(1);
      } finally {
        await app.close();
      }
    });
  });
  it.each([3, 30])(
    "serves one random catalog stock with %s assets and no precomputed answer",
    async (count) => {
      const { app, start, pick, user } = await setup(count);
      try {
        const view = await start();
        expect(view.runs[0]!.round!.ticker).toBe("TEST_0");
        expect(view.runs[0]!.round!.startPrice).toBeNull();
        const reply = await pick(view);
        expect(reply.statusCode).toBe(200);
        expect(reply.json<PredictionView>().runs[0]!.round!.state).toBe("waiting_start");
        expect(
          await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
        ).toHaveLength(0);
      } finally {
        await app.close();
      }
    },
  );
  it("never replaces or unlocks an already locked prediction when its ticker becomes unavailable", async () => {
    const { app, start, pick, send } = await setup();
    try {
      const locked = (await pick(await start())).json<PredictionView>();
      const run = locked.runs[0]!;
      await connection.db
        .update(tickerStatus)
        .set({ state: "paused", reason: "closed", tradingHalted: true });
      await send("next", { runId: run.id });
      await send("pick", { runId: run.id, roundId: run.round!.id, direction: "down" });
      const view = (await send()).json<PredictionView>();
      expect(view.runs[0]!.round).toEqual(run.round);
      expect(
        await connection.db.select().from(hlPredictions).where(eq(hlPredictions.runId, run.id)),
      ).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
  it.each([
    ["up", "101", "won", 5],
    ["down", "99", "won", 5],
    ["up", "99", "lost", 0],
    ["down", "101", "lost", 0],
    ["up", "100.000", "equal", 0],
  ] as const)("settles %s at %s as %s", async (direction, end, state, points) => {
    const { app, start, pick, send } = await setup();
    try {
      const view = (await pick(await start(), direction)).json<PredictionView>();
      await result(view, "100", end);
      const final = (await send()).json<PredictionView>().runs[0]!;
      expect(final.round!.state).toBe(state);
      expect(final.score).toBe(points);
      expect(!!final.endedAt).toBe(state === "lost");
    } finally {
      await app.close();
    }
  });
  it("starts strictly after lock, ignores pools and invalid samples, and takes the first end at 15min", async () => {
    const { app, start, pick, send } = await setup();
    try {
      const view = (await pick(await start())).json<PredictionView>();
      const lock = new Date(view.runs[0]!.round!.lockedAt!);
      await quote(lock, "999");
      await quote(new Date(lock.getTime() + 1_000), "999", true, "fluxion_pool");
      await quote(new Date(lock.getTime() + 2_000), "999", false);
      const startAt = new Date(lock.getTime() + 15_000);
      await quote(startAt, "100");
      await quote(new Date(startAt.getTime() + 1_000), "500");
      now = startAt;
      await settlePredictions(connection, now);
      let round = (await send()).json<PredictionView>().runs[0]!.round!;
      expect(round.startPrice).toBe("100");
      const target = new Date(round.targetAt!);
      await quote(new Date(target.getTime() - 1), "1");
      await quote(target, "101");
      await quote(new Date(target.getTime() + 1), "1");
      now = new Date(target.getTime() + 30_000);
      await settlePredictions(connection, now);
      round = (await send()).json<PredictionView>().runs[0]!.round!;
      expect(round.endPrice).toBe("101");
      expect(round.endTakenAt).toBe(target.toISOString());
    } finally {
      await app.close();
    }
  });
  it("starts three parallel runs, blocks the fourth, and preserves a single pending choice on retries", async () => {
    const { app, start, pick, send } = await setup();
    try {
      const requestId = randomUUID();
      await Promise.all([start(requestId), start(requestId)]);
      expect((await send()).json<PredictionView>().runs).toHaveLength(1);
      const first = (await pick((await send()).json<PredictionView>())).json<PredictionView>();
      const round = first.runs[0]!.round!;
      await send("pick", { runId: first.runs[0]!.id, roundId: round.id, direction: "down" });
      await send("next", { runId: first.runs[0]!.id });
      await start();
      const third = await start();
      expect(third.runs).toHaveLength(3);
      expect(third.runs.find((run) => run.id === first.runs[0]!.id)!.round!.direction).toBe("up");
      expect((await send("start", { requestId: randomUUID() })).statusCode).toBe(409);
      expect(
        await connection.db
          .select()
          .from(hlPredictions)
          .where(eq(hlPredictions.runId, first.runs[0]!.id)),
      ).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
  it("settles pending predictions over UTC rollover and enforces ten correct picks", async () => {
    const { app, start, pick, send, user } = await setup();
    try {
      now = new Date("2026-10-20T23:59:00Z");
      await connection.db.update(tickerStatus).set({ updatedAt: now });
      await quote(now, "100");
      let view = (await pick(await start())).json<PredictionView>();
      const id = view.runs[0]!.id;
      for (let i = 1; i <= 10; i++) {
        await result(view);
        const fresh = (await send()).json<PredictionView>();
        expect(fresh.runs.find((run) => run.id === id)!.correctCount).toBe(i);
        if (i < 10) {
          await connection.db.update(tickerStatus).set({ updatedAt: now });
          const next = (await send("next", { runId: id })).json<PredictionView>();
          view = (await pick(next)).json<PredictionView>();
        }
      }
      const final = (await send()).json<PredictionView>();
      expect(final.runsUsed).toBe(0);
      expect(final.runs[0]!.endedAt).not.toBeNull();
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(10);
    } finally {
      await app.close();
    }
  });
  it("keeps three pending runs across midnight, with one prediction each and no fourth active run", async () => {
    const { app, start, pick, send, user } = await setup();
    try {
      now = new Date("2026-10-20T23:59:00Z");
      await connection.db.update(tickerStatus).set({ updatedAt: now });
      await quote(now, "100");
      for (let i = 0; i < 3; i++) await pick(await start());
      const before = (await send()).json<PredictionView>();
      expect(before.runs.every((run) => run.round!.state === "waiting_start")).toBe(true);
      now = new Date("2026-10-21T00:00:00Z");
      await connection.db.update(tickerStatus).set({ updatedAt: now });
      await quote(now, "100");
      await settlePredictions(connection, now);
      expect((await send("start", { requestId: randomUUID() })).statusCode).toBe(409);
      const target = new Date(now.getTime() + 900_000);
      await quote(target, "999", false);
      await quote(new Date(target.getTime() + 15_000), "101");
      now = new Date(target.getTime() + 15_000);
      await settlePredictions(connection, now);
      const after = (await send()).json<PredictionView>();
      expect(after.runsUsed).toBe(0);
      expect(after.runs.every((run) => run.round!.state === "won")).toBe(true);
      expect(after.runs.every((run) => run.round!.endPrice === "101")).toBe(true);
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
  it("allows a closed-market pick, waits for confirmed reopening and tolerates a delayed opening", async () => {
    const { app, start, pick, send } = await setup();
    try {
      const scheduled = new Date(now.getTime() + 60_000),
        actual = new Date(scheduled.getTime() + 600_000);
      await connection.db.update(tickerStatus).set({
        state: "paused",
        reason: "closed",
        tradingPeriod: "closed",
        nextChangeAt: scheduled,
        periodChangeAt: scheduled,
      });
      const view = (await pick(await start())).json<PredictionView>();
      expect(view.runs[0]!.round!.state).toBe("waiting_open");
      now = scheduled;
      await quote(scheduled, "999");
      await settlePredictions(connection, now);
      expect((await send()).json<PredictionView>().runs[0]!.round!.startPrice).toBeNull();
      now = actual;
      await connection.db.update(tickerStatus).set({
        state: "live",
        reason: null,
        tradingPeriod: "market",
        lastOpenedAt: actual,
        updatedAt: now,
      });
      await quote(actual, "100");
      await settlePredictions(connection, now);
      now = new Date(actual.getTime() + 900_000);
      await quote(now, "101");
      await settlePredictions(connection, now);
      const round = (await send()).json<PredictionView>().runs[0]!.round!;
      expect(round.startTakenAt).toBe(actual.toISOString());
      expect(round.state).toBe("won");
    } finally {
      await app.close();
    }
  });
  it.each(["start", "end", "opening"])(
    "voids missing %s data after six hours without ending the run",
    async (phase) => {
      const { app, start, pick, send } = await setup();
      try {
        if (phase === "opening") {
          const opening = new Date(now.getTime() + 60_000);
          await connection.db.update(tickerStatus).set({
            state: "paused",
            reason: "closed",
            tradingPeriod: "closed",
            nextChangeAt: opening,
            periodChangeAt: opening,
          });
        }
        const view = (await pick(await start())).json<PredictionView>();
        const round = view.runs[0]!.round!;
        let deadline = new Date(Date.parse(round.scheduledOpenAt ?? round.lockedAt!) + 21_600_000);
        if (phase === "end") {
          const startAt = new Date(now.getTime() + 15_000);
          await quote(startAt, "100");
          now = startAt;
          await settlePredictions(connection, now);
          deadline = new Date(startAt.getTime() + 900_000 + 21_600_000);
          await quote(new Date(startAt.getTime() + 900_000 + 120_001), "101");
        }
        now = new Date(deadline.getTime() - 1);
        await settlePredictions(connection, now);
        expect((await send()).json<PredictionView>().runs[0]!.round!.settledAt).toBeNull();
        now = deadline;
        await settlePredictions(connection, now);
        const final = (await send()).json<PredictionView>().runs[0]!;
        expect(final.round!.state).toBe("void");
        expect(final.endedAt).toBeNull();
      } finally {
        await app.close();
      }
    },
  );
  it("records a mid-window halt across restart and voids even after recovery", async () => {
    const { app, start, pick, send } = await setup();
    try {
      const view = (await pick(await start())).json<PredictionView>();
      const at = new Date(now.getTime() + 15_000);
      await quote(at, "100");
      now = at;
      await settlePredictions(connection, now);
      await connection.db
        .insert(tickerHalts)
        .values({ ticker: "REF_0", takenAt: new Date(at.getTime() + 300_000) });
      now = new Date(at.getTime() + 900_000);
      await quote(now, "101");
      await settlePredictions(connection, now);
      expect((await send()).json<PredictionView>().runs[0]!.round!.state).toBe("void");
      expect(view.runs[0]!.round!.startPrice).toBeNull();
    } finally {
      await app.close();
    }
  });
  it("survives restart/retention, pays once under concurrent settlement and expires an idle run", async () => {
    const { app, start, pick, send, user } = await setup();
    try {
      const view = (await pick(await start())).json<PredictionView>();
      const at = new Date(now.getTime() + 15_000);
      await quote(at, "100");
      now = at;
      await settlePredictions(connection, now);
      await connection.db.delete(priceSnapshots);
      now = new Date(at.getTime() + 900_000);
      await quote(now, "101");
      await Promise.all([settlePredictions(connection, now), settlePredictions(connection, now)]);
      expect(
        await connection.db.select().from(pointsLedger).where(eq(pointsLedger.userId, user.id)),
      ).toHaveLength(1);
      now = new Date(now.getTime() + 86_400_000);
      await settlePredictions(connection, now);
      expect(
        (await connection.db.select().from(hlRuns).where(eq(hlRuns.id, view.runs[0]!.id)))[0]!
          .endedAt,
      ).not.toBeNull();
      expect((await send("next", { runId: view.runs[0]!.id })).statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
  it("rejects forged input, other users and unavailable tickers without consuming runs", async () => {
    const first = await setup();
    const second = await setup();
    try {
      const view = await first.start();
      expect(
        (
          await second.send("pick", {
            runId: view.runs[0]!.id,
            roundId: view.runs[0]!.round!.id,
            direction: "up",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await first.send("pick", {
            runId: view.runs[0]!.id,
            roundId: view.runs[0]!.round!.id,
            direction: "up",
            price: "1",
          })
        ).statusCode,
      ).toBe(400);
      await connection.db.update(tickerStatus).set({ tradingHalted: true });
      expect((await first.pick(view)).statusCode).toBe(409);
      expect((await second.send("start", { requestId: randomUUID() })).statusCode).toBe(409);
      expect((await second.send()).json<PredictionView>().runsUsed).toBe(0);
      expect((await first.app.inject({ method: "GET", url: "/api/hl" })).statusCode).toBe(401);
    } finally {
      await first.app.close();
      await second.app.close();
    }
  });
});
