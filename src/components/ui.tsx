import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="border-b border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-950 px-8 py-5">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[19px] font-semibold text-ink-900 dark:text-ink-100 tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px] text-ink-500 mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}

export function Card({
  title,
  hint,
  children,
  className = '',
  right,
}: {
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <section
      className={`bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 rounded-xl overflow-hidden ${className}`}
    >
      {title && (
        <div className="px-5 py-3.5 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between gap-4 bg-ink-50 dark:bg-ink-950">
          <div>
            <h2 className="text-[13px] font-semibold text-ink-800 dark:text-ink-200 uppercase tracking-wide">
              {title}
            </h2>
            {hint && <p className="text-[12px] text-ink-500 dark:text-ink-400 mt-0.5">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'neutral',
  note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  note?: ReactNode;
}) {
  const tones = {
    neutral: 'text-ink-900 dark:text-ink-100',
    good: 'text-brand-700 dark:text-brand-400',
    warn: 'text-amber-700 dark:text-amber-400',
    bad: 'text-rose-700 dark:text-rose-400',
  };
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-semibold">
        {label}
      </div>
      <div className={`mt-1.5 text-[26px] leading-none font-semibold tnum ${tones[tone]}`}>
        {value}
        {unit && <span className="text-[13px] font-medium text-ink-400 dark:text-ink-500 ml-1.5">{unit}</span>}
      </div>
      {note && <div className="text-[12px] text-ink-500 dark:text-ink-400 mt-1.5 leading-snug">{note}</div>}
    </div>
  );
}

const BADGES = {
  block: 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  warn: 'bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  info: 'bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  good: 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 border-brand-100 dark:border-brand-800',
  neutral: 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 border-ink-200 dark:border-ink-700',
  sample: 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof BADGES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight ${BADGES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The approval chain from the client's written spec, rendered but inert.
 *
 * He asked for three authorisation levels before stock is released. That is
 * not built - showing it greyed out says we read the requirement and know
 * where it belongs, without pretending it works.
 */
export function ApprovalChain({
  steps,
  caption,
}: {
  steps: string[];
  caption?: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {steps.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-ink-50 dark:bg-[#111111] px-2.5 py-1.5 text-[12px] text-ink-400">
              <span className="w-3.5 h-3.5 rounded-full border border-ink-300 inline-block" />
              {s}
            </span>
            {i < steps.length - 1 && <span className="text-ink-300 text-[13px]">→</span>}
          </span>
        ))}
      </div>
      <p className="text-[12px] text-ink-500 mt-3 leading-snug">
        {caption ??
          'Approval routing is understood but not built for this demo. Every step here is inactive.'}
      </p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center text-[13px] text-ink-400">{children}</div>
  );
}

/** Shown in place of a page's real content when no tenant exists yet. */
export function OnboardingNotice() {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-[13px] text-ink-500 max-w-sm mx-auto leading-relaxed">
        Nothing set up yet. Create a tenant to start entering stores, items, and recipes.
      </p>
      <a
        href="/setup/tenant"
        className="inline-block mt-4 rounded-lg bg-ink-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-800"
      >
        Set up your tenant →
      </a>
    </div>
  );
}

export function SampleNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-2.5 ${className}`}
    >
      <span className="text-violet-500 text-[13px] leading-5">�-�</span>
      <p className="text-[12.5px] text-violet-900 leading-snug">
        <strong className="font-semibold">Sample recipes.</strong> Ingredient quantities and
        costs are our best estimate, not your figures. Please correct them - we would rather be
        told than guessed right by accident.
      </p>
    </div>
  );
}
