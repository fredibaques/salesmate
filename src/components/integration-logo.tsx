import { Database, Phone } from "lucide-react";
import type { ReactNode } from "react";
import {
  siAirtable,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGooglemeet,
  siGooglesheets,
  siHubspot,
  siTrello,
  siModelcontextprotocol,
  siTwenty,
  siWhatsapp,
  type SimpleIcon,
} from "simple-icons";
import { cx } from "./ui";

/**
 * The logo of each tool, on a white tile: the brand's own image (in
 * public/logos) when we have it, otherwise its mark from simple-icons or
 * drawn from its simple geometry; the rest keep their initial in their
 * colour until we have their mark.
 */

function Picture({ src }: { src: string }) {
  // A 128 px PNG shown at tile size: next/image would add nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="size-full object-contain" />;
}

function Brand({ icon, color }: { icon: SimpleIcon; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden className="size-full" fill={color ?? `#${icon.hex}`}>
      <path d={icon.path} />
    </svg>
  );
}

const MicrosoftMark = (
  <svg viewBox="0 0 24 24" aria-hidden className="size-full">
    <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
    <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
    <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
  </svg>
);

const MondayMark = (
  <svg viewBox="0 0 24 24" aria-hidden className="size-full">
    <rect x="1.5" y="6" width="4.6" height="13" rx="2.3" transform="rotate(30 3.8 12.5)" fill="#FF3D57" />
    <rect x="8.7" y="6" width="4.6" height="13" rx="2.3" transform="rotate(30 11 12.5)" fill="#FFCB00" />
    <circle cx="19.5" cy="16.5" r="2.6" fill="#00CA72" />
  </svg>
);

const MARKS: Record<string, ReactNode> = {
  google: <Picture src="/logos/google.png" />,
  apollo: <Picture src="/logos/apollo.png" />,
  hunter: <Picture src="/logos/hunter.png" />,
  slack: <Picture src="/logos/slack.png" />,
  gmail: <Brand icon={siGmail} />,
  google_calendar: <Brand icon={siGooglecalendar} />,
  hubspot: <Brand icon={siHubspot} />,
  twenty: <Brand icon={siTwenty} />,
  mcp: <Brand icon={siModelcontextprotocol} />,
  whatsapp: <Brand icon={siWhatsapp} />,
  google_meet: <Brand icon={siGooglemeet} />,
  google_docs: <Brand icon={siGoogledocs} />,
  google_sheets: <Brand icon={siGooglesheets} />,
  airtable: <Brand icon={siAirtable} />,
  trello: <Brand icon={siTrello} />,
  monday: MondayMark,
  microsoft: MicrosoftMark,
  phone: <Phone className="size-full text-ink-600" strokeWidth={1.75} />,
  database: <Database className="size-full text-ink-600" strokeWidth={1.75} />,
};

const SIZES = {
  xs: "size-6 p-1 text-xs",
  sm: "size-8 p-1.5 text-sm",
  md: "size-9 p-2 text-sm",
  lg: "size-11 p-2.5 text-lg",
};

export function IntegrationLogo({
  id,
  name,
  color,
  size = "md",
}: {
  id: string;
  name: string;
  /** Brand colour for the initial when there is no mark. */
  color?: string;
  size?: keyof typeof SIZES;
}) {
  const mark = MARKS[id];
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-lg border border-border bg-white",
        SIZES[size],
        !mark && "font-semibold",
      )}
      style={mark ? undefined : { color: color ?? "var(--color-accent)" }}
    >
      {mark ?? name.slice(0, 1).toUpperCase()}
    </span>
  );
}
