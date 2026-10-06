import { cx } from "./cx";

/**
 * The SalesMate mark: two speech bubbles (the agent and the customer) on
 * the AI gradient. `withName` adds the wordmark in the display face.
 */
export function Logo({
  size = 32,
  withName = false,
  className,
}: {
  size?: number;
  withName?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="bg-ai flex shrink-0 items-center justify-center rounded-[28%] shadow-brand"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none">
          <path
            d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.2 2.4c-.33.25-.8.01-.8-.4V13.0A2.5 2.5 0 0 1 4 10.5v-4Z"
            fill="white"
          />
          <path
            d="M18 9.2a2.3 2.3 0 0 1 2 2.3v3.8a2.5 2.5 0 0 1-1 2V19.4c0 .4-.47.65-.8.4L15.2 17.5H12a2.5 2.5 0 0 1-2.2-1.3"
            stroke="white"
            strokeOpacity="0.75"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {withName ? (
        <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SalesMate</span>
      ) : null}
    </span>
  );
}
