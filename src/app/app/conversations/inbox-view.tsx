import {
  ArrowLeft,
  Bot,
  Building2,
  Database,
  FileInput,
  Info,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  Search,
  StickyNote,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { approve, reject } from "@/app/app/(copilot)/inbox/actions";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, cx, EmptyState, Input, Textarea } from "@/components/ui";
import { colorLook } from "@/lib/agent-look";
import { AGENT_LABELS, CONTACT_STATUS_LABELS, formatDateTime, TRANSCRIPT_STATUS } from "@/lib/format";
import {
  getPerson,
  listInbox,
  markRead,
  type InboxBox,
  type InboxRow,
  type Person,
} from "@/server/conversations/inbox";
import type { TenantContext } from "@/server/db/tenant";
import { getDb } from "@/server/db/client";
import { getActionDefinition } from "@/server/gateway/definitions";
import { changePersonAction, noteAction, replyAction } from "./actions";
import { AutoRefresh, Composer, PersonButtons, ScrollToEnd, SubmitOnChange } from "./inbox-client";

/**
 * The conversations inbox, as in a help desk: people on the left (one row
 * per person, whatever their channels), the thread in the middle and who
 * they are on the right. Drafts the agents prepared are approved in the
 * thread itself; a person answers or leaves notes at its foot.
 */

export const CHANNELS: Record<string, { label: string; icon: LucideIcon; className?: string }> = {
  email: { label: "Email", icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, className: "text-[#1da851]" },
  form: { label: "Formulario", icon: FileInput },
  phone: { label: "Teléfono", icon: Phone },
  chat: { label: "Chat", icon: MessagesSquare },
  crm: { label: "CRM", icon: Database },
  meet: { label: "Reunión", icon: Video },
  note: { label: "Nota", icon: StickyNote },
};

function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  const c = CHANNELS[channel] ?? CHANNELS.chat;
  const Icon = c.icon;
  return (
    <Icon aria-label={c.label} className={cx("size-3.5 shrink-0", c.className ?? "text-muted", className)} />
  );
}

const BOXES: { key: InboxBox | "all"; label: string }[] = [
  { key: "needs", label: "Te necesitan" },
  { key: "waiting", label: "Esperando" },
  { key: "closed", label: "Cerradas" },
  { key: "all", label: "Todas" },
];

const TZ = "Europe/Madrid";
const dayKey = (d: Date) => d.toLocaleDateString("es-ES", { timeZone: TZ });

/** «10:42» today, «lun 6» this week, «06/10» before. */
function shortTime(d: Date | null) {
  if (!d) return "";
  const now = new Date();
  if (dayKey(d) === dayKey(now)) {
    return d.toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  }
  if (now.getTime() - d.getTime() < 6 * 86_400_000) {
    return d.toLocaleDateString("es-ES", { timeZone: TZ, weekday: "short", day: "numeric" });
  }
  return d.toLocaleDateString("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit" });
}

function dayLabel(d: Date) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const k = dayKey(d);
  if (k === today) return "Hoy";
  if (k === yesterday) return "Ayer";
  return d.toLocaleDateString("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
}

