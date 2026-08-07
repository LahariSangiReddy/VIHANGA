import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { config } from "dotenv";
import { evaluateSpendPolicy, type SpendPolicy } from "@agent-spend/policy";
import { db, recordAudit } from "./db.js";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { toClientAvmSigner, ExactAvmScheme as ExactAvmClientScheme, ALGORAND_TESTNET_GENESIS_HASH, USDC_TESTNET_ASA_ID } from "@x402/avm";
import { ExactAvmScheme as ExactAvmServerScheme } from "@x402/avm/exact/server";
import { ed25519SigningKeyFromWrappedSecret, type WrappedEd25519Seed } from "@algorandfoundation/algokit-utils/crypto";
import { seedFromMnemonic } from "@algorandfoundation/algokit-utils/algo25";

config();
const avmAddress = process.env.AVM_ADDRESS;
const facilitatorUrl = process.env.FACILITATOR_URL;
// GoPlausible advertises the full Algorand TestNet genesis-hash CAIP-2 form in /supported.
const algorandTestnetNetwork = `algorand:${ALGORAND_TESTNET_GENESIS_HASH}`;
if (!avmAddress || !facilitatorUrl) throw new Error("Missing required server configuration: AVM_ADDRESS and FACILITATOR_URL.");
const x402Resource = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
  .register(algorandTestnetNetwork, new ExactAvmServerScheme());
const demoRoutes: RoutesConfig = {
  "GET /demo/weather": { accepts: [{ scheme: "exact", price: "$0.005", network: algorandTestnetNetwork, payTo: avmAddress, extra: { asset: USDC_TESTNET_ASA_ID } }], description: "Local weather data", mimeType: "application/json" },
  "GET /demo/data": { accepts: [{ scheme: "exact", price: "$0.020", network: algorandTestnetNetwork, payTo: avmAddress, extra: { asset: USDC_TESTNET_ASA_ID } }], description: "Local data API", mimeType: "application/json" },
  "GET /demo/inference": { accepts: [{ scheme: "exact", price: "$0.100", network: algorandTestnetNetwork, payTo: avmAddress, extra: { asset: USDC_TESTNET_ASA_ID } }], description: "Local AI inference API", mimeType: "application/json" },
  "GET /demo/research": { accepts: [{ scheme: "exact", price: "$0.500", network: algorandTestnetNetwork, payTo: avmAddress, extra: { asset: USDC_TESTNET_ASA_ID } }], description: "Local premium research API", mimeType: "application/json" }
};
const app = new Hono();
app.use("/api/*", cors());
app.use(paymentMiddleware(demoRoutes, x402Resource));
const money = (micros: number) => Number((micros / 1_000_000).toFixed(6));
const id = () => `req_${crypto.randomUUID().slice(0, 8)}`;

async function x402SecretKeyFromMnemonic(mnemonic: string): Promise<string> {
  const seed = seedFromMnemonic(mnemonic);
  const seedCopy = new Uint8Array(seed);
  const wrappedSeed: WrappedEd25519Seed = { unwrapEd25519Seed: async () => seed, wrapEd25519Seed: async () => {} };
  const wrappedSecret = await ed25519SigningKeyFromWrappedSecret(wrappedSeed);
  return Buffer.concat([Buffer.from(seedCopy), Buffer.from(wrappedSecret.ed25519Pubkey)]).toString("base64");
}

