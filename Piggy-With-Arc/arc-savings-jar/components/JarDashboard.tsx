"use client";

import { useCallback, useEffect, useState } from "react";

import ActivityHistory from "@/components/ActivityHistory";
import BreakJarModal from "@/components/BreakJarModal";
import CountdownTimer from "@/components/CountdownTimer";
import CreateJarForm from "@/components/CreateJarForm";
import FundBonusPoolCard from "@/components/FundBonusPoolCard";
import FundJarModal from "@/components/FundJarModal";
import JarVisual from "@/components/JarVisual";
import StatusBadge from "@/components/StatusBadge";
import { EXPLORER_URL, SAVINGS_JAR_ADDRESS, USDC_ADDRESS } from "@/config/contracts";
import { ARC_TESTNET_ID, arcMainnet } from "@/config/wagmi";
import type { useSavingsJar } from "@/hooks/useSavingsJar";
import {
  explorerTxUrl,
  formatDuration,
  formatDurationApprox,
  formatUsd,
  penaltyOf,
  returnedAfterPenalty,
  truncateAddress,
} from "@/lib/format";

type Jar = ReturnType<typeof useSavingsJar>;

export interface JarDashboardProps {
  jar: Jar;
  /**
   * Rendered by /demo with mock data. Writes are intercepted so a reviewer can
   * click through the full UX without a wallet or a deployed contract.
   */
  demo?: boolean;
}

/**
 * Everything that happens after the wallet is connected. A wallet can hold
 * several jars, so a row of tabs (<JarTabs />) picks which one is on screen,
 * and "+ New jar" opens the create form at any time:
 *   STATE 2 - create form (no jar selected)  -> <CreateJarForm />
 *   STATE 3 - selected jar locked            -> jar visual + countdown + break flow
 *   STATE 4 - selected jar matured           -> congratulations + one-click withdraw
 */
