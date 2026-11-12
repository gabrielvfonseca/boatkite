/**
 * Structured JSON logger with secret masking.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_PATTERNS = [
  /boat_[a-zA-Z0-9]+/g,
  /bk_[a-zA-Z0-9]+/g,
  /BUILDKITE_AGENT_TOKEN=[^\s]+/g,
  /Bearer [a-zA-Z0-9_\-\.]+/g,
  /sk-[a-zA-Z0-9]+/g,
  /ghp_[a-zA-Z0-9]+/g,
];

function maskSecrets(obj: unknown): unknown {
  if (typeof obj === "string") {
    let masked = obj;
    for (const pattern of SECRET_PATTERNS) {
      masked = masked.replace(pattern, "***REDACTED***");
    }
    return masked;
  }
  if (Array.isArray(obj)) {
    return obj.map(maskSecrets);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/token|secret|key|password|credential/i.test(key)) {
        result[key] = "***REDACTED***";
      } else {
        result[key] = maskSecrets(value);
      }
    }
    return result;
  }
  return obj;
}

function formatEntry(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
  };
  if (context) {
    Object.assign(entry, maskSecrets(context));
  }
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(formatEntry("debug", message, context));
    }
  },
  info(message: string, context?: Record<string, unknown>): void {
    console.log(formatEntry("info", message, context));
  },
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(formatEntry("warn", message, context));
  },
  error(message: string, context?: Record<string, unknown>): void {
    console.error(formatEntry("error", message, context));
  },
  masked(context: Record<string, unknown>): Record<string, unknown> {
    return maskSecrets(context) as Record<string, unknown>;
  },
};
