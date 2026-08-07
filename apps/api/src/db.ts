import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const databasePath = join(process.cwd(), "data", "policy-engine.db");
mkdirSync(dirname(databasePath), { recursive: true });
export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, wallet_address TEXT NOT NULL, status TEXT NOT NULL, budget_micros INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS policies (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, max_transaction_micros INTEGER NOT NULL, daily_limit_micros INTEGER NOT NULL, monthly_limit_micros INTEGER NOT NULL, auto_approve_micros INTEGER NOT NULL, allowed_categories TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_requests (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, service TEXT NOT NULL, category TEXT NOT NULL, amount_micros INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, policy_id TEXT NOT NULL, status TEXT NOT NULL, x402_status TEXT NOT NULL, network TEXT NOT NULL, transaction_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL, previous_hash TEXT, event_hash TEXT NOT NULL);
`);

const count = db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number };
if (!count.count) {
  db.prepare("INSERT INTO agents VALUES (?, ?, ?, ?, ?)").run("agent-atlas", "Atlas Research Agent", "DEMO_ALGORAND_WALLET", "ACTIVE", 1_000_000);
  db.prepare("INSERT INTO policies VALUES (?, ?, ?, ?, ?, ?, ?)").run("policy-atlas-v1", "agent-atlas", 200_000, 350_000, 800_000, 10_000, JSON.stringify(["weather", "data", "ai"]));
}

export function recordAudit(requestId: string, eventType: string, detail: string) {
  const previous = db.prepare("SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1").get() as { event_hash?: string } | undefined;
  const createdAt = new Date().toISOString();
  const previousHash = previous?.event_hash ?? "GENESIS";
  // Hashing keeps each link fixed-size. Encoding the full predecessor caused the
  // audit chain to grow exponentially and eventually block payment execution.
  const previousHashReference = previousHash === "GENESIS" ? previousHash : createHash("sha256").update(previousHash).digest("hex");
  const eventHash = createHash("sha256").update(`${previousHashReference}|${requestId}|${eventType}|${detail}|${createdAt}`).digest("hex");
  db.prepare("INSERT INTO audit_events (request_id,event_type,detail,created_at,previous_hash,event_hash) VALUES (?, ?, ?, ?, ?, ?)").run(requestId, eventType, detail, createdAt, previousHashReference, eventHash);
}
