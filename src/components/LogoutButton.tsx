'use client';

import { logout } from '../app/login/actions';

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        style={{
          background: '#d4d0c8',
          border: '1px solid #808080',
          color: '#1a1a1a',
          fontSize: '11px',
          padding: '2px 10px',
          borderRadius: '2px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = '#e8e4dc';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = '#d4d0c8';
        }}
      >
        Sign out
      </button>
    </form>
  );
}

