"use client";

import { useMemo, useState } from "react";

import { ACTIVITY_LABELS, type ActivityData } from "@/lib/types";
import { formatUsd, truncateAddress } from "@/lib/format";

interface ActivityHistoryProps {
  wallet: `0x${string}` | undefined;
  activities: readonly ActivityData[];
  totalCount: bigint;
  loading: boolean;
  error: boolean;
}

type Filter = "all" | "saving" | "gifts" | "withdrawals";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default function ActivityHistory({ wallet, activities, totalCount, loading, error }: ActivityHistoryProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const newestFirst = useMemo(() => [...activities].reverse(), [activities]);
  const filtered = newestFirst.filter((activity) => matchesFilter(activity.activityType, filter));

  const totals = useMemo(() => {
    let saved = 0n;
    let received = 0n;
    let sent = 0n;
    activities.forEach((activity) => {
      if (activity.activityType === 0 || activity.activityType === 1) saved += activity.amount;
      if (activity.activityType === 2) sent += activity.amount;
      if (activity.activityType === 3) received += activity.amount;
    });
    return { saved, received, sent };
  }, [activities]);

  return (
    <section className="animate-fade-up overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-36px_rgba(8,47,73,0.35)]">
      <div className="border-b border-slate-200 bg-gradient-to-r from-[#f6fbff] to-white px-5 py-6 sm:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Personal ledger</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Savings activity</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              A durable on-chain record of how you created jars, saved toward goals, sent gifts, received USDC, and withdrew funds.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Wallet records</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{totalCount.toString()}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Summary label="Saved by you" value={totals.saved} tone="blue" />
          <Summary label="Gifts received" value={totals.received} tone="green" />
          <Summary label="Gifts sent" value={totals.sent} tone="violet" />
        </div>
      </div>

      <div className="px-5 py-6 sm:px-8">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Activity filters">
          {(["all", "saving", "gifts", "withdrawals"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={filter === entry}
              onClick={() => setFilter(entry)}
              className={`rounded-full px-4 py-2 text-xs font-semibold capitalize transition ${
                filter === entry ? "bg-sky-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {entry}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-8 space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}</div>
        ) : error ? (
          <Empty title="Could not load activity" body="Check your network connection and try again." />
        ) : filtered.length === 0 ? (
          <Empty title="No activity in this view" body="Your on-chain savings journey will appear here as soon as you create or fund a jar." />
        ) : (
          <ol className="mt-8 space-y-3">
            {filtered.map((activity, index) => (
              <ActivityRow key={`${activity.timestamp}-${activity.activityType}-${index}`} activity={activity} wallet={wallet} />
            ))}
          </ol>
        )}

        {totalCount > BigInt(activities.length) ? (
          <p className="mt-5 text-center text-xs text-slate-400">Showing the latest {activities.length} of {totalCount.toString()} records.</p>
        ) : null}
      </div>
    </section>
  );
}

function ActivityRow({ activity, wallet }: { activity: ActivityData; wallet: `0x${string}` | undefined }) {
  const presentation = describe(activity, wallet);
  const hasJar = activity.jarId !== (2n ** 256n - 1n);
  return (
    <li className="group flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg ${presentation.iconClass}`}>{presentation.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-start">
          <div>
            <p className="font-semibold text-slate-900">{presentation.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">{presentation.detail}</p>
          </div>
          <p className={`font-mono text-sm font-bold ${presentation.amountClass}`}>{presentation.prefix}{formatUsd(activity.amount)} USDC</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <time dateTime={new Date(Number(activity.timestamp) * 1000).toISOString()}>{new Date(Number(activity.timestamp) * 1000).toLocaleString()}</time>
          {hasJar ? <span>Jar #{activity.jarId.toString()}</span> : null}
          <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">On-chain</span>
        </div>
      </div>
    </li>
  );
}

function describe(activity: ActivityData, wallet: `0x${string}` | undefined) {
  const actor = activity.actor.toLowerCase() === wallet?.toLowerCase() ? "you" : truncateAddress(activity.actor);
  const counterparty = activity.counterparty === ZERO_ADDRESS ? "" : truncateAddress(activity.counterparty);
  const fallback = ACTIVITY_LABELS[activity.activityType] ?? "Savings activity";
  switch (activity.activityType) {
    case 0: return { title: "Jar created", detail: "You started a new savings plan.", icon: "＋", iconClass: "bg-sky-100 text-sky-700", amountClass: "text-sky-700", prefix: "+" };
    case 1: return { title: "Jar topped up", detail: "You added more USDC toward your goal.", icon: "↗", iconClass: "bg-blue-100 text-blue-700", amountClass: "text-blue-700", prefix: "+" };
    case 2: return { title: "Contribution sent", detail: `Gifted to ${counterparty}. Contributions cannot be reversed.`, icon: "🎁", iconClass: "bg-violet-100 text-violet-700", amountClass: "text-violet-700", prefix: "−" };
    case 3: return { title: "Contribution received", detail: `${actor} added USDC to your jar.`, icon: "↓", iconClass: "bg-emerald-100 text-emerald-700", amountClass: "text-emerald-700", prefix: "+" };
    case 4: return { title: "Mature jar withdrawn", detail: "Principal and eligible incentives were paid to your wallet.", icon: "✓", iconClass: "bg-emerald-100 text-emerald-700", amountClass: "text-emerald-700", prefix: "+" };
    case 5: return { title: "Target withdrawal", detail: "Goal completed; principal was withdrawn before maturity.", icon: "🎯", iconClass: "bg-cyan-100 text-cyan-700", amountClass: "text-cyan-700", prefix: "+" };
    case 6: return { title: "Emergency break", detail: "The jar was closed early after the discipline penalty.", icon: "!", iconClass: "bg-rose-100 text-rose-700", amountClass: "text-rose-700", prefix: "+" };
    case 7: return { title: "Target reached", detail: `${actor === "you" ? "Your savings" : actor + "’s contribution"} completed this goal.`, icon: "★", iconClass: "bg-amber-100 text-amber-700", amountClass: "text-amber-700", prefix: "" };
    case 8: return { title: "Bonus pool funded", detail: "You supported time-based rewards for disciplined savers.", icon: "◆", iconClass: "bg-indigo-100 text-indigo-700", amountClass: "text-indigo-700", prefix: "+" };
    default: return { title: fallback, detail: "Recorded by the Piggy With Arc smart contract.", icon: "•", iconClass: "bg-slate-100 text-slate-700", amountClass: "text-slate-700", prefix: "" };
  }
}

function Summary({ label, value, tone }: { label: string; value: bigint; tone: "blue" | "green" | "violet" }) {
  const classes = tone === "blue" ? "bg-sky-50 text-sky-700" : tone === "green" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700";
  return <div className={`rounded-2xl p-4 ${classes}`}><p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{label}</p><p className="mt-1 font-mono text-lg font-bold">{formatUsd(value)} USDC</p></div>;
}

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"><p className="font-semibold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{body}</p></div>;
}

function matchesFilter(type: number, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "saving") return type === 0 || type === 1 || type === 7;
  if (filter === "gifts") return type === 2 || type === 3;
  return type === 4 || type === 5 || type === 6;
}
