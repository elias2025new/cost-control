'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

export function NavDropdown({
  label,
  icon,
  links,
  disabled = false,
  disabledReason,
}: {
  label: string;
  icon: string;
  links: { href: string; label: string; icon: string }[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = links.some((link) => pathname.startsWith(link.href));

  const base =
    'flex items-center gap-1.5 px-3 py-2 text-[13px] whitespace-nowrap border-b-2 transition-colors cursor-pointer select-none';

  // Close on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title={disabledReason}
        className={`${base} border-transparent cursor-not-allowed text-[#aaa8a0] dark:text-zinc-600`}
      >
        <span>{icon}</span>
        <span>{label}</span>
        <span className="text-[9px] ml-1 opacity-40">▼</span>
      </div>
    );
  }

  return (
    <div
      className="relative"
      ref={ref}
      // Open on hover as well as click (desktop UX)
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`${base} ${
          active
            ? 'text-[#1a1a1a] dark:text-zinc-100 font-semibold border-b-[#16a34a] bg-[#f5f4f0] dark:bg-zinc-800'
            : 'text-[#333333] dark:text-zinc-300 border-b-transparent hover:bg-[#f0efe9] dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white'
        }`}
      >
        <span className={active ? 'text-[#16a34a]' : 'text-[#666] dark:text-zinc-400'}>
          {icon}
        </span>
        <span>{label}</span>
        {/* Chevron rotates when open */}
        <svg
          className={`ml-1 h-3 w-3 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : 'rotate-0'
          } ${active ? 'text-[#16a34a]' : 'text-[#888] dark:text-zinc-500'}`}
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={`
            absolute top-full right-0 mt-0.5 z-50
            min-w-[220px]
            rounded-sm
            bg-white dark:bg-zinc-900
            border border-[#b0ae9e] dark:border-zinc-700
            shadow-[0_4px_16px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.5)]
            py-1 overflow-hidden
          `}
          style={{ animation: 'navDropdownIn 110ms ease-out' }}
        >
          {/* Section header */}
          <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-widest font-semibold text-[#888] dark:text-zinc-500 border-b border-[#e0ddd4] dark:border-zinc-800 mb-1">
            Analytics
          </div>

          {links.map((link) => {
            const linkActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 text-[13px] transition-colors
                  ${
                    linkActive
                      ? 'bg-[#f0ffe8] dark:bg-zinc-800 text-black dark:text-zinc-100 font-semibold'
                      : 'text-[#333] dark:text-zinc-300 hover:bg-[#f0efe9] dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white'
                  }
                `}
              >
                <span
                  className={`text-[16px] w-5 text-center shrink-0 ${
                    linkActive ? 'text-[#16a34a]' : 'opacity-70'
                  }`}
                >
                  {link.icon}
                </span>
                <span className="leading-snug">{link.label}</span>
                {linkActive && (
                  <span className="ml-auto text-[#16a34a] text-[10px]">●</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
