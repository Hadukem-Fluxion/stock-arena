import { eq } from "drizzle-orm";
import type { DatabaseConnection } from "./client.js";
import { gameControls } from "./schema.js";

type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
export type ControlledGame = typeof gameControls.$inferSelect.game;
/** A pause cannot commit between the action's check and its award/limit insert. */
export async function gamePaused(tx: Transaction, game: ControlledGame) {
  const [control] = await tx
    .select()
    .from(gameControls)
    .where(eq(gameControls.game, game))
    .for("share");
  if (!control) throw new Error("Game control is not configured.");
  return control.paused;
}
