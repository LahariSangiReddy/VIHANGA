import assert from "node:assert/strict";
import { evaluateSpendPolicy } from "@agent-spend/policy";
const policy = { id: "p", agentId: "a", maxPerTransactionMicros: 200_000, dailyLimitMicros: 350_000, monthlyLimitMicros: 800_000, autoApproveBelowMicros: 10_000, allowedCategories: ["weather", "data"] };
const run = (amountMicros: number, category = "weather") => evaluateSpendPolicy({ agentId: "a", amountMicros, service: "demo", category }, { policy, dailySpentMicros: 0, monthlySpentMicros: 0, remainingBudgetMicros: 1_000_000 });
assert.equal(run(5_000).decision, "APPROVED");
assert.equal(run(20_000).decision, "REQUIRES_APPROVAL");
assert.equal(run(500_000).decision, "BLOCKED");
assert.equal(run(5_000, "research").decision, "BLOCKED");
console.log("Policy evaluator: 4 checks passed");
