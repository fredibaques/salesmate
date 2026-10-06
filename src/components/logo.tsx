import { cx } from "./cx";

/**
 * The SalesMate mark, «Mate»: two circles that overlap, you and your agent
 * working together, in dark ink on a flat lime tile. `withName` adds the
 * wordmark.
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
        className="flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 48 48" width={size} height={size}>
          <circle cx="19.5" cy="24" r="10" fill="currentColor" opacity="0.95" />
          <circle cx="28.5" cy="24" r="10" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
      {withName ? (
        <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">
          SalesMate
        </span>
      ) : null}
    </span>
  );
}
