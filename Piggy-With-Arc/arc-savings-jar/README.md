# Piggy With Arc 🐷

> Build savings goals together, one USDC top-up at a time.

Piggy With Arc is a professional, non-custodial, multi-jar savings application for Arc. A wallet may maintain up to ten simultaneous USDC jars, add funds gradually, receive irreversible gifts from other wallets, and use either a maturity date or an optional savings target to unlock principal.

The application preserves the protocol’s incentive system: penalty-funded reward sharing, a separately funded time-bonus pool, lifetime points, and Bronze/Silver/Gold/Platinum tiers.

## Features

- Up to **10 simultaneous jars per wallet**.
- Optional target on every jar; `0` means a traditional time-only jar.
- A configured target must be greater than the initial deposit.
- Add USDC bit by bit to a specific jar.
- Any wallet may contribute to another wallet’s active, still-locked jar.
- Third-party contributions are irreversible gifts; only the jar owner can withdraw.
- Reaching a target before maturity unlocks principal without the 10% penalty.
- The owner can instead wait for maturity to receive reward share, time bonus, and points.
- Traditional emergency break remains available before maturity while a target has not been reached.
- Reward pool, bonus pool, points, tier, and protocol accounting remain visible in the UI.
- Wallet-free walkthrough at `/demo`, including locked, matured, and target-reached states.
- Durable per-wallet activity ledger for jar creation, top-ups, gifts sent, gifts received, targets, withdrawals, emergency breaks, and bonus-pool funding.
- In-app notification when another wallet contributes USDC to the connected wallet’s jar.
- Accessible light/dark appearance toggle that follows the system preference on first visit and remembers the user’s choice.
- Bounded activity reads: the dashboard displays the latest 100 records while preserving a lifetime count on-chain.

## Withdrawal Rules

| Jar state | Owner action | Principal | Penalty rewards | Time bonus | Points |
|---|---|---:|---:|---:|---:|
| Matured | `withdrawJar(jarId)` | 100% | Paid | Paid, pool permitting | Awarded |
| Target reached before maturity | `withdrawJar(jarId)` | 100% | Not paid; redistributed | Not paid | Not awarded |
| Locked, target not reached | `breakJar(jarId)` | 90% | Forfeited | Not paid | Not awarded |
| Locked | Keep saving | Remains locked | Continues accruing | Continues accruing | Awarded only at maturity |

A target-complete jar cannot use `breakJar`; it already qualifies for penalty-free principal withdrawal.

## Incentive and Top-Up Accounting

### Penalty-funded reward sharing

An emergency break divides the 10% discipline fee between the protocol owner fee bucket and the active-saver reward pool. Rewards are allocated through `accRewardPerShare`.

When funds are added to a jar, the contract increases that jar’s `rewardDebt` by the new amount’s current accumulator baseline. New money therefore cannot claim rewards distributed before it arrived.

If a target-complete jar withdraws before maturity, its existing pending reward entitlement is redistributed to the remaining active deposits. If no active deposit remains, the amount moves from the reward bucket to the owner-fee bucket. This keeps the accounting buckets balanced.

### Time bonus and points

Top-ups must not receive credit for time served before they were deposited. Each jar therefore stores an amount-weighted deposit timestamp. Time bonus and points use that timestamp, while `createdAt` remains the original creation time and `unlockTime` never changes.

The time bonus is paid only at mature withdrawal and is capped by the funded `bonusPoolBalance`.

## Smart Contract API

Core writes:

```solidity
createJar(
    uint256 amount,
    uint256 lockDurationInSeconds,
    string jarName,
    uint256 targetAmount
) returns (uint256 jarId);

addToJar(address jarOwner, uint256 jarId, uint256 amount);
withdrawJar(uint256 jarId);
breakJar(uint256 jarId);
fundBonusPool(uint256 amount);
```

Activity is stored per wallet. A third-party contribution writes a sent record for the contributor and a received record for the jar owner, including the contributor address, jar ID, amount, and timestamp.

Important views:

```solidity
getJars(address user) returns (JarData[]);
getJar(address user, uint256 jarId) returns (JarData);
isTargetReached(address user, uint256 jarId) returns (bool);
canWithdraw(address user, uint256 jarId) returns (bool);
pendingReward(address user, uint256 jarId) returns (uint256);
previewBonus(address user, uint256 jarId) returns (uint256);
getAccountingSummary() returns (...);
getActivityCount(address user) returns (uint256);
getRecentActivities(address user, uint256 limit) returns (ActivityData[]);
```

