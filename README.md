# PolicyPay

## AI Agent Spend Governance with x402 + Algorand

PolicyPay is a spending governance layer for autonomous AI agents.

It allows AI agents to request paid APIs while enforcing spending limits,
service/category policies, human approval requirements, and risk controls.

Approved requests proceed through x402 for machine-to-machine payment,
with TestNet USDC settled on Algorand TestNet. Settlement transaction
details are recorded in the PolicyPay audit trail.

---

## 🚀 Features

- Policy-based AI spending control
- Daily and monthly spending limits
- Automatic approval for permitted requests
- Human-in-the-loop approval for sensitive requests
- Blocking of unauthorized requests before payment
- Deterministic Agent Risk Score
- Agent Passport with wallet, budget and activity information
- Real x402 payment integration
- TestNet USDC payments
- Real Algorand TestNet settlement
- Append-only audit trail
- Dashboard for spending, approvals, risk and settlement activity

---

## 🛠️ Tech Stack

### Frontend
- React
- TypeScript
- Vite
- CSS

### Backend
- Hono
- TypeScript
- SQLite
- Node.js

### Blockchain
- Algorand
- Algorand TestNet
- TestNet USDC
- algosdk

### Payment Protocol
- x402
- @x402/core
- @x402/hono
- @x402/fetch
- @x402/avm

---

## ⚙️ Setup

### Prerequisites

- Node.js
- npm
- Algorand TestNet account
- TestNet ALGO
- TestNet USDC
- x402 facilitator configuration

### 1. Clone the repository

```bash
git clone https://github.com/LahariSangiReddy/VIHANGA.git
cd VIHANGA
