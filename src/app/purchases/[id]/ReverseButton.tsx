'use client';

import React from 'react';

export function ReverseButton() {
  return (
    <button
      type="submit"
      className="px-6 py-3 bg-red-600 text-white font-bold rounded shadow hover:bg-red-700 transition-colors"
      onClick={(e) => {
        if (!confirm('Are you sure you want to reverse this purchase receipt? This will undo the stock impact.')) {
          e.preventDefault();
        }
      }}
    >
      Return to Supplier (Reverse)
    </button>
  );
}
