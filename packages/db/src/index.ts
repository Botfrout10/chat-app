import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export * from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pg: ReturnType<typeof postgres> | null = null;

export function getDb(url: string = process.env.DATABASE_URL ?? "postgresql://chat:chat@localhost:5432/chat") {
  if (_db) return _db;
  _pg = postgres(url, { max: 10 });
  _db = drizzle(_pg, { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;

export async function closeDb() {
  if (_pg) await _pg.end({ timeout: 5 });
  _pg = null;
  _db = null;
}
