export class GameControlError extends Error {
  readonly statusCode = 409;
  readonly code = "GAME_PAUSED";
}
