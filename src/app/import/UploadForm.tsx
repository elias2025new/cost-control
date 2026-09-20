'use client';

import { useActionState, useRef, useState } from 'react';
import { uploadSalesFile, type UploadState } from './actions';

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadSalesFile, {
    error: null,
  });
  const [filename, setFilename] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="px-5 py-5">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && inputRef.current) {
            const dt = new DataTransfer();
            dt.items.add(f);
            inputRef.current.files = dt.files;
            setFilename(f.name);
          }
        }}
        className={[
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
          dragging
            ? 'border-brand-500 bg-brand-50'
            : 'border-ink-200 dark:border-zinc-700 bg-ink-50 dark:bg-[#111111]/60 hover:border-ink-300 hover:bg-ink-50 dark:bg-[#111111]',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".xlsx,.xls"
          className="sr-only"
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
        />
        <span className="text-2xl text-ink-300 leading-none">↧</span>
        {filename ? (
          <span className="text-[14px] font-medium text-ink-800 dark:text-zinc-200">{filename}</span>
        ) : (
          <>
            <span className="text-[14px] font-medium text-ink-700">
              Drop the CNET sales export here
            </span>
            <span className="text-[12.5px] text-ink-500">
              or click to choose a file - “Categorized And Summarized By Article”, .xlsx
            </span>
          </>
        )}
      </label>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-[12px] text-ink-500 leading-snug max-w-md">
          Nothing is posted on upload. The file is read, reconciled against its own footer
          totals, and shown to you for review first.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Reading the file…' : 'Upload and validate'}
        </button>
      </div>
    </form>
  );
}