export default function JarDashboard({ jar, demo = false }: JarDashboardProps) {
  const [breakOpen, setBreakOpen] = useState(false);

  const handleBreak = useCallback(async () => {
    if (demo) {
      console.log("[demo] breakJar simulated - 10% discipline fee would stay in the contract");
      setBreakOpen(false);
      return;
    }
    console.log("[JarDashboard] breakJar confirmed by user");
    const ok = await jar.breakJar();
    if (ok) setBreakOpen(false);
  }, [demo, jar]);

  const handleWithdraw = useCallback(async () => {
    if (demo) {
      console.log("[demo] withdrawJar simulated - the full deposit would return to the wallet");
      return;
    }
    console.log("[JarDashboard] withdrawJar requested");
    await jar.withdrawJar();
  }, [demo, jar]);

  /* ------------------------------------------------------------------------ */
  /*  STATE 4 - matured jar                                                   */
  /* ------------------------------------------------------------------------ */
  if (jar.isJarUnlocked) {
    const savedFor =
      jar.lockDurationSeconds > 0
        ? formatDurationApprox(jar.lockDurationSeconds)
        : "your full lock period";

    return (
      <Shell jar={jar}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card flex animate-fade-up flex-col items-center px-6 py-10 text-center">
            <p className="text-3xl">🎉</p>
            <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              Your Jar is Ready!
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              You saved <span className="font-semibold text-white">{formatUsd(jar.jarData.amount)}</span>{" "}
              USDC for <span className="font-semibold text-accent">{savedFor}</span>. Great
              discipline!
            </p>

            {jar.jarPendingReward > 0n || jar.jarPreviewBonus > 0n ? (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
                {jar.jarPendingReward > 0n ? (
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-medium text-accent">
                    +{formatUsd(jar.jarPendingReward)} reward share
                  </span>
                ) : null}
                {jar.jarPreviewBonus > 0n ? (
                  <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-medium text-gold">
                    +{formatUsd(jar.jarPreviewBonus)} time bonus
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-8">
              <JarVisual
                fillPercentage={100}
                amount={jar.jarData.amount}
                jarName={jar.jarData.jarName}
                isUnlocked
              />
            </div>

            <button type="button" onClick={handleWithdraw} disabled={jar.isLoading} className="btn-success mt-9 w-full max-w-sm !py-4 !text-base">
              {jar.tx.stage === "withdrawing" ? (
                <>
                  <Spinner /> Withdrawing...
                </>
              ) : jar.tx.stage === "withdrawn" ? (
                <>Withdrawn ✓</>
              ) : (
                <>
                  Withdraw{" "}
                  {formatUsd(jar.jarData.amount + jar.jarPendingReward + jar.jarPreviewBonus)} USDC
                </>
              )}
            </button>

            <div className="mt-4 flex w-full max-w-sm flex-col items-center gap-2">
              <StatusBadge
                status={badgeFor(jar.tx.stage, jar.tx.error)}
                label={jar.tx.message || jar.tx.error || undefined}
                hideWhenIdle={false}
              />
              {jar.txHash ? <TxLink hash={jar.txHash} /> : null}
              <p className="text-xs text-muted">
                {jar.jarPendingReward > 0n || jar.jarPreviewBonus > 0n
                  ? "Principal, reward share and time bonus all return in a single transaction. No fees."
                  : "The full deposit returns to your wallet in a single transaction. No fees."}
              </p>
            </div>
          </section>

          <Aside jar={jar} />
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------------------------------ */
  /*  TARGET REACHED EARLY - principal unlocked, incentives still pending     */
  /* ------------------------------------------------------------------------ */
  if (jar.isJarActive && jar.isTargetReached) {
    return (
      <Shell jar={jar}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card flex animate-fade-up flex-col items-center px-6 py-10 text-center">
            <p className="text-4xl">🎯</p>
            <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Savings target reached!</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
              This jar holds <span className="font-semibold text-white">{formatUsd(jar.jarData.amount)} USDC</span>, meeting its
              <span className="font-semibold text-accent"> {formatUsd(jar.jarData.targetAmount)} USDC</span> goal.
              You can withdraw principal now with no penalty, or wait for maturity to receive reward share, time bonus, and points.
            </p>
            <TargetProgress amount={jar.jarData.amount} target={jar.jarData.targetAmount} />
            <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/10 p-4 text-left text-xs leading-relaxed text-gold">
              Withdrawing before maturity pays principal only. The current {formatUsd(jar.jarPendingReward)} reward share is redistributed,
              and the projected {formatUsd(jar.jarPreviewBonus)} time bonus plus points are not paid. Waiting until maturity preserves these incentives.
            </div>
            <CountdownTimer unlockTimestamp={Number(jar.jarData.unlockTime)} className="mt-6 w-full max-w-md" />
            <button type="button" onClick={handleWithdraw} disabled={jar.isLoading} className="btn-success mt-7 w-full max-w-sm !py-4 !text-base">
              {jar.tx.stage === "withdrawing" ? <><Spinner /> Withdrawing principal...</> : `Withdraw ${formatUsd(jar.jarData.amount)} USDC penalty-free`}
            </button>
            <StatusBadge status={badgeFor(jar.tx.stage, jar.tx.error)} label={jar.tx.message || jar.tx.error || undefined} />
          </section>
          <Aside jar={jar} />
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------------------------------ */
  /*  STATE 3 - locked jar                                                    */
  /* ------------------------------------------------------------------------ */
  if (jar.isJarActive) {
    const amount = jar.jarData.amount;

    return (
      <Shell jar={jar}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card flex animate-fade-up flex-col items-center px-5 py-8 sm:px-8">
            <JarVisual
              fillPercentage={jar.progressPercent}
              amount={amount}
              jarName={jar.jarData.jarName}
              isUnlocked={false}
            />

            {jar.jarData.targetAmount > 0n ? (
              <TargetProgress amount={amount} target={jar.jarData.targetAmount} />
            ) : null}

            <CountdownTimer
              unlockTimestamp={Number(jar.jarData.unlockTime)}
              className="mt-8 w-full max-w-md"
            />

            <div className="mt-6 w-full max-w-md">
              <div className="mb-2 flex items-baseline justify-between text-xs">
                <span className="font-medium uppercase tracking-[0.14em] text-muted">
                  Time Elapsed
                </span>
                <span className="font-mono text-accent">{jar.progressPercent.toFixed(1)}%</span>
              </div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-navy-900"
                role="progressbar"
                aria-valuenow={Math.round(jar.progressPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Share of the lock period elapsed"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-dim via-accent to-accent transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(1.5, jar.progressPercent)}%` }}
                />
              </div>
              <p className="mt-3 text-center text-sm text-muted">
                Unlocks on:{" "}
                <span className="font-medium text-white">
                  {new Date(Number(jar.jarData.unlockTime) * 1000).toLocaleString("en-US", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                </span>
              </p>
            </div>

            {jar.jarPendingReward > 0n || jar.jarPreviewBonus > 0n ? (
              <p className="mt-4 max-w-md text-center text-xs text-muted">
                So far this jar has earned{" "}
                {jar.jarPendingReward > 0n ? (
                  <span className="font-mono text-accent">{formatUsd(jar.jarPendingReward)} reward</span>
                ) : null}
                {jar.jarPendingReward > 0n && jar.jarPreviewBonus > 0n ? " + " : null}
                {jar.jarPreviewBonus > 0n ? (
                  <span className="font-mono text-gold">{formatUsd(jar.jarPreviewBonus)} bonus</span>
                ) : null}
                . Break it early and you forfeit both - only a full, on-time withdrawal pays them out.
              </p>
            ) : null}

            <div className="mt-8 flex w-full max-w-md flex-col items-center gap-3">
              <StatusBadge
                status={badgeFor(jar.tx.stage, jar.tx.error)}
                label={jar.tx.message || jar.tx.error || undefined}
              />
              {jar.txHash ? <TxLink hash={jar.txHash} /> : null}

              <button
                type="button"
                onClick={() => {
                  console.log("[JarDashboard] opening break-jar confirmation");
                  setBreakOpen(true);
                }}
                disabled={jar.isLoading}
                className="btn-danger w-full"
              >
                🚨 Break Jar (10% Penalty)
              </button>
              <p className="text-center text-xs text-muted">
                Breaking early returns{" "}
                <span className="font-mono text-white">{formatUsd(returnedAfterPenalty(amount))}</span>{" "}
                and keeps{" "}
                <span className="font-mono text-gold">{formatUsd(penaltyOf(amount))}</span> in the
                contract as a discipline fee.
              </p>
            </div>
          </section>

          <Aside jar={jar} />
        </div>

        <BreakJarModal
          open={breakOpen}
          amount={amount}
          jarName={jar.jarData.jarName}
          onCancel={() => setBreakOpen(false)}
          onConfirm={handleBreak}
          busy={jar.isLoading}
          tx={jar.tx}
        />
      </Shell>
    );
  }

  /* ------------------------------------------------------------------------ */
  /*  STATE 2 - connected, no active jar                                      */
  /* ------------------------------------------------------------------------ */
  return (
    <Shell jar={jar}>
      <div className="flex w-full flex-col items-center gap-6">
        <CreateJarForm
          usdcBalance={jar.usdcBalance}
          allowance={jar.allowance}
          gasBalanceFormatted={jar.gasBalanceFormatted}
          tx={jar.tx}
          onApprove={jar.approveUSDC}
          onCreateJar={jar.createJar}
        />
        <Aside jar={jar} className="w-full max-w-2xl" />
      </div>
    </Shell>
  );
}

/* ========================================================================== */
/*  Shared chrome                                                             */
/* ========================================================================== */

function Shell({ jar, children }: { jar: Jar; children: React.ReactNode }) {
  const [fundMode, setFundMode] = useState<"selected" | "public" | null>(null);
  const [section, setSection] = useState<"overview" | "activity">("overview");
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-7 sm:px-6">
      <ContributionNotifier jar={jar} onViewActivity={() => setSection("activity")} />
      {jar.demoMode ? (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-center text-sm font-medium text-sky-800">
          Interactive demo — mock data only. No transaction will be broadcast.
        </div>
      ) : null}
      <Notices jar={jar} />

      <div className="mb-7 flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_20px_60px_-38px_rgba(8,47,73,0.45)] sm:flex-row sm:items-center">
        <nav className="flex gap-1" aria-label="Dashboard sections">
          <button type="button" onClick={() => setSection("overview")} className={`rounded-2xl px-5 py-3 text-sm font-semibold transition ${section === "overview" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>Overview</button>
          <button type="button" onClick={() => setSection("activity")} className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition ${section === "activity" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
            Activity
            {jar.activityCount > 0n ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${section === "activity" ? "bg-white/20 text-white" : "bg-sky-100 text-sky-700"}`}>{jar.activityCount.toString()}</span> : null}
          </button>
        </nav>
        {section === "overview" ? (
          <div className="flex flex-wrap gap-2 p-1">
            {jar.isJarActive && !jar.isJarUnlocked ? <button type="button" onClick={() => setFundMode("selected")} className="btn-primary !px-4 !py-2.5 !text-xs">Add USDC</button> : null}
            <button type="button" onClick={() => setFundMode("public")} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700">Gift a jar</button>
          </div>
        ) : null}
      </div>

      {section === "overview" ? (
        <>
          <JarTabs jar={jar} />
          {children}
        </>
      ) : (
        <ActivityHistory wallet={jar.address} activities={jar.activityHistory} totalCount={jar.activityCount} loading={jar.isActivityLoading} error={jar.isActivityError} />
      )}

      <FundJarModal
        open={fundMode !== null}
        contributor={jar.address}
        defaultOwner={fundMode === "selected" ? jar.address : undefined}
        defaultJarId={fundMode === "selected" ? (jar.selectedJarId ?? undefined) : undefined}
        defaultJar={fundMode === "selected" ? jar.jarData : undefined}
        usdcBalance={jar.usdcBalance}
        allowance={jar.allowance}
        tx={jar.tx}
        busy={jar.isLoading}
        onClose={() => setFundMode(null)}
        onApprove={jar.approveUSDC}
        onFund={jar.addToJar}
        onLookup={jar.getJarsByOwner}
      />
      <Footer />
    </div>
  );
}

function ContributionNotifier({ jar, onViewActivity }: { jar: Jar; onViewActivity: () => void }) {
  const [notice, setNotice] = useState<Jar["activityHistory"][number] | null>(null);

  useEffect(() => {
    if (!jar.address || jar.isActivityLoading || jar.demoMode) return;
    const incoming = [...jar.activityHistory]
      .reverse()
      .find((activity) => activity.activityType === 3 && activity.actor.toLowerCase() !== jar.address?.toLowerCase());
    if (!incoming) return;

    const key = `piggy-with-arc:last-incoming:${jar.contractAddress}:${jar.address}`;
    const signature = `${incoming.timestamp}:${incoming.jarId}:${incoming.actor}:${incoming.amount}`;
    const previous = window.localStorage.getItem(key);
    if (previous === null) {
      // Establish a baseline the first time this wallet uses this browser.
      window.localStorage.setItem(key, signature);
      return;
    }
    if (previous !== signature) {
      setNotice(incoming);
      window.localStorage.setItem(key, signature);
    }
  }, [jar.activityHistory, jar.address, jar.contractAddress, jar.demoMode, jar.isActivityLoading]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="fixed right-4 top-24 z-50 w-[calc(100%-2rem)] max-w-sm animate-fade-up rounded-2xl border border-emerald-200 bg-white p-4 text-slate-800 shadow-2xl" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">↓</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-950">USDC added to your jar</p>
          <p className="mt-1 text-sm text-slate-600"><span className="font-mono font-semibold text-emerald-700">{formatUsd(notice.amount)} USDC</span> was contributed by {truncateAddress(notice.actor)}.</p>
          <button type="button" onClick={() => { onViewActivity(); setNotice(null); }} className="mt-3 text-xs font-semibold text-sky-700 hover:text-sky-900">View activity →</button>
        </div>
        <button type="button" onClick={() => setNotice(null)} className="text-slate-400 hover:text-slate-700" aria-label="Dismiss notification">×</button>
      </div>
    </div>
  );
}

/**
 * One tab per active jar plus a "+ New jar" tab. Hidden until the wallet has at
 * least one jar (a first-time visitor just sees the create form).
 */
function JarTabs({ jar }: { jar: Jar }) {
  if (jar.jars.length === 0) return null;

  const creating = jar.selectedJarId === null;
  const tabBase = "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition disabled:opacity-60";
  const tabOn = "border-sky-500 bg-sky-600 text-white shadow-sm";
  const tabOff = "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700";

  return (
    <nav aria-label="Your jars" className="mb-6 flex flex-wrap items-center gap-2">
      {jar.jars.map((entry) => {
        const selected = entry.id === jar.selectedJarId;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => jar.selectJar(entry.id)}
            disabled={jar.isLoading}
            aria-pressed={selected}
            className={`${tabBase} ${selected ? tabOn : tabOff}`}
          >
            <span aria-hidden="true">{entry.isUnlocked ? "🔓" : entry.isTargetReached ? "🎯" : "🫙"}</span>
            <span className="max-w-[10rem] truncate font-medium">
              {entry.data.jarName || `Jar ${entry.id + 1}`}
            </span>
            <span className="font-mono text-xs opacity-80">{formatUsd(entry.data.amount)}</span>
          </button>
        );
      })}

      {jar.canCreateMore ? (
        <button
          type="button"
          onClick={() => jar.selectJar(null)}
          disabled={jar.isLoading}
          aria-pressed={creating}
          className={`${tabBase} border-dashed ${creating ? tabOn : tabOff}`}
        >
          <span aria-hidden="true">＋</span>
          <span className="font-medium">New jar</span>
        </button>
      ) : (
        <span className="px-2 text-xs text-muted">
          Jar limit reached ({jar.maxJars}/{jar.maxJars})
        </span>
      )}
    </nav>
  );
}

function Notices({ jar }: { jar: Jar }) {
  if (jar.demoMode) return null;

  if (jar.isWrongNetwork) {
    return (
      <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-gold/45 bg-gold/10 px-5 py-4 sm:flex-row sm:items-center">
        <p className="text-sm text-gold">
          Your wallet is on <span className="font-semibold">chain {jar.chainId}</span>. Arc Savings
          Jar lives on Arc Mainnet (5042).
        </p>
        <button type="button" onClick={jar.switchToArc} disabled={jar.isSwitchingChain} className="btn-gold !px-4 !py-2 !text-xs">
          {jar.isSwitchingChain ? "Switching..." : "Switch to Arc"}
        </button>
      </div>
    );
  }

  if (!jar.isContractDeployed) {
    return (
      <div className="mb-6 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4">
        <p className="text-sm font-semibold text-accent">Contract address not configured yet</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Paste your deployed <span className="font-mono text-white">SavingsJar</span> address into{" "}
          <span className="font-mono text-white">config/contracts.ts</span> (or set{" "}
          <span className="font-mono text-white">NEXT_PUBLIC_SAVINGS_JAR_ADDRESS</span> in{" "}
          <span className="font-mono text-white">.env.local</span>). Current value:{" "}
          <span className="font-mono text-white">{truncateAddress(SAVINGS_JAR_ADDRESS)}</span>.
        </p>
        <p className="mt-2 font-mono text-xs text-muted/80">
          npm run deploy:mainnet &nbsp;# or deploy:testnet for a dry run with faucet USDC
        </p>
      </div>
    );
  }

  if (jar.isJarError && jar.jarError) {
    return (
      <div className="mb-6 rounded-2xl border border-red-400/40 bg-red-500/10 px-5 py-4">
        <p className="text-sm font-semibold text-red-300">Could not read your jar</p>
        <p className="mt-1 text-sm text-red-200/80">{jar.jarError}</p>
        <button type="button" onClick={jar.refetchAll} className="btn-ghost mt-3 !px-3 !py-1.5 !text-xs">
          Retry
        </button>
      </div>
    );
  }

  return null;
}

function Aside({ jar, className = "" }: { jar: Jar; className?: string }) {
  const chainLabel = jar.chainId === ARC_TESTNET_ID ? "Arc Testnet" : arcMainnet.name;
  const explorerChainUrl = jar.chainId === ARC_TESTNET_ID ? "https://explorer.testnet.arc.io" : EXPLORER_URL;

  return (
    <aside className={`flex flex-col gap-4 ${className}`}>
      {/* ------------------------------------------------------------ wallet */}
      <div className="card p-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Your wallet</h3>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-sm text-white">
            <span className="h-5 w-5 rounded-full bg-gradient-to-br from-accent to-accent-dim" aria-hidden="true" />
            {truncateAddress(jar.address)}
          </span>
          <a
            href={`${explorerChainUrl}/address/${jar.address ?? ""}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-accent/80 underline-offset-4 hover:underline"
          >
            view
          </a>
        </div>

        <dl className="mt-4 space-y-2.5 text-sm">
          <StatRow label="USDC balance" value={`${jar.usdcBalanceFormatted} USDC`} loading={jar.isBalanceLoading} />
          <StatRow label="Gas (native USDC)" value={`${jar.gasBalanceFormatted} USDC`} />
          <StatRow label="Network" value={chainLabel} />
          {jar.jars.length > 0 ? (
            <>
              <StatRow label="Active jars" value={`${jar.jars.length} / ${jar.maxJars}`} />
              <StatRow label="Total locked" value={formatUsd(jar.totalLocked)} tone="accent" />
              {jar.totalPendingRewards > 0n ? (
                <StatRow label="Unclaimed reward share" value={formatUsd(jar.totalPendingRewards)} tone="accent" />
              ) : null}
            </>
          ) : null}
          {jar.isJarActive ? (
            <>
              <StatRow label="This jar" value={formatUsd(jar.jarData.amount)} tone="accent" />
              <StatRow
                label="Target"
                value={jar.jarData.targetAmount > 0n ? formatUsd(jar.jarData.targetAmount) : "Time-only"}
                tone={jar.isTargetReached ? "accent" : undefined}
              />
              <StatRow
                label="Lock length"
                value={jar.lockDurationSeconds > 0 ? formatDuration(jar.lockDurationSeconds) : "—"}
              />
              <StatRow
                label={jar.canWithdrawJar ? "Status" : "Time left"}
                value={jar.isJarUnlocked ? "Matured" : jar.isTargetReached ? "Target reached" : formatDurationApprox(jar.timeRemaining)}
                tone={jar.canWithdrawJar ? "gold" : undefined}
              />
            </>
          ) : null}
        </dl>
      </div>

      {/* ------------------------------------------------------------ rewards */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Your rewards
          </h3>
          <TierBadge tier={jar.tier} />
        </div>
        <dl className="mt-3 space-y-2.5 text-sm">
          <StatRow label="Points" value={jar.points.toLocaleString("en-US")} tone="accent" />
          <StatRow
            label="Bonus rate"
            value={`${(Number(jar.bonusAprBps) / 100).toFixed(2)}% / year`}
          />
          <StatRow label="Bonus pool available" value={`${jar.bonusPoolBalanceFormatted} USDC`} tone="gold" />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted/80">
          Points and bonus are earned by holding a jar to maturity - breaking early forfeits both.
          Points are 1 USDC held for 1 day; tiers are Bronze &rarr; Silver (1,000) &rarr; Gold
          (10,000) &rarr; Platinum (50,000).
        </p>

        {jar.isOwner ? (
          <div className="mt-4">
            <FundBonusPoolCard
              usdcBalance={jar.usdcBalance}
              allowance={jar.allowance}
              bonusPoolBalanceFormatted={jar.bonusPoolBalanceFormatted}
              bonusAprBps={jar.bonusAprBps}
              tx={jar.tx}
              onApprove={jar.approveUSDC}
              onFund={jar.fundBonusPool}
            />
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- protocol */}
      <div className="card p-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          On-chain transparency
        </h3>
        <dl className="mt-3 space-y-2.5 text-sm">
          <StatRow label="Discipline fees held" value={`${jar.penaltiesFormatted} USDC`} tone="gold" />
          <StatRow label="Jars created (all time)" value={jar.totalJarsCreated.toString()} />
          <StatRow label="Returned to savers" value={`${formatUsd(jar.totalWithdrawn)}`} />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted/80">
          Penalties are never withdrawable by a saver and never leave the contract until the owner
          sweeps them - readable by anyone at{" "}
          <span className="font-mono text-white/80">getAccumulatedPenalties()</span>.
        </p>
        <a
          href={`${explorerChainUrl}/address/${SAVINGS_JAR_ADDRESS}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-block text-xs text-accent/80 underline-offset-4 hover:underline"
        >
          Verify SavingsJar on the explorer →
        </a>
      </div>
    </aside>
  );
}

const TIER_STYLE: Record<Jar["tier"], string> = {
  Bronze: "border-orange-400/30 bg-orange-400/10 text-orange-300",
  Silver: "border-slate-300/30 bg-slate-300/10 text-slate-200",
  Gold: "border-gold/40 bg-gold/10 text-gold",
  Platinum: "border-accent/40 bg-accent/10 text-accent",
};

function TierBadge({ tier }: { tier: Jar["tier"] }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${TIER_STYLE[tier]}`}>
      {tier}
    </span>
  );
}

function StatRow({
  label,
  value,
  tone,
  loading = false,
}: {
  label: string;
  value: string;
  tone?: "accent" | "gold";
  loading?: boolean;
}) {
  const toneClass = tone === "accent" ? "text-accent" : tone === "gold" ? "text-gold" : "text-white";
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono text-xs tabular-nums ${toneClass}`}>
        {loading ? <span className="inline-block h-3 w-16 animate-pulse rounded bg-navy-500" /> : value}
      </dd>
    </div>
  );
}

function TxLink({ hash }: { hash: `0x${string}` }) {
  return (
    <a
      href={explorerTxUrl(EXPLORER_URL, hash)}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-xs text-accent/80 underline-offset-4 hover:underline"
    >
      tx {truncateAddress(hash)} ↗
    </a>
  );
}

function Footer() {
  return (
    <footer className="mt-14 border-t border-navy-500/70 pt-6 text-center text-xs text-muted/70">
      <p>
        SavingsJar{" "}
        <span className="font-mono text-white/70">{truncateAddress(SAVINGS_JAR_ADDRESS)}</span> ·
        USDC <span className="font-mono text-white/70">{truncateAddress(USDC_ADDRESS)}</span> · Arc
        Mainnet (5042)
      </p>
      <p className="mt-1">Non-custodial. The contract has no upgrade path and no pause switch.</p>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */

function badgeFor(stage: string, error: string | null): "idle" | "loading" | "success" | "error" {
  if (stage === "error" || error) return "error";
  if (["approving", "creating", "withdrawing", "breaking", "funding", "fundingJar"].includes(stage)) return "loading";
  if (["approved", "created", "withdrawn", "broken", "funded", "jarFunded"].includes(stage)) return "success";
  return "idle";
}

function TargetProgress({ amount, target }: { amount: bigint; target: bigint }) {
  const percent = target > 0n ? Math.min(100, Number((amount * 10_000n) / target) / 100) : 0;
  return (
    <div className="mt-6 w-full max-w-md rounded-2xl border border-accent/25 bg-accent/5 p-4 text-left">
      <div className="flex items-center justify-between text-xs"><span className="font-medium uppercase tracking-[0.14em] text-muted">Goal progress</span><span className="font-mono text-accent">{percent.toFixed(1)}%</span></div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-navy-900"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
      <p className="mt-2 text-xs text-muted"><span className="font-mono text-white">{formatUsd(amount)}</span> of <span className="font-mono text-white">{formatUsd(target)} USDC</span></p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export { JarDashboard };
