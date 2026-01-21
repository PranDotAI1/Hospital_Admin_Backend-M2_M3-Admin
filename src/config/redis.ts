import { createClient } from "redis";
import { REDIS_LOGS, REDIS_EVENTS, PROCESS_EVENTS } from "../utils/constant";

type RedisClientType = ReturnType<typeof createClient>;

class RedisInterface {
  private static instance: RedisInterface;
  redisClient: RedisClientType;

  private constructor() {
    this.redisClient = createClient({
      url: process.env.REDIS_URL,
    });
    this.initializeListeners();
  }

  private initializeListeners() {
    this.redisClient.on(REDIS_EVENTS.ERROR, (err) => {
      console.error(`Redis error: ${err.message}`);
    });

    this.redisClient.on(REDIS_EVENTS.CONNECT, () => {
      console.info("Redis connecting...");
    });

    this.redisClient.on(REDIS_EVENTS.READY, () => {
      console.info("Redis ready");
    });

    this.redisClient.on(REDIS_EVENTS.RECONNECTING, () => {
      console.warn("Redis reconnecting...");
    });

    this.redisClient.on(REDIS_EVENTS.END, () => {
      console.warn("Redis connection closed");
    });
  }

  public async connect(): Promise<RedisClientType> {
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
    }
    return this.redisClient;
  }

  public async disconnect(): Promise<void> {
    if (this.redisClient.isOpen) {
      await this.redisClient.quit();
      console.info(REDIS_LOGS.DISCONNECTED);
    }
  }

  public async set(
    key: string,
    value: any,
    options?: { EX?: number; PX?: number },
  ): Promise<string | null> {
    await this.connect();
    const stringValue =
      typeof value === "object" ? JSON.stringify(value) : String(value);

    return this.redisClient.set(key, stringValue, options);
  }

  public async get<T = string>(
    key: string,
    parseJson = true,
  ): Promise<T | string | null> {
    await this.connect();
    const value = await this.redisClient.get(key);
    if (parseJson && value) {
      try {
        return JSON.parse(value) as T;
      } catch {
        return value;
      }
    }
    return value;
  }

  public async del(key: string): Promise<number> {
    await this.connect();
    return this.redisClient.del(key);
  }

  public async incr(key: string): Promise<number> {
    await this.connect();
    return this.redisClient.incr(key);
  }

  public async decr(key: string): Promise<number> {
    await this.connect();
    return this.redisClient.decr(key);
  }

  public async exists(key: string): Promise<boolean> {
    await this.connect();
    const result = await this.redisClient.exists(key);
    return result > 0;
  }

  public static getInstance(): RedisInterface {
    if (!RedisInterface.instance) {
      RedisInterface.instance = new RedisInterface();

      process.on(PROCESS_EVENTS.SIGINT, async () => {
        console.log("Redis shutting down (SIGINT)...");
        await RedisInterface.instance.disconnect();
        process.exit(0);
      });

      process.on(PROCESS_EVENTS.SIGTERM, async () => {
        console.log("Redis shutting down (SIGTERM)...");
        await RedisInterface.instance.disconnect();
        process.exit(0);
      });
    }
    return RedisInterface.instance;
  }
}

export default RedisInterface.getInstance();