function Avatar({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        colorLook(color).tile,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export type InboxQuery = { box?: string; channel?: string; q?: string; c?: string; project?: string };

export async function InboxView({
  tenant,
  projectId,
  projects,
  query,
  basePath,
  heightClass,
}: {
  tenant: TenantContext & { userId: string };
  /** Only this project's people (a project's tab). */
  projectId?: string;
  /** Projects to filter by (the section, across projects). */
  projects?: { id: string; name: string }[];
  query: InboxQuery;
  basePath: string;
  heightClass: string;
}) {
  const db = getDb();
  const box = (BOXES.find((b) => b.key === query.box)?.key ?? "needs") as InboxBox | "all";
  const filterProject =
    projectId ?? (projects?.some((p) => p.id === query.project) ? query.project : undefined);
  const channel = query.channel && CHANNELS[query.channel] ? query.channel : undefined;
  const q = query.q?.trim() || undefined;
  const user = { orgId: tenant.orgId, userId: tenant.userId };
  // Opening someone reads them.
  const selected = query.c ? await getPerson(db, tenant, query.c) : null;
  if (selected && (!projectId || selected.project?.id === projectId)) await markRead(db, user, selected.key);
  const person = selected && (!projectId || selected.project?.id === projectId) ? selected : null;
  const { rows, counts } = await listInbox(db, user, { projectId: filterProject, box, channel, q });

  const href = (changes: Partial<InboxQuery>) => {
    const params = new URLSearchParams();
    const next = {
      box: box === "needs" ? undefined : box,
      project: filterProject && !projectId ? filterProject : undefined,
      channel,
      q,
      c: person?.key,
      ...changes,
    };
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className={cx("flex overflow-hidden rounded-xl border border-border bg-surface", heightClass)}>
      <AutoRefresh />
      {/* People */}
      <aside
        className={cx(
          "w-full shrink-0 flex-col border-border md:flex md:w-80 md:border-r lg:w-96",
          person ? "hidden" : "flex",
        )}
      >
        <div className="space-y-2 border-b border-border p-3">
          <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Bandejas">
            {BOXES.map((b) => (
              <Link
                key={b.key}
                href={href({ box: b.key === "needs" ? undefined : b.key, c: undefined })}
                aria-current={b.key === box ? "page" : undefined}
                className={cx(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  b.key === box
                    ? "border-border-strong bg-ink-100 font-medium text-foreground"
                    : "border-border text-ink-700 hover:bg-ink-50",
                )}
              >
                {b.label} <span className="tabular-nums">{counts[b.key]}</span>
              </Link>
            ))}
          </nav>
          <form action={basePath} className="flex gap-2">
            {box !== "needs" ? <input type="hidden" name="box" value={box} /> : null}
            <Input
              name="q"
              defaultValue={q}
              placeholder="Buscar persona o empresa"
              icon={<Search />}
              size="sm"
              aria-label="Buscar"
              className="min-w-0 flex-1"
            />
            <SubmitOnChange
              name="channel"
              defaultValue={channel ?? ""}
              aria-label="Canal"
              options={[
                { value: "", label: "Canales" },
                ...["email", "whatsapp", "form"].map((k) => ({ value: k, label: CHANNELS[k].label })),
              ]}
            />
            {projects && !projectId ? (
              <SubmitOnChange
                name="project"
                defaultValue={filterProject ?? ""}
                aria-label="Proyecto"
                options={[
                  { value: "", label: "Proyectos" },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            ) : null}
          </form>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted">
              {counts.all === 0
                ? "Todavía no hay conversaciones."
                : box === "needs"
                  ? "Nadie te necesita ahora mismo."
                  : "Nada en esta bandeja."}
            </li>
          ) : (
            rows.map((r) => (
              <PersonRow
                key={r.key}
                row={r}
                href={href({ c: r.key })}
                active={r.key === person?.key}
                showProject={!projectId}
              />
            ))
          )}
        </ul>
      </aside>

      {/* Thread */}
      <section className={cx("min-w-0 flex-1 flex-col", person ? "flex" : "hidden md:flex")}>
        {person ? (
          <Thread person={person} backHref={href({ c: undefined })} showProject={!projectId} />
        ) : (
          <div className="m-auto p-6">
            <EmptyState
              icon={<MessagesSquare />}
              title={counts.all === 0 ? "Aquí verás lo que hablan tus agentes" : "Elige una conversación"}
              description={
                counts.all === 0
                  ? "Cada persona que escriba por email, WhatsApp o el formulario de tu web, y lo que le responden los agentes, aparecerá aquí."
                  : "A la izquierda, primero quien necesita a alguien del equipo."
              }
            />
          </div>
        )}
      </section>

      {/* Who they are */}
      {person ? (
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border xl:block">
          <PersonDetails person={person} />
        </aside>
      ) : null}
    </div>
  );
}

function PersonRow({
  row: r,
  href,
  active,
  showProject,
}: {
  row: InboxRow;
  href: string;
  active: boolean;
  showProject: boolean;
}) {
  const look = colorLook(r.projectColor);
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        scroll={false}
        aria-current={active ? "true" : undefined}
        className={cx(
          "flex gap-3 border-b border-ink-100 px-3 py-3 transition-colors hover:bg-ink-50",
          active && "bg-brand-50 hover:bg-brand-50",
        )}
      >
        <Avatar name={r.name} color={r.projectColor} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cx("min-w-0 flex-1 truncate text-sm", r.unread ? "font-semibold" : "font-medium")}
            >
              {r.name}
            </span>
            <span className={cx("shrink-0 text-xs", r.unread ? "font-medium text-accent" : "text-muted")}>
              {shortTime(r.lastAt)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            {r.channels.map((c) => (
              <ChannelIcon key={c} channel={c} />
            ))}
            <span className="min-w-0 truncate">
              {[r.company, showProject ? r.projectName : null].filter(Boolean).join(" · ")}
            </span>
            {showProject ? (
              <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", look.swatch)} />
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span
              className={cx("min-w-0 flex-1 truncate text-sm", r.unread ? "text-foreground" : "text-muted")}
            >
              {r.last
                ? `${r.last.direction === "outbound" ? "Nosotros: " : ""}${r.last.body}`
                : "Sin mensajes"}
            </span>
            {r.pending > 0 ? <Badge tone="warning">Por aprobar</Badge> : null}
            {r.handedOff && r.pending === 0 ? <Badge>En manos del equipo</Badge> : null}
            {r.unread ? (
              <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Sin leer" />
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

type TimelineItem =
  | { kind: "message"; at: Date; message: Person["messages"][number] }
  | { kind: "draft"; at: Date; action: Person["actions"][number] }
  | { kind: "event"; at: Date; action: Person["actions"][number] };

/** Messages, the agents' pending drafts and what else they did, in order. */
function timeline(person: Person): TimelineItem[] {
  const items: TimelineItem[] = person.messages.map((m) => ({ kind: "message", at: m.sentAt, message: m }));
  for (const a of person.actions) {
    if (a.status === "pending_approval") items.push({ kind: "draft", at: a.createdAt, action: a });
    // Sent messages are already in the thread.
    else if (
      (a.type === "email.send" || a.type === "whatsapp.send") &&
      (a.status === "succeeded" || a.status === "executing")
    )
      continue;
    else items.push({ kind: "event", at: a.createdAt, action: a });
  }
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const EVENT_STATUS: Record<string, string> = {
  succeeded: "hecho",
  failed: "ha fallado",
  rejected: "descartado",
  blocked: "bloqueado por las reglas",
  cancelled: "cancelado",
  deferred: "programado",
  approved: "aprobado",
  executing: "en marcha",
};

function Thread({
  person,
  backHref,
  showProject,
}: {
  person: Person;
  backHref: string;
  showProject: boolean;
}) {
  const name = personName(person);
  const items = timeline(person);
  const byAction = new Map(person.actions.map((a) => [a.id, a]));
  // A day's heading before its first item.
  const firstOfDay = new Set(
    items.filter((it, i) => i === 0 || dayKey(it.at) !== dayKey(items[i - 1].at)).map((it) => it),
  );
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 md:px-4">
        <Link
          href={backHref}
          scroll={false}
          aria-label="Volver a la lista"
          className="-ml-1 rounded-md p-1.5 text-muted hover:bg-ink-100 hover:text-foreground md:hidden"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="flex items-center gap-1.5 truncate text-xs text-muted">
            {[...new Set(person.conversations.map((c) => c.channel))].map((c) => (
              <ChannelIcon key={c} channel={c} />
            ))}
            {[person.contact?.companyName, showProject ? person.project?.name : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <PersonButtons
            handedOff={person.handedOff}
            closed={person.closed}
            change={changePersonAction.bind(null, person.key)}
          />
          <span className="xl:hidden">
            <ModalButton
              label="Ficha"
              icon={<Info className="size-4" />}
              title={name}
              variant="ghost"
              size="sm"
            >
              <PersonDetails person={person} />
            </ModalButton>
          </span>
        </span>
      </header>

      {person.handedOff ? (
        <p className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-ink-700">
          La lleva el equipo: el agente guarda sus mensajes pero no le responde.
        </p>
      ) : null}

      <ol className="flex-1 space-y-3 overflow-y-auto bg-ink-25 px-3 py-4 md:px-6">
        {items.map((item) => {
          const separator = firstOfDay.has(item) ? (
            <li
              key={`day-${dayKey(item.at)}`}
              className="py-1 text-center text-xs font-medium text-muted first-letter:uppercase"
            >
              {dayLabel(item.at)}
            </li>
          ) : null;
          if (item.kind === "message") {
            const m = item.message;
            const author = m.actionId ? byAction.get(m.actionId) : undefined;
            return [
              separator,
              <Message key={m.id} message={m} author={author?.actorType ?? null} name={name} />,
            ];
          }
          if (item.kind === "draft") return [separator, <Draft key={item.action.id} action={item.action} />];
          const a = item.action;
          return [
            separator,
            <li key={a.id} className="flex justify-center">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
                <Bot className="size-3.5 shrink-0" />
                <span className="truncate">
                  {getActionDefinition(a.type)?.summary(a.payload) ?? a.type} ·{" "}
                  {EVENT_STATUS[a.status] ?? a.status}
                </span>
              </span>
            </li>,
          ];
        })}
        <li aria-hidden>
          <ScrollToEnd count={items.length} />
        </li>
      </ol>

      <Composer
        channels={person.replyChannels}
        preferred={person.preferredChannel}
        subject={
          person.lastSubject
            ? /^re:/i.test(person.lastSubject)
              ? person.lastSubject
              : `Re: ${person.lastSubject}`
            : ""
        }
        reply={replyAction.bind(null, person.key)}
        note={noteAction.bind(null, person.key)}
      />
    </>
  );
}

function personName(person: Person) {
  const c = person.contact;
  return [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.email || c?.phone || "Sin nombre";
}

function Message({
  message: m,
  author,
  name,
}: {
  message: Person["messages"][number];
  author: string | null;
  name: string;
}) {
  if (m.direction === "internal") {
    return (
      <li className="mx-auto max-w-xl rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-ink-700">
          <StickyNote className="size-3.5" /> Nota de {m.fromAddress ?? "el equipo"} · solo la ve el equipo ·{" "}
          {shortTime(m.sentAt)}
        </span>
        <p className="whitespace-pre-wrap">{m.body}</p>
      </li>
    );
  }
  if (m.channel === "meet") {
    return (
      <li className="mx-auto max-w-xl rounded-lg border border-border bg-surface px-3 py-2 text-sm">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <Video className="size-3.5" /> Reunión · {formatDateTime(m.sentAt)}
        </span>
        {m.subject ? <p className="font-medium">{m.subject}</p> : null}
        <p className="line-clamp-6 whitespace-pre-wrap text-ink-700">{m.body}</p>
      </li>
    );
  }
  const ours = m.direction === "outbound";
  return (
    <li className={cx("flex", ours ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs md:max-w-[70%]",
          ours ? "rounded-br-md bg-brand-100" : "rounded-bl-md border border-border bg-surface",
        )}
      >
        <span className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <ChannelIcon channel={m.channel} />
          {ours ? (author === "agent" ? "El agente" : author === "user" ? "El equipo" : "Nosotros") : name}
          <span>· {shortTime(m.sentAt)}</span>
        </span>
        {m.subject && m.channel === "email" ? <p className="font-medium">{m.subject}</p> : null}
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
      </div>
    </li>
  );
}

/** Something an agent prepared and waits for a person: approve it as is, edit it, or discard it. */
function Draft({ action }: { action: Person["actions"][number] }) {
  const def = getActionDefinition(action.type);
  const p = action.payload as Record<string, unknown>;
  const notes = action.policyResults.filter((r) => r.outcome !== "allow");
  return (
    <li className="flex justify-end">
      <div className="w-full max-w-[85%] rounded-2xl border border-dashed border-accent bg-surface p-3 text-sm md:max-w-[70%]">
        <p className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="warning">Espera tu aprobación</Badge>
          <span className="text-muted">
            {action.agentType ? AGENT_LABELS[action.agentType] : "Agente"} · {def?.label ?? action.type}
          </span>
        </p>
        {notes.length ? (
          <ul className="mb-2 space-y-0.5 text-xs text-warning">
            {notes.map((n, i) => (
              <li key={i}>{n.reason}</li>
            ))}
          </ul>
        ) : null}
        <ActionForm
          action={approve.bind(null, action.id, action.type, action.payload)}
          submitLabel={def?.outbound ? "Aprobar y enviar" : "Aprobar"}
          className="space-y-2"
        >
          {action.type === "email.send" || action.type === "email.create_draft" ? (
            <>
              <Input name="to" defaultValue={(p.to as string[]).join(", ")} size="sm" aria-label="Para" />
              <Input name="subject" defaultValue={String(p.subject ?? "")} size="sm" aria-label="Asunto" />
              <Textarea
                name="body"
                defaultValue={String(p.body ?? "")}
                className="min-h-32"
                aria-label="Mensaje"
              />
            </>
          ) : action.type === "whatsapp.send" ? (
            <Textarea
              name="body"
              defaultValue={String(p.body ?? "")}
              className="min-h-24"
              aria-label="Mensaje"
            />
          ) : (
            <p className="text-ink-700">{def?.summary(action.payload) ?? action.type}</p>
          )}
        </ActionForm>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Descartar…</summary>
          <ActionForm
            action={reject.bind(null, action.id)}
            submitLabel="Descartar"
            submitVariant="dangerGhost"
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <Input
              name="reason"
              placeholder="Por qué (el agente lo tendrá en cuenta)"
              size="sm"
              className="min-w-0 flex-1"
            />
          </ActionForm>
        </details>
      </div>
    </li>
  );
}

/** Who the person is and what the agents know and did. */
function PersonDetails({ person }: { person: Person }) {
  const c = person.contact;
  const latest = person.conversations.find((x) => x.summary || x.nextStep) ?? person.conversations[0];
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex justify-between gap-3 py-1.5 text-sm">
        <dt className="text-muted">{label}</dt>
        <dd className="min-w-0 truncate text-right">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="space-y-5 p-4">
      <dl className="divide-y divide-ink-100">
        {row(
          "Email",
          c?.email ? (
            <a href={`mailto:${c.email}`} className="text-accent hover:underline">
              {c.email}
            </a>
          ) : null,
        )}
        {row("Teléfono", c?.phone)}
        {row(
          "Empresa",
          c?.companyName ? (
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5 text-muted" />
              {c.companyName}
            </span>
          ) : null,
        )}
        {row("Cargo", c?.jobTitle)}
        {row("Estado", c?.status ? <Badge>{CONTACT_STATUS_LABELS[c.status]}</Badge> : null)}
        {row("Encaje", c?.fitScore != null ? `${c.fitScore}/100` : null)}
        {row(
          "Proyecto",
          person.project ? (
            <Link href={`/app/projects/${person.project.id}`} className="text-accent hover:underline">
              {person.project.name}
            </Link>
          ) : null,
        )}
      </dl>

      {latest?.summary || latest?.nextStep ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Lo que dice el agente</h3>
          {latest.classification ? <Badge tone="accent">{latest.classification}</Badge> : null}
          {latest.summary ? <p className="text-sm">{latest.summary}</p> : null}
          {latest.nextStep ? (
            <p className="text-sm">
              <span className="text-muted">Siguiente paso: </span>
              {latest.nextStep}
            </p>
          ) : null}
        </section>
      ) : null}

      {person.meetings.length ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Reuniones</h3>
          {person.meetings.map((m) => (
            <Link
              key={m.id}
              href={`/app/projects/${m.projectId}/meetings/${m.id}`}
              className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-50"
            >
              <span className="min-w-0">
                <span className="block truncate">{m.title}</span>
                <span className="text-xs text-muted">{formatDateTime(m.startAt)}</span>
              </span>
              <Badge tone={TRANSCRIPT_STATUS[m.transcriptStatus].tone}>
                {TRANSCRIPT_STATUS[m.transcriptStatus].label}
              </Badge>
            </Link>
          ))}
        </section>
      ) : null}

      {person.runs.length ? (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Qué ha hecho el agente</h3>
          {person.runs.map((run) => (
            <details key={run.id} className="text-sm">
              <summary className="-mx-2 cursor-pointer rounded-md px-2 py-1 hover:bg-ink-50">
                {formatDateTime(run.startedAt)} · ${run.costUsd.toFixed(3)}
              </summary>
              <ol className="mt-1 space-y-1 text-xs text-muted">
                {run.steps
                  .filter((s) => s.type !== "tool_result")
                  .map((step, i) => (
                    <li key={i}>
                      {step.type === "text" ? (
                        <span className="text-foreground">{step.text}</span>
                      ) : (
                        <code>→ {step.name}</code>
                      )}
                    </li>
                  ))}
              </ol>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
