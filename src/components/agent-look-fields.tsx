import { AGENT_COLORS, AGENT_ICON_CHOICES, agentLook, colorLook } from "@/lib/agent-look";
import { cx, Field, IconTile } from "./ui";

/** The agent's tile with its icon and colour. */
export function AgentTile({
  type,
  icon,
  color,
  size = "md",
}: {
  type: string;
  icon?: string | null;
  color?: string | null;
  size?: "sm" | "title" | "md" | "lg";
}) {
  const look = agentLook(type, icon, color);
  return (
    <IconTile size={size} colors={look.tile}>
      <look.Icon />
    </IconTile>
  );
}

/**
 * Just the icon, in the agent's colour (sidebar rows). Wrapped, so the row's
 * own icon colours (muted, active) don't override the agent's.
 */
export function AgentIcon({
  type,
  icon,
  color,
  className = "size-3.5",
}: {
  type: string;
  icon?: string | null;
  color?: string | null;
  className?: string;
}) {
  const look = agentLook(type, icon, color);
  return (
    <span aria-hidden className={cx("flex shrink-0 items-center justify-center", look.text, className)}>
      <look.Icon className="size-full" />
    </span>
  );
}

/** Icon and colour pickers for an agent (inside a form: fields «icon» and «color»). */
export function AgentLookFields({
  type,
  icon,
  color,
}: {
  type: string;
  icon?: string | null;
  color?: string | null;
}) {
  const look = agentLook(type, icon, color);
  return (
    <>
      <Field label="Icono" group>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(AGENT_ICON_CHOICES).map(([key, { label, Icon }]) => (
            <label key={key} className="inline-flex" title={label}>
              <input
                type="radio"
                name="icon"
                value={key}
                defaultChecked={key === look.iconKey}
                className="peer sr-only"
              />
              <span
                className={cx(
                  "flex size-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-ink-700 transition-colors",
                  "hover:border-border-strong peer-checked:border-primary peer-checked:bg-brand-100 peer-checked:text-accent",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 [&_svg]:size-4",
                )}
              >
                <Icon aria-label={label} />
              </span>
            </label>
          ))}
        </div>
      </Field>
      <ColorField color={look.colorKey} />
    </>
  );
}

/** Colour swatches of the palette (inside a form: field «color»). Agents and projects. */
export function ColorField({ color, label = "Color" }: { color?: string | null; label?: string }) {
  const current = colorLook(color).key;
  return (
    <Field label={label} group>
      <div className="flex flex-wrap gap-2">
        {Object.entries(AGENT_COLORS).map(([key, c]) => (
          <label key={key} className="inline-flex" title={c.label}>
            <input
              type="radio"
              name="color"
              value={key}
              defaultChecked={key === current}
              className="peer sr-only"
            />
            <span
              aria-label={c.label}
              className={cx(
                "size-7 cursor-pointer rounded-full ring-offset-2 ring-offset-surface transition-shadow",
                "hover:ring-2 hover:ring-border-strong peer-checked:ring-2 peer-checked:ring-foreground",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60",
                c.swatch,
              )}
            />
          </label>
        ))}
      </div>
    </Field>
  );
}
