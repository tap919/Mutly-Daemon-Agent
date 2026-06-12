import React from 'react';

interface SubmitScanButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading: boolean;
}

export const SubmitScanButton = ({ loading, children, ...props }: SubmitScanButtonProps) => {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-semibold tracking-wide transition-all duration-300 outline-none select-none
        ${
          loading
            ? 'bg-zinc-900 border border-zinc-800 text-zinc-500 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-600/10 cursor-pointer active:scale-[0.99]'
        }
      `}
    >
      {loading ? (
        <>
          <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-zinc-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Executing Scanners...
        </>
      ) : (
        children || 'Execute Scanner'
      )}
    </button>
  );
};
