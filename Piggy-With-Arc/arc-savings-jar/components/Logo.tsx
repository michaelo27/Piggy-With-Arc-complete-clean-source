"use client";

export interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  muted?: boolean;
  className?: string;
}

/** Professional piggy-bank mark built as an inline, dependency-free SVG. */
export default function Logo({
  size = 38,
  withWordmark = true,
  muted = false,
  className = "",
}: LogoProps) {
  const id = `piggy-logo-${size}-${withWordmark ? "word" : "icon"}`;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
        className="shrink-0 drop-shadow-sm">
        <defs>
          <linearGradient
            id={`${id}-bg`}
            x1="7"
            y1="5"
            x2="42"
            y2="44"
            gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="1" stopColor="#0369A1" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="44"
          height="44"
          rx="14"
          fill={`url(#${id}-bg)`}
        />
        <path
          d="M13 24.2c0-6.1 4.9-10.7 11.2-10.7 4 0 7.4 1.7 9.4 4.6h4.2v6.2h-3.1a11 11 0 0 1-4.1 5.4v4.8h-5v-3.1h-7.2v3.1h-5v-5.7a9.8 9.8 0 0 1-.4-4.6Z"
          fill="white"
        />
        <path
          d="M20.4 12.2c2.8-1.8 6.4-1.7 8.8.1l-2.1 3.1h-5.4l-1.3-3.2Z"
          fill="#BAE6FD"
        />
        <path
          d="M20.4 18.2h7.2"
          stroke="#075985"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="29.5" cy="21.4" r="1.25" fill="#075985" />
        <circle cx="37.7" cy="21.2" r="1.1" fill="#075985" />
        <path
          d="M10.4 19.4c-2.1 0-3.2 1.2-3.2 2.8 0 1.4 1 2.3 2.4 2.3"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {withWordmark ? (
        <span className="flex flex-col leading-none">
          <span
            className={`text-[16px] font-extrabold tracking-[-0.025em] ${muted ? "text-slate-500" : "text-slate-950"}`}>
            Piggy With Arc
          </span>
          <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-sky-600">
            Save together · grow steadily
          </span>
        </span>
      ) : null}
    </span>
  );
}

export { Logo };
