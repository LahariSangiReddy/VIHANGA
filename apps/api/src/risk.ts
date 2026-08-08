import { db } from "./db.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskFactor = { name: string; impact: number; explanation: string };
export type RiskMetrics = { budgetUtilization: number; blockedRequests: number; approvalRequests: number; failedPayments: number; requestsLast24Hours: number };

export function scoreRisk(metrics: RiskMetrics): { score: number; level: RiskLevel; factors: RiskFactor[] } {
  const utilizationImpact = metrics.budgetUtilization >= 0.9 ? 35 : metrics.budgetUtilization >= 0.75 ? 25 : metrics.budgetUtilization >= 0.5 ? 12 : 0;
  const blockedImpact = Math.min(30, metrics.blockedRequests * 10);
  const approvalImpact = Math.min(15, metrics.approvalRequests * 5);
  const failedImpact = Math.min(30, metrics.failedPayments * 15);
  const velocityImpact = metrics.requestsLast24Hours >= 8 ? 15 : metrics.requestsLast24Hours >= 4 ? 8 : 0;
  const score = Math.max(0, Math.min(100, utilizationImpact + blockedImpact + approvalImpact + failedImpact + velocityImpact));
  const level: RiskLevel = score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return {
    score,
    level,
    factors: [
      { name: "Budget utilization", impact: utilizationImpact, explanation: utilizationImpact ? `${Math.round(metrics.budgetUtilization * 100)}% of the available budget is settled.` : "Settled spending remains below 50% of the available budget." },
      { name: "Policy violations", impact: blockedImpact, explanation: blockedImpact ? `${metrics.blockedRequests} blocked request${metrics.blockedRequests === 1 ? "" : "s"} in the last 7 days.` : "No blocked requests in the last 7 days." },
      { name: "Approval exposure", impact: approvalImpact, explanation: approvalImpact ? `${metrics.approvalRequests} request${metrics.approvalRequests === 1 ? "" : "s"} required human approval in the last 7 days.` : "No requests required human approval in the last 7 days." },
      { name: "Payment reliability", impact: failedImpact, explanation: failedImpact ? `${metrics.failedPayments} failed payment attempt${metrics.failedPayments === 1 ? "" : "s"} in the last 7 days.` : "No failed payment attempts in the last 7 days." },
      { name: "Request velocity", impact: velocityImpact, explanation: velocityImpact ? `${metrics.requestsLast24Hours} requests were created in the last 24 hours.` : "Request frequency is below the elevated-risk threshold." }
    ]
  };
}

export function calculateAgentRiskScore(agentId: string) {
  const agent = db.prepare("SELECT id, name, wallet_address, status, budget_micros FROM agents WHERE id = ?").get(agentId) as { id: string; name: string; wallet_address: string; status: string; budget_micros: number } | undefined;
  if (!agent) return null;
  const policy = db.prepare("SELECT * FROM policies WHERE agent_id = ?").get(agentId) as any;
  if (!policy) return null;
  const scalar = (sql: string, params: unknown[] = []) => (db.prepare(sql).get(...params) as { value: number }).value;
  const dailyUsed = scalar("SELECT COALESCE(SUM(amount_micros), 0) AS value FROM payment_requests WHERE agent_id = ? AND x402_status = 'SETTLED' AND created_at >= datetime('now', '-1 day')", [agentId]);
  const monthlyUsed = scalar("SELECT COALESCE(SUM(amount_micros), 0) AS value FROM payment_requests WHERE agent_id = ? AND x402_status = 'SETTLED' AND created_at >= datetime('now', '-30 days')", [agentId]);
  const blockedRequests = scalar("SELECT COUNT(*) AS value FROM payment_requests WHERE agent_id = ? AND decision = 'BLOCKED' AND created_at >= datetime('now', '-7 days')", [agentId]);
  const approvalRequests = scalar("SELECT COUNT(*) AS value FROM audit_events WHERE event_type = 'POLICY_EVALUATED' AND detail LIKE 'REQUIRES_APPROVAL:%' AND created_at >= datetime('now', '-7 days') AND request_id IN (SELECT id FROM payment_requests WHERE agent_id = ?)", [agentId]);
  const failedPayments = scalar("SELECT COUNT(*) AS value FROM payment_requests WHERE agent_id = ? AND x402_status = 'PAYMENT_FAILED' AND created_at >= datetime('now', '-7 days')", [agentId]);
  const requestsLast24Hours = scalar("SELECT COUNT(*) AS value FROM payment_requests WHERE agent_id = ? AND created_at >= datetime('now', '-1 day')", [agentId]);
  const metrics: RiskMetrics = { budgetUtilization: agent.budget_micros ? monthlyUsed / agent.budget_micros : 0, blockedRequests, approvalRequests, failedPayments, requestsLast24Hours };
  const risk = scoreRisk(metrics);
  const recentPayments = db.prepare("SELECT id, service, amount_micros, x402_status, transaction_id, created_at FROM payment_requests WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5").all(agentId);
  return {
    agent: { id: agent.id, name: agent.name, walletAddress: agent.wallet_address, status: agent.status },
    riskScore: risk.score,
    riskLevel: risk.level,
    factors: risk.factors,
    budget: {
      totalMicros: agent.budget_micros,
      remainingMicros: Math.max(0, agent.budget_micros - monthlyUsed),
      dailyLimitMicros: policy.daily_limit_micros,
      dailyUsedMicros: dailyUsed,
      dailyRemainingMicros: Math.max(0, policy.daily_limit_micros - dailyUsed),
      monthlyLimitMicros: policy.monthly_limit_micros,
      monthlyUsedMicros: monthlyUsed,
      monthlyRemainingMicros: Math.max(0, policy.monthly_limit_micros - monthlyUsed),
      allowedCategories: JSON.parse(policy.allowed_categories) as string[]
    },
    recentActivity: { blockedRequests, approvalRequests, failedPayments, requestsLast24Hours, payments: recentPayments }
  };
}
