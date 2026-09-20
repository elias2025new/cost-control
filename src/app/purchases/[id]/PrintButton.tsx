'use client';

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      title="Print Receipt"
      className="p-2 text-gray-500 hover:text-blue-600 transition-colors print:hidden text-xl shadow-none active:shadow-none bg-transparent border-none"
    >
      🖨️
    </button>
  );
}
