'use client';

import * as React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex w-[82px] h-[30px] bg-[#e6e6e6] dark:bg-[#1a1a1a] p-[3px] rounded-full border border-[#ccc] dark:border-[#333]" />
    );
  }

  const options = [
    { value: 'light', icon: Sun },
    { value: 'system', icon: Monitor },
    { value: 'dark', icon: Moon },
  ];

  return (
    <div className="flex bg-[#e6e6e6] dark:bg-[#121212] p-[3px] rounded-full border border-[#ccc] dark:border-[#333] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-colors">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = theme === option.value;
        return (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={`p-1 rounded-full transition-all duration-200 flex items-center justify-center border-0 ${
              isActive 
                ? 'bg-white dark:bg-[#333] text-black dark:text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.5)]' 
                : 'bg-transparent text-[#666] dark:text-[#888] hover:text-black dark:hover:text-white shadow-none'
            }`}
            style={{ boxShadow: isActive ? undefined : 'none' }} /* override default button shadow */
            title={`Set theme to ${option.value}`}
          >
            <Icon size={14} strokeWidth={isActive ? 2.5 : 2} />
          </button>
        );
      })}
    </div>
  );
}