function policyFor(agentId: string) {
  const row = db.prepare("SELECT * FROM policies WHERE agent_id = ?").get(agentId) as any;
  if (!row) return null;
  return { id: row.id, agentId: row.agent_id, maxPerTransactionMicros: row.max_transaction_micros, dailyLimitMicros: row.daily_limit_micros, monthlyLimitMicros: row.monthly_limit_micros, autoApproveBelowMicros: row.auto_approve_micros, allowedCategories: JSON.parse(row.allowed_categories) } satisfies SpendPolicy;
}
function committed(agentId: string) {
  const row = db.prepare("SELECT COALESCE(SUM(amount_micros), 0) as spent FROM payment_requests WHERE agent_id = ? AND status = 'APPROVED'").get(agentId) as { spent: number };
  return row.spent;
}
app.get("/api/dashboard", (c) => {
  const agent = db.prepare("SELECT * FROM agents WHERE id = 'agent-atlas'").get() as any;
  const spent = committed(agent.id);
  const statuses = db.prepare("SELECT decision, COUNT(*) as count FROM payment_requests GROUP BY decision").all() as any[];
  const countFor = (decision: string) => statuses.find(s => s.decision === decision)?.count ?? 0;
  const requests = db.prepare("SELECT * FROM payment_requests ORDER BY created_at DESC LIMIT 12").all().map((r: any) => ({ ...r, amount: money(r.amount_micros) }));
  return c.json({ agent: { id: agent.id, name: agent.name, status: agent.status }, budget: money(agent.budget_micros), spent: money(spent), remaining: money(agent.budget_micros - spent), approved: countFor("APPROVED"), blocked: countFor("BLOCKED"), pending: countFor("REQUIRES_APPROVAL"), requests });
});
app.get("/api/agents", c => c.json(db.prepare("SELECT id,name,wallet_address,status,budget_micros FROM agents").all()));
app.get("/api/policies/:agentId", c => c.json(policyFor(c.req.param("agentId"))));
app.get("/api/audit", c => c.json(db.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT 100").all()));
app.get("/api/requests", c => c.json(db.prepare("SELECT * FROM payment_requests ORDER BY created_at DESC").all()));
app.get("/demo/weather", c => c.json({ city: "Bengaluru", condition: "clear", temperatureC: 28, source: "local-x402-demo" }));
app.get("/demo/data", c => c.json({ records: 42, dataset: "agent-spend-sample", source: "local-x402-demo" }));
app.get("/demo/inference", c => c.json({ result: "Policy-first agents reduce ungoverned spend.", model: "local-demo", source: "local-x402-demo" }));
app.get("/demo/research", c => c.json({ report: "Premium local research response", citations: 3, source: "local-x402-demo" }));

const requestInput = z.object({ agentId: z.string(), service: z.string().min(1), category: z.string().min(1), amount: z.number().positive() });
app.post("/api/payment-requests", async c => {
  const input = requestInput.parse(await c.req.json());
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as any;
  if (!agent || agent.status !== "ACTIVE") return c.json({ error: "Agent is not active." }, 400);
  const policy = policyFor(input.agentId)!;
  const spent = committed(input.agentId);
  const result = evaluateSpendPolicy({ ...input, amountMicros: Math.round(input.amount * 1_000_000) }, { policy, dailySpentMicros: spent, monthlySpentMicros: spent, remainingBudgetMicros: agent.budget_micros - spent });
  const requestId = id(); const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO payment_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(requestId, input.agentId, input.service, input.category, Math.round(input.amount * 1_000_000), result.decision, result.reason, result.policyId, result.decision, "NOT_ATTEMPTED", "algorand:testnet", null, createdAt);
  recordAudit(requestId, "POLICY_EVALUATED", `${result.decision}: ${result.reason}`);
  return c.json({ id: requestId, ...result, amount: input.amount, status: result.decision, x402Status: "NOT_ATTEMPTED" }, 201);
});
const servicePath: Record<string, string> = { "Weather API": "/demo/weather", "Data API": "/demo/data", "AI inference API": "/demo/inference", "Premium research API": "/demo/research" };
async function executePayment(requestId: string, origin: string) {
  const request = db.prepare("SELECT * FROM payment_requests WHERE id = ?").get(requestId) as any;
  if (!request) return { status: 404, body: { error: "Request not found." } };
  if (request.decision === "BLOCKED") {
    recordAudit(requestId, "PAYMENT_ATTEMPT_DENIED", "Blocked policy decision prevented any x402 request.");
    return { status: 403, body: { error: "Blocked by policy. No x402 request was attempted.", x402Status: "NOT_ATTEMPTED" } };
  }
  if (request.status !== "APPROVED") {
    recordAudit(requestId, "PAYMENT_ATTEMPT_DENIED", "Request requires human approval before x402 payment.");
    return { status: 409, body: { error: "Human approval is required before payment.", x402Status: "NOT_ATTEMPTED" } };
  }
  const path = servicePath[request.service];
  if (!path) return { status: 400, body: { error: "No local demo service is configured for this request." } };
  const mnemonic = process.env.AVM_MNEMONIC;
  if (!mnemonic) return { status: 503, body: { error: "Server payer configuration is missing." } };
  try {
    const signer = toClientAvmSigner(await x402SecretKeyFromMnemonic(mnemonic));
    const client = new x402Client().register(algorandTestnetNetwork, new ExactAvmClientScheme(signer));
    const paidFetch = wrapFetchWithPayment(fetch, client);
    db.prepare("UPDATE payment_requests SET x402_status = ? WHERE id = ?").run("PAYMENT_ATTEMPTED", requestId);
    recordAudit(requestId, "X402_PAYMENT_ATTEMPTED", `Policy-approved request sent to ${path}.`);
    const response = await paidFetch(`${origin}${path}`, { method: "GET" });
    const settlement = new x402HTTPClient(client).getPaymentSettleResponse(name => response.headers.get(name));
    if (!response.ok || !settlement?.success || !settlement.transaction) {
      db.prepare("UPDATE payment_requests SET x402_status = ? WHERE id = ?").run("PAYMENT_FAILED", requestId);
      recordAudit(requestId, "X402_PAYMENT_FAILED", `Protected service returned HTTP ${response.status}; no settled transaction was recorded.`);
      return { status: 502, body: { id: requestId, x402Status: "PAYMENT_FAILED", httpStatus: response.status } };
    }
    const data = await response.json();
    db.prepare("UPDATE payment_requests SET x402_status = ?, transaction_id = ? WHERE id = ?").run("SETTLED", settlement.transaction, requestId);
    recordAudit(requestId, "ALGORAND_PAYMENT_SETTLED", `Algorand TestNet transaction ${settlement.transaction} settled by x402 facilitator.`);
    return { status: 200, body: { id: requestId, x402Status: "SETTLED", transactionId: settlement.transaction, network: settlement.network, serviceResponse: data } };
  } catch (error) {
    db.prepare("UPDATE payment_requests SET x402_status = ? WHERE id = ?").run("PAYMENT_FAILED", requestId);
    recordAudit(requestId, "X402_PAYMENT_FAILED", "Payment client failed before a settled transaction was returned.");
    return { status: 502, body: { id: requestId, x402Status: "PAYMENT_FAILED", error: error instanceof Error ? error.message : "Unknown x402 error" } };
  }
}

app.post("/api/payment-requests/:id/approve", async c => {
  const requestId = c.req.param("id"); const row = db.prepare("SELECT * FROM payment_requests WHERE id = ?").get(requestId) as any;
  if (!row) return c.json({ error: "Request not found" }, 404);
  if (row.decision !== "REQUIRES_APPROVAL") return c.json({ error: "Only pending requests can be approved." }, 400);
  db.prepare("UPDATE payment_requests SET decision = 'APPROVED', status = 'APPROVED' WHERE id = ?").run(requestId);
  recordAudit(requestId, "HUMAN_APPROVED", "Approval granted; executing the x402 payment stage.");
  const result = await executePayment(requestId, new URL(c.req.url).origin);
  return c.json(result.body, result.status as any);
});

app.post("/api/payment-requests/:id/execute", async c => {
  const result = await executePayment(c.req.param("id"), new URL(c.req.url).origin);
  return c.json(result.body, result.status as any);
});

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) }, info => console.log(`Policy API ready on http://localhost:${info.port}`));
