"use client";

import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";

import Logo from "@/components/Logo";
import { EXPLORER_URL } from "@/config/contracts";

export default function Landing() {
  const { openConnectModal } = useConnectModal();
  return (
    <div className="overflow-hidden">
      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:pb-28 lg:pt-24">
        <div className="pointer-events-none absolute -left-36 top-10 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />
        <div className="relative animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-bold text-sky-700 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Built for USDC on Arc
          </span>
          <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[1.04] tracking-[-0.05em] text-slate-950 sm:text-6xl lg:text-7xl">
            Save with purpose. <span className="bg-gradient-to-r from-sky-600 to-cyan-400 bg-clip-text text-transparent">Grow together.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
            Create goal-based USDC jars, build them one contribution at a time, and let friends support your progress. Your savings history stays transparent and on-chain.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => { console.log("[Landing] wallet connection requested"); openConnectModal?.(); }} className="inline-flex items-center justify-center rounded-2xl bg-sky-600 px-7 py-4 text-sm font-bold text-white shadow-[0_14px_35px_-12px_rgba(2,132,199,0.65)] transition hover:-translate-y-0.5 hover:bg-sky-700">
              Start saving <span className="ml-2">→</span>
            </button>
            <Link href="/demo" className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-7 py-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700">Explore the demo</Link>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-slate-500">
            <TrustItem text="Non-custodial" />
            <TrustItem text="6-decimal USDC" />
            <TrustItem text="Transparent activity" />
          </div>
        </div>

        <HeroProductCard />
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <Feature icon="◎" title="Goals that motivate" body="Set an optional target or use a traditional time-only jar. Track every step visually." />
          <Feature icon="＋" title="Save bit by bit" body="Top up any active jar without restarting its maturity date or reward history." />
          <Feature icon="↗" title="Support each other" body="Send an irreversible USDC contribution to a specific jar owned by another wallet." />
          <Feature icon="▤" title="A complete ledger" body="Review jars, contributions received, gifts sent, withdrawals, and target completions." />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-sky-600">Designed for clarity</p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.04em] text-slate-950">A disciplined plan without a custodian.</h2>
            <p className="mt-5 leading-7 text-slate-600">Your wallet owns the jars. The smart contract enforces the rules. Reaching a target unlocks principal early, while waiting to maturity preserves reward share, time bonus, and points.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Step number="01" title="Create" body="Choose a name, initial amount, target, and maturity." />
            <Step number="02" title="Build" body="Add USDC yourself or receive support from another wallet." />
            <Step number="03" title="Complete" body="Withdraw at your target or wait to maturity for incentives." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] bg-[#072A40] px-6 py-12 text-center shadow-2xl sm:px-12">
          <Logo size={48} withWordmark={false} />
          <h2 className="mt-5 text-3xl font-black tracking-tight text-white">Your next goal deserves a better plan.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-sky-100/75">Open a jar, invite support, and watch every contribution move you closer.</p>
          <button type="button" onClick={() => openConnectModal?.()} className="mt-7 rounded-2xl bg-white px-7 py-3.5 text-sm font-bold text-sky-900 transition hover:-translate-y-0.5">Connect your wallet</button>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row lg:px-8">
          <Logo size={30} muted />
          <p className="text-xs text-slate-500">USDC savings on Arc Mainnet · <a href={EXPLORER_URL} target="_blank" rel="noreferrer noopener" className="font-semibold text-sky-700 hover:underline">View explorer</a></p>
        </div>
      </footer>
    </div>
  );
}

function HeroProductCard() {
  return (
    <div className="relative animate-fade-up lg:pl-8">
      <div className="absolute -inset-8 rounded-full bg-sky-300/20 blur-3xl" />
      <div className="relative rounded-[2rem] border border-sky-900/10 bg-[#072A40] p-5 shadow-[0_35px_90px_-28px_rgba(7,42,64,0.65)] sm:p-7">
        <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">My goal</p><h3 className="mt-1 text-xl font-bold text-white">Creative studio</h3></div><span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-300">Active</span></div>
        <div className="mt-8 flex items-end justify-between"><div><p className="text-sm text-sky-100/60">Saved</p><p className="mt-1 text-3xl font-black text-white">$3,750.00</p></div><p className="text-sm font-bold text-sky-300">75%</p></div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full w-3/4 rounded-full bg-gradient-to-r from-sky-400 to-cyan-300" /></div>
        <div className="mt-3 flex justify-between text-xs text-sky-100/50"><span>Target progress</span><span>$5,000.00</span></div>
        <div className="mt-7 grid grid-cols-2 gap-3"><Metric label="Matures in" value="42 days" /><Metric label="Reward tier" value="Silver" /></div>
        <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/15 text-emerald-300">↓</span><div><p className="text-sm font-bold text-white">USDC added to your jar</p><p className="mt-0.5 text-xs text-sky-100/55">A supporter contributed <span className="font-bold text-emerald-300">$250.00</span></p></div></div></div>
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-white/[0.07] p-4"><p className="text-[11px] uppercase tracking-wider text-sky-100/45">{label}</p><p className="mt-1 font-bold text-white">{value}</p></div>; }
function TrustItem({ text }: { text: string }) { return <span className="inline-flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] text-emerald-700">✓</span>{text}</span>; }
function Feature({ icon, title, body }: { icon: string; title: string; body: string }) { return <article className="rounded-3xl border border-slate-200 bg-[#f9fcff] p-6 transition hover:-translate-y-1 hover:border-sky-200 hover:shadow-lg"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-lg font-bold text-sky-700">{icon}</span><h3 className="mt-5 font-bold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></article>; }
function Step({ number, title, body }: { number: string; title: string; body: string }) { return <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><span className="text-xs font-black tracking-wider text-sky-600">{number}</span><h3 className="mt-6 text-lg font-bold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></article>; }
