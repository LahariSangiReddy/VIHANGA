import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Request = { id: string; service: string; category: string; amount: number; decision: string; status: string; reason: string; x402_status: string; transaction_id?: string | null; created_at: string };
type Dashboard = { agent: { id: string; name: string; status: string }; budget: number; spent: number; remaining: number; approved: number; blocked: number; pending: number; requests: Request[] };
const services = [
  { service: "Weather API", category: "weather", amount: 0.005, note: "Auto-approve policy" },
  { service: "Data API", category: "data", amount: 0.02, note: "Human approval policy" },
  { service: "Premium research API", category: "research", amount: 0.5, note: "Blocked by category policy" }
];
const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 3 : 2)}`;
const explorerUrl = (transactionId: string) => `https://testnet.explorer.perawallet.app/tx/${transactionId}/`;
const displayStatus = (value: string) => value === "REQUIRES_APPROVAL" ? "REQUIRES APPROVAL" : value.replace(/_/g, " ");
const statusClass = (value: string) => value.toLowerCase().replace(/_/g, "-");
function Badge({ value }: { value: string }) { return <span className={`badge ${statusClass(value)}`}>{displayStatus(value)}</span>; }
function TransactionLink({ transactionId }: { transactionId: string }) { return <a className="tx-link" href={explorerUrl(transactionId)} target="_blank" rel="noreferrer" title={transactionId}>{transactionId.slice(0, 10)}…{transactionId.slice(-6)} <span>↗</span></a>; }

