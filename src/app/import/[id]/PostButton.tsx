'use client';

import { useActionState } from 'react';
import { postImport, type PostState } from '../actions';

export function PostButton({
  importId,
  canPost,
  alreadyPosted,
  blockedReason,
}: {
  importId: string;
  canPost: boolean;
  alreadyPosted: boolean;
  blockedReason: string | null;
}) {
  const [state, action, pending] = useActionState<PostState, FormData>(postImport, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-4">
      <input type="hidden" name="importId" value={importId} />

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          {alreadyPosted ? (
            <p className="text-[13px] text-ink-600">
              This import is posted. Stock has already moved. Posting again is safe and will
              change nothing.
            </p>
          ) : canPost ? (
            <p className="text-[13px] text-ink-600">
              Everything that must be true is true. Posting records the revenue and depletes
              stock through the recipes.
            </p>
          ) : (
            <p className="text-[13px] text-rose-700">
              <strong className="font-semibold">Posting is disabled.</strong> {blockedReason}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending || !canPost}
          className={[
            'shrink-0 rounded-lg px-5 py-2.5 text-[13.5px] font-medium transition-colors',
            canPost && !pending
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'bg-ink-200 text-ink-400 cursor-not-allowed',
          ].join(' ')}
        >
          {pending ? 'Posting…' : alreadyPosted ? 'Post again (no effect)' : 'Post to stock'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {state.ok}
        </div>
      )}
    </form>
  );
}
