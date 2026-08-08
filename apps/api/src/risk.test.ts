import assert from "node:assert/strict";
import { scoreRisk } from "./risk.js";

const normal = scoreRisk({ budgetUtilization: 0.2, blockedRequests: 0, approvalRequests: 0, failedPayments: 0, requestsLast24Hours: 1 });
assert.equal(normal.level, "LOW"); assert.equal(normal.score, 0);
const utilization = scoreRisk({ budgetUtilization: 0.9, blockedRequests: 0, approvalRequests: 0, failedPayments: 0, requestsLast24Hours: 0 });
assert.equal(utilization.score, 35); assert.equal(utilization.level, "MEDIUM");
const blocked = scoreRisk({ budgetUtilization: 0.1, blockedRequests: 3, approvalRequests: 0, failedPayments: 0, requestsLast24Hours: 0 });
assert.equal(blocked.score, 30); assert.equal(blocked.level, "MEDIUM");
const velocity = scoreRisk({ budgetUtilization: 0.1, blockedRequests: 0, approvalRequests: 0, failedPayments: 0, requestsLast24Hours: 8 });
assert.equal(velocity.score, 15); assert.equal(velocity.level, "LOW");
const combined = scoreRisk({ budgetUtilization: 0.95, blockedRequests: 3, approvalRequests: 2, failedPayments: 2, requestsLast24Hours: 9 });
assert.equal(combined.score, 100); assert.equal(combined.level, "CRITICAL");
for (const result of [normal, utilization, blocked, velocity, combined]) { assert.ok(result.score >= 0 && result.score <= 100); assert.ok(result.factors.length > 0); }
console.log("Agent risk scoring: 5 deterministic scenarios passed");
