interface BrandMarkProps {
  onClick?: () => void;
}

export function BrandMark({ onClick }: BrandMarkProps) {
  const content = (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Transparent outer canvas, Premiere-inspired NLE rounded tile */}
        <defs>
          <linearGradient id="cfTileGrad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1B1638" />
            <stop offset="100%" stopColor="#0E1726" />
          </linearGradient>
          <linearGradient id="cfStrokeGrad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818CF8" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="28"
          height="28"
          rx="7"
          fill="url(#cfTileGrad)"
          stroke="url(#cfStrokeGrad)"
          strokeWidth="1.6"
        />
        {/* Stylised precision CF + timeline cut geometry */}
        <path
          d="M15.5 10.5C14.2 9.4 12.2 9.2 10.5 10.1C8.3 11.3 7.5 13.9 7.8 16.4C8.1 19 9.7 21.5 12.6 21.8C13.9 22 15 21.5 15.8 20.8"
          stroke="#E2E8F0"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
        <path
          d="M18.5 10H24.2M18.5 10V21.5M18.5 15.6H23"
          stroke="#14B8A6"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-slate-900 dark:text-[#F4F5F7]">
        Cut<span className="text-teal-500">Flow</span>
      </span>
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 cursor-pointer"
        aria-label="CutFlow Home"
      >
        {content}
      </button>
    );
  }

  return content;
}
