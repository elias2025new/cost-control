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
  const base = 'flex items-center gap-1.5 px-3 py-2 text-[13px] whitespace-nowrap border-b-2 transition-colors cursor-pointer relative';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref]);

  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title={disabledReason}
        className={`${base} border-transparent cursor-not-allowed select-none text-[#aaa8a0]`}
      >
        <span>{icon}</span>
        <span>{label}</span>
        <span className="text-[10px] ml-1 opacity-50">▼</span>
      </div>
    );
  }

  return (
    <div 
      className={`${base} ${
        active
          ? 'text-[#1a1a1a] dark:text-zinc-100 font-semibold border-b-[#16a34a] bg-[#f5f4f0] dark:bg-zinc-800'
          : 'text-[#333333] dark:text-zinc-300 border-b-transparent hover:bg-[#f0efe9] dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white'
      }`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      ref={ref}
    >
      <div className="flex items-center gap-1.5" onClick={(e) => { e.preventDefault(); setOpen(true); }}>
        <span className={active ? 'text-[#16a34a]' : 'text-[#666] dark:text-zinc-400'}>{icon}</span>
        {label}
        <span className="text-[10px] ml-0.5 text-[#666] dark:text-zinc-500">▼</span>
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-0 w-48 bg-[#ece9d8] dark:bg-zinc-900 border border-[#808080] dark:border-zinc-800 shadow-md z-50 py-1">
          {links.map((link) => {
            const linkActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-4 py-2 text-[13px] transition-colors ${
                  linkActive ? 'bg-[#c0c0c0] dark:bg-zinc-800 text-black dark:text-zinc-100 font-semibold' : 'text-[#333] dark:text-zinc-300 hover:bg-[#c0c0c0] dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white'
                }`}
              >
                <span className={linkActive ? 'text-[#16a34a]' : 'text-[#666] dark:text-zinc-400'}>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
