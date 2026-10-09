"use client";

import { useEffect, useRef, useState } from "react";

export type LinePoint = {
  /** Short label for the axis (e.g. «9 oct»). */
  label: string;
  /** Longer label for the tooltip (e.g. «Semana del 6 oct»). */
  title: string;
  value: number;
  /** The value as it should read (e.g. «1,20 $»). */
  display: string;
  /** Extra line in the tooltip (e.g. «3 ejecuciones»). */
  detail?: string;
};

const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 52 };
const LINE = "var(--color-brand-600)";

/** Round step for the y axis: 1, 2 or 5 times a power of ten. */
function niceMax(max: number) {
  if (max <= 0) return 1;
  const raw = max / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  return step * 3;
}

/** Axis values: as many decimals as the grid step needs, so no two read the same. */
function tick(value: number, step: number, unit: "usd") {
  const digits = value === 0 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));
  const n = value.toFixed(digits);
  return unit === "usd" ? `${n} $` : n;
}

/**
 * One series over time: a 2px line on recessive gridlines, with a
 * crosshair that snaps to the nearest point and a tooltip (also with the
 * arrow keys). A hidden table carries the same numbers for screen readers.
 */
export function LineChart({
  points,
  label,
  unit,
}: {
  points: LinePoint[];
  /** What the chart shows, for screen readers. */
  label: string;
  /** Unit of the y axis. */
  unit: "usd";
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const ticks = [0, max / 3, (2 * max) / 3, max];
  // First, middle and last labels: enough to place the dates without crowding.
  const labelled = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const last = points.length - 1;

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = clientX - rect.left - PAD.left;
    const i = Math.round((rel / plotW) * (points.length - 1));
    setActive(Math.min(last, Math.max(0, i)));
  };
  const point = active === null ? null : points[active];

  return (
    <div ref={box} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={label}
        tabIndex={0}
        className="block touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? last) - 1));
          else if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? -1) + 1));
          else return;
          e.preventDefault();
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-ink-200)" />
            <text
              x={PAD.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-500 text-[11px] tabular-nums"
            >
              {tick(t, max / 3, unit)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          labelled.has(i) ? (
            <text
              key={p.title}
              x={x(i)}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
              className="fill-ink-500 text-[11px]"
            >
              {p.label}
            </text>
          ) : null,
        )}
        <path
          d={path}
          fill="none"
          stroke={LINE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active !== null ? (
          <>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-ink-400)"
            />
            <circle
              cx={x(active)}
              cy={y(points[active].value)}
              r={4.5}
              fill={LINE}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </>
        ) : (
          <circle cx={x(last)} cy={y(points[last].value)} r={3.5} fill={LINE} />
        )}
      </svg>
      {point && active !== null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
          style={x(active) > width / 2 ? { right: width - x(active) + 10 } : { left: x(active) + 10 }}
        >
          <div className="text-muted">{point.title}</div>
          <div className="font-medium text-ink-900 tabular-nums">{point.display}</div>
          {point.detail ? <div className="text-muted">{point.detail}</div> : null}
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.title}>
              <th scope="row">{p.title}</th>
              <td>{p.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
