'use client';

import { useActionState } from 'react';

type DeleteState = { error: string | null; ok?: string };

export function DeleteButton({
  action,
  id,
  label = 'Delete',
  confirmText = 'Delete this? This cannot be undone.',
}: {
  action: (prevState: DeleteState, formData: FormData) => Promise<DeleteState>;
  id: string;
  label?: string;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(action, {
    error: null,
  });

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-rose-200 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
      >
        {pending ? 'Deleting…' : label}
      </button>
      {state.error && (
        <p className="mt-2 max-w-md text-[12.5px] text-rose-700 leading-snug">{state.error}</p>
      )}
    </form>
  );
}
