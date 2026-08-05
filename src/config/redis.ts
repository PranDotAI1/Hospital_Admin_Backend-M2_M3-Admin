import IORedis, { type RedisOptions } from "ioredis";

const LOG_PREFIX = "[REDIS]";

function parseRedisEnv(): RedisOptions {
  const url = process.env.REDIS_URL;

  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379", 10),
      password: parsed.password
        ? decodeURIComponent(parsed.password)
        : undefined,
      username:
        parsed.username && parsed.username !== "default"
          ? decodeURIComponent(parsed.username)
          : undefined,
      db:
        parsed.pathname?.length > 1
          ? parseInt(parsed.pathname.slice(1), 10)
          : 0,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

function baseOpts(overrides: Partial<RedisOptions> = {}): RedisOptions {
  return {
    ...parseRedisEnv(),
    keepAlive: 15_000,
    connectTimeout: 10_000,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy(times: number, error?: Error) {
      const name = this.connectionName || "Unknown";
      if (times > 20) {
        console.error(
          `${LOG_PREFIX} [${name}] Giving up after 20 reconnection attempts to ${this.host}:${this.port}. Check Redis connectivity. Error: ${error?.message}`,
        );
        return null;
      }
      const delay = Math.min(times * 500, 10_000);
      
      if (times >= 3 || error) {
        console.warn(
          `${LOG_PREFIX} [${name}] Reconnecting to ${this.host}:${this.port} (attempt ${times}/20, next retry in ${delay}ms). Error: ${error?.message || error || "None"}`,
        );
      }
      return delay;
    },

    ...overrides,
  };
}

export function getBullMQConnectionOpts(): RedisOptions {
  return baseOpts({
    maxRetriesPerRequest: null,
  });
}

let _appConnection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!_appConnection) {
    _appConnection = new IORedis(
      baseOpts({
        maxRetriesPerRequest: 3,
      }),
    );

    _appConnection.on("connect", () =>
      console.log(`${LOG_PREFIX} [APP] Connected`),
    );
    _appConnection.on("ready", () => console.log(`${LOG_PREFIX} [APP] Ready`));
    _appConnection.on("close", () =>
      console.warn(`${LOG_PREFIX} [APP] Connection closed`),
    );
    _appConnection.on("end", () =>
      console.error(`${LOG_PREFIX} [APP] Connection ended — no more retries`),
    );
    _appConnection.on("error", (err: Error) =>
      console.error(`${LOG_PREFIX} [APP] Error: ${err.message}`),
    );
  }
  return _appConnection;
}

export async function closeRedisConnections(): Promise<void> {
  if (_appConnection) {
    await _appConnection.quit().catch(() => {});
    _appConnection = null;
    console.log(`${LOG_PREFIX} App connection closed`);
  }
}
