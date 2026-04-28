import IORedis from "ioredis";

const LOG_PREFIX = "[REDIS]";
  
const createRedisConnection = (): IORedis => {
  const redisUrl = process.env.REDIS_URL;

  const opts: import("ioredis").RedisOptions = {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy: (times: number) => {
      if (times > 10) {
        console.error(
          `${LOG_PREFIX} Max Redis reconnection attempts (10) exceeded`,
        );
        return null; // Stop retrying
      }
      const delay = Math.min(times * 500, 5000);
      console.warn(
        `${LOG_PREFIX} Reconnecting to Redis (attempt ${times}, delay ${delay}ms)`,
      );
      return delay;
    },
    lazyConnect: false,
  };

  let connection: IORedis;

  if (redisUrl) {
    connection = new IORedis(redisUrl, opts);
  } else {
    const host = process.env.REDIS_HOST || "127.0.0.1";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    connection = new IORedis({ host, port, password, ...opts });
  }

  connection.on("connect", () => {
    console.log(`${LOG_PREFIX} Connected to Redis`);
  });

  connection.on("error", (err) => {
    console.error(`${LOG_PREFIX} Redis error:`, err.message);
  });

  connection.on("close", () => {
    console.warn(`${LOG_PREFIX} Redis connection closed`);
  });

  return connection;
};

/**
 * Shared Redis connection singleton for direct key operations
 * (locks, caching, transaction ID bridging).
 *
 * BullMQ creates its own connections internally — do NOT share this with Queue/Worker.
 */
let _sharedConnection: IORedis | null = null;

export const getRedisConnection = (): IORedis => {
  if (!_sharedConnection) {
    _sharedConnection = createRedisConnection();
  }
  return _sharedConnection;
};

/**
 * Create a NEW Redis connection for BullMQ Queue/Worker.
 * BullMQ requires its own dedicated connections (one per Queue, one per Worker).
 * These must NOT be shared with application-level Redis operations.
 */
export const createBullMQConnection = (): IORedis => {
  return createRedisConnection();
};

/**
 * Gracefully close all Redis connections.
 * Called during server shutdown.
 */
export const closeRedisConnections = async (): Promise<void> => {
  if (_sharedConnection) {
    await _sharedConnection.quit().catch(() => {});
    _sharedConnection = null;
    console.log(`${LOG_PREFIX} Shared Redis connection closed`);
  }
};
