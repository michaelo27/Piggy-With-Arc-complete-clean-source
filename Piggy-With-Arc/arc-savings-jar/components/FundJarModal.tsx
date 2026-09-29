"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatUnits, isAddress } from "viem";

import StatusBadge from "@/components/StatusBadge";
import { USDC_DECIMALS } from "@/config/contracts";
import { parseUsdc } from "@/hooks/useSavingsJar";
import { formatUsd, truncateAddress } from "@/lib/format";
import type { JarData, TxState } from "@/lib/types";

interface Destination {
  id: number;
  data: JarData;
}

export interface FundJarModalProps {
  open: boolean;
  contributor: `0x${string}` | undefined;
  defaultOwner?: `0x${string}`;
  defaultJarId?: number;
  defaultJar?: JarData;
  usdcBalance: bigint;
  allowance: bigint;
  tx: TxState;
  busy: boolean;
  onClose: () => void;
  onApprove: (amount: bigint) => Promise<boolean>;
  onFund: (
    jarOwner: `0x${string}`,
    jarId: number,
    amount: string,
  ) => Promise<boolean>;
  onLookup: (jarOwner: `0x${string}`) => Promise<readonly JarData[]>;
}

/** Two-step approval + public-gift flow for one specific active jar slot. */
export default function FundJarModal({
  open,
  contributor,
  defaultOwner,
  defaultJarId,
  defaultJar,
  usdcBalance,
  allowance,
  tx,
  busy,
  onClose,
  onApprove,
  onFund,
  onLookup,
}: FundJarModalProps) {
  const [mounted, setMounted] = useState(false);
  const [ownerInput, setOwnerInput] = useState(defaultOwner ?? "");
  const [amountInput, setAmountInput] = useState("");
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(
    defaultJarId ?? null,
  );
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [approvedLocally, setApprovedLocally] = useState(false);
  const openSession = useRef(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) {
      openSession.current = false;
      return;
    }
    // Live jar polling replaces `defaultJar` every few seconds. Initialise only
    // once per opening so that refreshes never erase what the user is typing.
    if (openSession.current) return;
    openSession.current = true;
    setOwnerInput(defaultOwner ?? "");
    setAmountInput("");
    setDestinations(
      defaultJar && defaultJarId !== undefined
        ? [{ id: defaultJarId, data: defaultJar }]
        : [],
    );
    setSelectedId(defaultJarId ?? null);
    setLookupError(null);
    setApprovedLocally(false);
  }, [open, defaultOwner, defaultJarId, defaultJar]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  const parsed = useMemo(() => {
    if (!amountInput.trim())
      return { amount: 0n, error: null as string | null };
    try {
      return { amount: parseUsdc(amountInput), error: null as string | null };
    } catch (error) {
      return {
        amount: 0n,
        error: error instanceof Error ? error.message : "Invalid amount",
      };
    }
  }, [amountInput]);

  if (!open || !mounted) return null;

  const owner = isAddress(ownerInput) ? ownerInput : null;
  const selected =
    destinations.find((entry) => entry.id === selectedId) ?? null;
  const amountError =
    parsed.error ??
    (parsed.amount > usdcBalance ? "Amount exceeds your USDC balance" : null) ??
    (parsed.amount === 0n && amountInput.trim()
      ? "Amount must be greater than 0"
      : null);
  const allowanceReady = allowance >= parsed.amount || approvedLocally;
  const destinationReady = Boolean(owner && selected?.data.isActive);
  const isSelf = owner?.toLowerCase() === contributor?.toLowerCase();

  const lookup = async () => {
    if (!owner) {
      setLookupError("Enter a valid 0x wallet address.");
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    setDestinations([]);
    setSelectedId(null);
    try {
      const now = Math.floor(Date.now() / 1_000);
      const slots = await onLookup(owner);
      const active = slots
        .map((data, id) => ({ id, data }))
        .filter(
          (entry) => entry.data.isActive && Number(entry.data.unlockTime) > now,
        );
      if (active.length === 0) {
        setLookupError(
          "This address has no active, still-locked jar that accepts contributions.",
        );
      } else {
        setDestinations(active);
        setSelectedId(active[0].id);
        console.log(
          "[FundJarModal] eligible destinations",
          active.map((entry) => entry.id),
        );
      }
    } catch (error) {
      setLookupError(
        error instanceof Error
          ? error.message
          : "Could not read this wallet's jars.",
      );
    } finally {
      setLookingUp(false);
    }
  };

  const approve = async () => {
    if (parsed.amount <= 0n || amountError) return;
    const ok = await onApprove(parsed.amount);
    if (ok) setApprovedLocally(true);
  };

  const fund = async () => {
    if (
      !owner ||
      selectedId === null ||
      !destinationReady ||
      parsed.amount <= 0n ||
      amountError ||
      !allowanceReady
    )
      return;
    const ok = await onFund(owner, selectedId, amountInput.trim());
    if (ok) onClose();
  };

  const badgeStatus =
    tx.stage === "error"
      ? "error"
      : tx.stage === "approving" || tx.stage === "fundingJar"
        ? "loading"
        : tx.stage === "approved" || tx.stage === "jarFunded"
          ? "success"
          : "idle";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true">
      <button
        type="button"
        aria-label="Close contribution dialog"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-sm"
      />
      <section className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-xl">
              {" "}
            </span>
            <h2 className="mt-3 text-xl font-bold text-slate-950">
              {defaultOwner ? "Add to this jar" : "Contribute to a savings jar"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Add USDC bit by bit to a specific jar. Target completion makes
              principal penalty-free to withdraw.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xl text-slate-400 hover:text-slate-800">
            ×
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <label className="text-sm font-semibold text-slate-700">
              Jar owner address
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={ownerInput}
                onChange={(event) => {
                  setOwnerInput(event.target.value);
                  setDestinations([]);
                  setSelectedId(null);
                  setLookupError(null);
                }}
                disabled={Boolean(defaultOwner)}
                placeholder="0x..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:opacity-70"
              />
              {!defaultOwner ? (
                <button
                  type="button"
                  onClick={lookup}
                  disabled={lookingUp || !owner}
                  className="rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-700 disabled:opacity-40">
                  {lookingUp ? "Checking..." : "Find jars"}
                </button>
              ) : null}
            </div>
            {lookupError ? (
              <p className="mt-2 text-xs text-red-300">{lookupError}</p>
            ) : null}
          </div>

          {destinations.length > 1 ? (
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Destination jar
              </label>
              <select
                value={selectedId ?? ""}
                onChange={(event) => setSelectedId(Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
                {destinations.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    #{entry.id} · {entry.data.jarName} ·{" "}
                    {formatUsd(entry.data.amount)} USDC
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selected ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Destination jar #{selected.id}
                  </p>
                  <p className="mt-1 font-semibold text-slate-950">
                    {selected.data.jarName}
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    {truncateAddress(owner ?? "")}
                    {isSelf ? " · your jar" : ""}
                  </p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Active
                </span>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <Row
                  label="Saved"
                  value={`${formatUsd(selected.data.amount)} USDC`}
                />
                <Row
                  label="Target"
                  value={
                    selected.data.targetAmount > 0n
                      ? `${formatUsd(selected.data.targetAmount)} USDC`
                      : "Time-only jar"
                  }
                />
                <Row
                  label="Matures"
                  value={new Date(
                    Number(selected.data.unlockTime) * 1000,
                  ).toLocaleDateString()}
                />
              </dl>
              {selected.data.targetAmount > 0n ? (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{
                      width: `${Math.min(100, Number((selected.data.amount * 10_000n) / selected.data.targetAmount) / 100)}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label className="text-sm font-semibold text-slate-700">
                Contribution amount
              </label>
              <span className="text-xs text-slate-500">
                Balance:{" "}
                {Number(formatUnits(usdcBalance, USDC_DECIMALS)).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 2 },
                )}{" "}
                USDC
              </span>
            </div>
            <div className="relative mt-2">
              <input
                value={amountInput}
                onChange={(event) => {
                  setAmountInput(event.target.value);
                  setApprovedLocally(false);
                }}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-20 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-slate-400">
                USDC
              </span>
            </div>
            {amountError ? (
              <p className="mt-2 text-xs text-red-300">{amountError}</p>
            ) : null}
          </div>

          {!isSelf ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
              ⚠️ Contributions are irreversible gifts. Only the jar owner can
              withdraw them. Verify the address and jar carefully.
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row">
            {!allowanceReady ? (
              <button
                type="button"
                onClick={approve}
                disabled={
                  busy ||
                  !destinationReady ||
                  parsed.amount <= 0n ||
                  Boolean(amountError)
                }
                className="flex-1 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-40">
                {tx.stage === "approving" ? "Approving..." : "1. Approve USDC"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={fund}
              disabled={
                busy ||
                !destinationReady ||
                parsed.amount <= 0n ||
                Boolean(amountError) ||
                !allowanceReady
              }
              className="btn-primary flex-1">
              {tx.stage === "fundingJar"
                ? "Adding USDC..."
                : allowanceReady
                  ? "Add to Jar  "
                  : "2. Add to Jar  "}
            </button>
          </div>
          <div className="flex justify-center">
            <StatusBadge
              status={badgeStatus}
              label={tx.message || tx.error || undefined}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-mono text-xs font-semibold text-slate-800">
        {value}
      </dd>
    </div>
  );
}