`JarData` stores principal, maturity, creation time, reward debt, weighted deposit time, optional target, active status, and name.

## Contract Rules

- USDC uses **6 decimals**.
- Initial amount and every top-up must be greater than zero.
- Lock duration: **24 hours to 365 days**.
- Jar name: 1–48 bytes.
- Optional target: zero, or greater than the initial amount.
- Maximum active jars per wallet: 10.
- Contributions are accepted only while the destination jar is active and before maturity.
- Only the jar owner can withdraw or break that owner’s jar.
- Emergency break penalty: 10%.
- No proxy, upgrade path, or pause switch.
- Active deposits cannot be swept by the contract owner.

## Network Configuration

| Setting | Arc Mainnet |
|---|---|
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| USDC | `0x3600000000000000000000000000000000000000` |
| USDC decimals | `6` |

Arc Testnet (`5042002`) is also configured. Contract and USDC addresses have one source of truth in `config/contracts.ts`. The deployment-specific SavingsJar address can be replaced there or supplied through `NEXT_PUBLIC_SAVINGS_JAR_ADDRESS`.

> This revision changes contract storage and function signatures. It requires a fresh deployment and a new configured SavingsJar address.

## Technical Stack

- Solidity `^0.8.20`, compiled with solc `0.8.28`
- Next.js 14 App Router and React 18
- Strict TypeScript
- Tailwind CSS
- wagmi v2, viem v2, RainbowKit v2
- TanStack Query
- Arc Mainnet and Arc Testnet

## Repository Structure

```text
arc-savings-jar/
├── app/
│   ├── demo/page.tsx
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── BreakJarModal.tsx
│   ├── CreateJarForm.tsx
│   ├── FundBonusPoolCard.tsx
│   ├── FundJarModal.tsx
│   ├── JarDashboard.tsx
│   └── ...
├── config/
│   ├── abi/
│   ├── contracts.ts
│   └── wagmi.ts
├── contracts/SavingsJar.sol
├── hooks/
│   ├── useCountdown.ts
│   └── useSavingsJar.ts
├── lib/
├── scripts/
└── README.md
```

The repository root also contains `.evmtest/`, an in-memory EVM behavioral test harness. The activity suite verifies both sides of a gift, target completion, and withdrawal records.

## Local Development

Requirements: Node.js 20+, npm 10+, and an EVM wallet for live interaction.

```bash
git clone https://github.com/michaelo27/Arc-Saving-Jar.git
cd Arc-Saving-Jar/arc-savings-jar
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Use `http://localhost:3000/demo` for the wallet-free walkthrough.

Environment variables:

```dotenv
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_SAVINGS_JAR_ADDRESS=0x...
NEXT_PUBLIC_TARGET_NETWORK=mainnet
# Optional USDC override:
NEXT_PUBLIC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

## Compile, Test, and Validate

Compile Solidity and regenerate the typed ABI/artifact:

```bash
npm run compile
```

Run the contract behavioral suite from the repository root:

```bash
cd .evmtest
npm install
node verify.js
```

The suite covers targets, zero-target jars, multiple jars, public gifts, reward-debt baselines, weighted deposit time, target-complete withdrawal, reward redistribution, mature incentives, points, and the accounting invariant.

Front-end checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Deployment

Compile first, then deploy with a private key that has native USDC for Arc gas:

```bash
npm run compile
DEPLOYER_PRIVATE_KEY=0x... npm run deploy:testnet
DEPLOYER_PRIVATE_KEY=0x... npm run deploy:mainnet
```

After deployment, configure the new address and run the read-only verifier:

```bash
npm run verify -- --network testnet --jar 0x... --user 0x...
npm run verify -- --network mainnet --jar 0x... --user 0x...
```

## Security Notes

- Checks-Effects-Interactions and a non-reentrancy guard protect state-changing token flows.
- Safe ERC-20 wrappers support tokens returning `true` or no value.
- Contract accounting separates active principal, owner fees, reward pool, and bonus pool.
- `getAccountingSummary()` makes the bucket invariant independently verifiable.
- Public contributions never transfer withdrawal authority to the contributor.
- Users should verify the owner address and jar ID before making a gift.
- This repository is not a substitute for an independent production audit.

## License

MIT. See [LICENSE](./LICENSE).
