export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export function createLogger(scope: string): Logger {
  function log(level: "INFO" | "WARN" | "ERROR", message: string, fields?: Record<string, unknown>) {
    const payload = fields ? ` ${JSON.stringify(fields)}` : "";
    console.log(`[${level}] [${scope}] ${message}${payload}`);
  }

  return {
    info(message, fields) {
      log("INFO", message, fields);
    },
    warn(message, fields) {
      log("WARN", message, fields);
    },
    error(message, fields) {
      log("ERROR", message, fields);
    }
  };
}