function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [message, setMessage] = useState("Ready to evaluate agent spend.");
  const refresh = () => fetch("/api/dashboard").then(r => r.json()).then(setData);
  useEffect(() => { refresh(); }, []);
  const utilization = useMemo(() => data ? Math.min(100, (data.spent / data.budget) * 100) : 0, [data]);
  async function submit(s: typeof services[number]) {
    const r = await fetch("/api/payment-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: "agent-atlas", ...s }) });
    const result = await r.json();
    if (!r.ok) { setMessage(result.error ?? "Unable to create payment request."); return; }
    if (result.decision === "APPROVED") {
      setMessage("APPROVED · Entering the x402 payment stage…");
      const execution = await fetch(`/api/payment-requests/${result.id}/execute`, { method: "POST" });
      const settlement = await execution.json();
      setMessage(settlement.x402Status === "SETTLED"
        ? `SETTLED · Algorand transaction ${settlement.transactionId}`
        : `${settlement.x402Status ?? "PAYMENT FAILED"} · ${settlement.error ?? "The payment did not settle."}`);
    } else {
      setMessage(`${displayStatus(result.decision)} · ${result.reason}`);
    }
    refresh();
  }
  async function approve(id: string) {
    const r = await fetch(`/api/payment-requests/${id}/approve`, { method: "POST" }); const result = await r.json();
    setMessage(result.x402Status === "SETTLED"
      ? `APPROVED → SETTLED · Algorand transaction ${result.transactionId}`
      : result.error ?? `${result.x402Status ?? "PAYMENT FAILED"} · The payment did not settle.`);
    await refresh();
  }
  if (!data) return <main className="loading">Loading PolicyPay…</main>;
  const queued = data.requests.filter(r => r.status === "REQUIRES_APPROVAL");
  const settled = data.requests.filter(r => r.x402_status === "SETTLED");
  const decisionTotal = Math.max(1, data.approved + data.pending + data.blocked);
  return <main>
    <header className="hero"><div><p className="eyebrow">POLICYPAY</p><h1>PolicyPay</h1><p className="subtitle">AI Spend Governance with x402 & Algorand</p></div><div className="agent"><span className="dot" /><div><b>{data.agent.name}</b><small>Agent status · {data.agent.status}</small></div></div></header>
    <section className="cards">
      <Card label="Total budget" value={usd(data.budget)} detail="Monthly operating allowance" icon="◌" />
      <Card label="Amount spent" value={usd(data.spent)} detail={`${utilization.toFixed(1)}% of budget`} icon="↗" accent="teal" />
      <Card label="Remaining" value={usd(data.remaining)} detail="Available for approved actions" icon="◔" accent="blue" />
      <Card label="Policy outcomes" value={`${data.approved} / ${data.pending} / ${data.blocked}`} detail="approved · pending · blocked" icon="⌁" />
    </section>
    <section className="analytics">
      <div className="panel budget-panel"><div className="section-heading"><div><p className="section-kicker">BUDGET UTILIZATION</p><h2>Spend runway</h2></div><strong>{utilization.toFixed(1)}%</strong></div><div className="runway"><span style={{ width: `${utilization}%` }} /></div><div className="runway-labels"><span>{usd(data.spent)} committed</span><span>{usd(data.remaining)} remaining</span></div><p className="muted">Every spend is policy-evaluated before the payment client can reach a protected service.</p></div>
      <div className="panel decision-panel"><div className="section-heading"><div><p className="section-kicker">POLICY ACTIVITY</p><h2>Decision mix</h2></div><span className="period">ALL TIME</span></div><div className="decision-bars"><DecisionBar label="Approved" value={data.approved} total={decisionTotal} type="approved" /><DecisionBar label="Requires approval" value={data.pending} total={decisionTotal} type="requires-approval" /><DecisionBar label="Blocked" value={data.blocked} total={decisionTotal} type="blocked" /></div></div>
    </section>
    <section className="grid"><div className="panel simulator"><div className="section-heading"><div><p className="section-kicker">DEMO CONSOLE</p><h2>Simulate agent spend</h2></div><span className="network-chip">Algorand TestNet</span></div><p className="muted">The policy engine runs on the backend before any x402 payment request is made.</p>{services.map(s => <button className="service" key={s.service} onClick={() => submit(s)}><span className="service-icon">{s.category === "weather" ? "☼" : s.category === "data" ? "▦" : "◆"}</span><span><b>{s.service}</b><small>{s.category} · {s.note}</small></span><strong>{usd(s.amount)} <i>→</i></strong></button>)}<p className="notice"><span>●</span>{message}</p></div>
      <div className="panel queue-panel"><div className="section-heading"><div><p className="section-kicker">HUMAN REVIEW</p><h2>Approval queue</h2></div><span className="queue-count">{queued.length}</span></div>{queued.length ? queued.map(r => <div className="queue" key={r.id}><span><b>{r.service}</b><small>{usd(r.amount)} · {r.reason}</small></span><button onClick={() => approve(r.id)}>Approve</button></div>) : <div className="empty-state"><span>✓</span><p>No requests awaiting review.</p></div>}<div className="policy"><div><b>Active policy</b><span>Policy-atlas-v1 · enforced server-side</span></div><p>Auto ≤ $0.01 · Max $0.20 · Daily $0.35</p></div></div></section>
    <section className="panel activity"><div className="section-heading"><div><p className="section-kicker">AUDIT TRAIL</p><h2>Decision & payment activity</h2></div><div className="settlement-summary"><span className="settlement-dot" />{settled.length} settled on TestNet</div></div><div className="table-wrap"><table><thead><tr><th>Service request</th><th>Amount</th><th>Policy decision</th><th>x402 status</th><th>Algorand transaction</th><th>Time</th></tr></thead><tbody>{data.requests.length ? data.requests.map(r => <tr key={r.id}><td><b>{r.service}</b><small>{r.reason}</small></td><td className="amount">{usd(r.amount)}</td><td><Badge value={r.decision} /></td><td><Badge value={r.x402_status} /></td><td>{r.transaction_id ? <TransactionLink transactionId={r.transaction_id} /> : <span className="not-settled">—</span>}</td><td className="time">{new Date(r.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</td></tr>) : <tr><td colSpan={6} className="muted">No payment requests yet.</td></tr>}</tbody></table></div></section>
  </main>;
}
function Card({ label, value, detail, icon, accent = "" }: { label: string; value: string; detail: string; icon: string; accent?: string }) { return <div className={`card ${accent}`}><div className="card-top"><p>{label}</p><span>{icon}</span></div><strong>{value}</strong><small>{detail}</small></div>; }
function DecisionBar({ label, value, total, type }: { label: string; value: number; total: number; type: string }) { return <div className="decision-bar"><div><span className={`legend-dot ${type}`} />{label}<b>{value}</b></div><div className="bar-track"><span className={type} style={{ width: `${(value / total) * 100}%` }} /></div></div>; }
createRoot(document.getElementById("root")!).render(<App />);
