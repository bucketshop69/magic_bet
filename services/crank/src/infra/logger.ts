import pino from "pino";

export function createLogger(level: pino.LevelWithSilent) {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
