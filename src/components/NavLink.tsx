'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({
  href,
  icon,
  label,
  disabled = false,
  disabledReason,
}: {
  href: string;
  icon: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);

  const base = 'flex items-center gap-1.5 px-3 py-2 text-[13px] whitespace-nowrap border-b-2 transition-colors';

  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title={disabledReason}
        className={`${base} border-transparent cursor-not-allowed select-none text-[#aaa8a0] dark:text-[#666]`}
      >
        <span>{icon}</span>
        <span>{label}</span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`${base} ${
        active
          ? 'text-[#1a1a1a] dark:text-zinc-100 font-semibold border-b-[#16a34a] bg-[#f5f4f0] dark:bg-zinc-800'
          : 'text-[#333333] dark:text-zinc-300 border-b-transparent hover:bg-[#f0efe9] dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white'
      }`}
    >
      <span className={active ? 'text-[#16a34a]' : 'text-[#666] dark:text-zinc-400'}>{icon}</span>
      {label}
    </Link>
  );
}
