# Design rules

How SalesMate shows information and lets people act on it. Every screen is
built from the components in `src/components/` following these rules; when a
screen needs something new, add it here and as a component, not inline.

## 1. Shell

- The sidebar (`Sidebar`, `SidebarBrand`, `SidebarSection`, `SidebarItem`,
  `UserMenu` in `src/components/sidebar.tsx`) is exactly one screen tall and
  never scrolls with the page. Only its project list (`grow`) scrolls inside
  it. Counts use `CountBadge`; projects show a `SidebarDot` with their
  initial. The person's own settings live in the `UserMenu` at the bottom:
  **Mi cuenta** (Perfil, Seguridad, Organización), switching organization and
  «Salir».
- Content takes the full width of the window (`px-8`); forms keep a reading
  width (`max-w-3xl`). The page reserves the scrollbar's space
  (`scrollbar-gutter: stable`) so nothing shifts when a page gets long.
- The sidebar is light grey (`bg-sidebar`), the content area almost white
  (`bg-background`); the active entry is a white pill.
- **One title per screen.** A section's header and tabs (a project,
  Configuración) show only on the section's own pages (`SectionChrome`);
  deeper pages (an agent, a document, a new connection) bring their own
  header. Tab pages don't repeat the tab's name: their actions go in a
  `Toolbar`.
- **Breadcrumbs** sit top left on every sub-page (`@crumbs` slot in
  `src/app/app`, rules in `src/app/app/crumbs.ts`). There are no «back»
  buttons.
- **Loading**: every main route has a `loading.tsx` with skeletons
  (`src/components/skeleton.tsx`) shaped like the page that is coming.
- The sidebar has three sections and the projects:
  - **Panel**: overview.
  - **Copilot**: the assistant and «Por aprobar» (what the agents want to do).
  - **Configuración**: Conexiones, Exclusiones and Auditoría, shared by every
    project.
- A project has four tabs: **Agentes** (its home), **Conocimiento** (documents
  and tables), **Conversaciones** and **Ajustes** (General: project data,
  «Oferta y cliente» and contact hours; and Reglas y exclusiones).
- Light theme only.

## 2. Page anatomy

Every page reads top to bottom the same way:

1. **`PageHeader`**: title (with its status badge)
   and the page's actions on the right. **No paragraph under titles**: when
   a page or a card needs explaining, pass `tip` and it shows as a «?» with
   a tooltip next to the title. Top-level pages use the default `level="page"` (h1); pages inside
   a project or an agent use `level="section"` (h2) under the project
   header.
2. **Tabs** (`Tabs` + `TabLink`) when an entity has several facets (project,
   agent, Configuración). They wrap, never scroll. A tab stays active on its
   sub-pages (`also`). Inside a tab, related pages use pill sub-tabs
   (`SubTabs` + `SubTabLink`), e.g. Ajustes → General · Reglas y exclusiones.
3. **Content**: a grid of entity cards, or sections (`Card` with title,
   optional `tip` and actions), separated by `space-y-6`.

## 3. Buttons

Everything that acts is built with `buttonClass()` (or `Button`, `LinkButton`,
`ModalButton`, `ActionForm`, which use it). Never style a button by hand.

| Variant | Use |
|---|---|
| `primary` | The main action of the view. One per view. |
| `secondary` | Other actions with weight. |
| `ghost` | Discreet actions: headers, rows, next to a primary, «Cancelar». |
| `danger` | Confirming something that can't be undone. |
| `dangerGhost` | Remove/delete at rest. |

Sizes: `sm` (rows, toolbars, dense cards), `md` (default), `lg` (empty states
and landing actions). Icons go before the label and size with the button.
`iconOnly` makes a square button and always needs an `aria-label`. `block`
fills the width (forms on their own, like sign-in).

The live reference is at `/app/design`.

## 4. Inputs

Every field is a `Field` (label, `tip`, `hint`, `error`, `optional`) around a
control from `src/components/form-controls.tsx`. Never style a control by
hand.

| Control | Use |
|---|---|
| `Input` | Text, numbers, dates, URLs. `icon` on the left (search, user), `suffix` on the right for units («min», «€»). |
| `PasswordInput` | Passwords, with a button to show them. |
| `Select`, `Textarea` | Choosing from a list; long text. |
| `Choice` | A checkbox or radio with its label and an optional description. `card` for options that need explaining (how a conversation ends). |
| `Chip` | Small toggles in a row, e.g. the days of the week. |
| `Segmented` | Two to four exclusive options side by side (B2B · B2C). |
| `ChipSelect` | Several answers from a ready-made list plus «Otros» (zones, who decides). |
| `ListInput` | A growing list of short texts, one per row (segments, problems). |
| `PairListInput` | Pairs of texts per row (an objection and its answer). |
| `FormSection` | Titled block inside a long form. |

Forms are **one column**. When the answers are predictable, offer them
(selector, chips, option cards with a «Personalizado» way out) instead of a
blank text box: time zone, languages, tone, who decides.

Sizes `sm` (tables, toolbars), `md` (default), `lg` (sign-in); `invalid` or
`error` mark a wrong value. Use `group` on a `Field` that holds checkboxes,
radios or chips. `hint` is a short line under the control for what is not
obvious; anything about how the platform works goes in `tip`.

## 5. Help

Explanations live in tooltips, not on the page: `InfoTip` (the «?» next to a
title or a label) or `Tooltip` around any element. One or two sentences.
Empty states and notices still explain themselves in the page.

## 6. Chat

Conversations with an AI are built from `src/components/chat.tsx`:
`ChatPanel` (optional toolbar, messages, composer), `ChatMessages` (follows
the conversation), `ChatMessage` (assistant on the left with its avatar,
person on the right, `footer` for sources or proposed actions, `tone="danger"`
for errors), `TypingIndicator`, `ChatWelcome` with `SuggestionButton`s, and
`ChatComposer` (Enter sends, Shift+Enter adds a line, grows with the text).

## 7. Entities are cards

Things the user creates or owns and opens to configure (projects, agents,
connections, knowledge sources, tools in the catalog) are `EntityCard`s in a
`CardGrid`:

- icon or avatar, name, one line of meta (`Meta`: «PDF · 2 MB»), status
  badge on the right;
- a short description of what it is or what it does now;
- footer for direct controls (an on/off `SwitchButton`, «Probar conexión»)
  and secondary facts (dates, counts).

With `href` the whole card opens the entity; footer controls stay
independently clickable. Variants:

- `default`: exists.
- `placeholder` (dashed): can be added right here; its footer has the «Añadir»
  button.
- `disabled` (dashed, faded, «Próximamente» badge): not available yet. Show it
  anyway so people know it is coming.

Show the full set of possible entities when it is small and fixed (all
agent types, all tools), so what is active, what can be added and what is
coming are visible together.

## 8. Records are rows

Things that happen (conversations, approvals, audit events, rules,
exclusions) are rows in a list or `Table`. A row that opens a detail uses
`RowLink` (or a link with `after:absolute after:inset-0` in a table row).
Remove actions on a row are a `dangerGhost` icon button with an
`aria-label`.

## 9. States

- **On/off** (an agent, a project): `SwitchButton` inside a form whose server
  action flips it. Green = acting; grey «En pausa» = not acting.
- **Status badges** use one vocabulary and tone: success = working /
  connected / active, warning = paused or needs attention, danger = error or
  blocked, accent = waiting for the user, neutral = informative.
- **Empty**: `EmptyState` with an icon, what goes here, why it matters and
  the action that fills it. The page header hides its «Añadir» button while
  the empty state shows its own.
- **Something off or worth knowing**: `Notice` (info, success, warning,
  danger) with an optional action to fix it. Not coloured paragraphs.
- **Loading** inside a form: the submit button says «Un momento…»; a switch
  shows «…».

## 10. Creating, editing, removing

- Creating opens a modal from a button (`ModalButton` + `ActionForm`): the
  modal closes and a toast confirms on success; errors stay next to the
  button. Modals have a title and no description.
- Creating something that needs a first configuration (an agent) is a
  `Wizard`: one step per decision, each checked before moving on, a
  «Revisar» step that summarises the choices, and one server action at the
  end. Afterwards it is edited on its own page.
- Editing an entity's settings happens on its page, in sections, with one
  «Guardar» per form.
- Removing asks first (`ConfirmForm`) and lives in the entity's header
  (`dangerGhost`), never as the most prominent action.

## 11. Copy

- Spanish, sentence case, «tú». Buttons are verbs («Añadir agente», «Subir
  fichero»).
- Explain what something does for the user, not how it is built. No
  internal terms (playbook, chunk, scope) in the UI.
- Nothing under titles; how-to explanations go in tooltips. Hints under
  fields only when the field is not obvious.

## 12. Design line

The tokens live in `src/app/globals.css` (`@theme`); the live reference is
`/app/design`. Components use the semantic names, so a change of brand is a
change of tokens, not of components.

**Personality.** Calm, precise and warm: a tool that does sales work for
you under your control. Mostly white and ink, with the brand colour kept for
what acts or is active. The AI gradient is a signature, not a decoration.

### Colour

| Scale | Use |
|---|---|
| **Iris** (brand, `iris-50…950`, primary `iris-600` #5B45E0) | Primary actions, links, active navigation, focus, selected options. |
| **Ink** (neutrals, `ink-0…950`) | Text (`ink-900`), secondary text (`ink-500`), page (`ink-50`), surfaces (`ink-0`), borders (`ink-200`, `ink-300` on hover). |
| **Leaf / Amber / Coral** (status) | Working · needs attention · error. Tint `50` as background, `100` as border, `700` as text. |
| **AI gradient** (`bg-ai`: iris → violet → orchid) | Only the logo and the assistant (avatar, chat welcome). |

Semantic names (use these in components): `background`, `surface`,
`foreground`, `muted`, `border`, `border-strong`, `accent`, `accent-hover`,
`accent-foreground`, `success`, `warning`, `danger`. Every text colour
passes WCAG AA on its background. Never raw hex values in components,
except a tool's brand colour in its avatar.

### Typography

| Role | Face | Size / line | Weight |
|---|---|---|---|
| Page title (h1) | Plus Jakarta Sans | 24/32 (`text-2xl`) | 600, tight tracking |
| Section title (h2) | Plus Jakarta Sans | 20/28 (`text-xl`) | 600 |
| Card title (h3) | Plus Jakarta Sans | 16/24 (`text-base`) | 600 |
| Interface text | Inter | 14/20 (`text-sm`) | 400; labels and buttons 500 |
| Secondary data | Inter | 12/16 (`text-xs`, `text-muted`) | 400 |
| Code, identifiers | JetBrains Mono | 12/16 | 400 |

Headings take the display face automatically. Figures in tables and
counters use `tabular-nums`. The fonts are self-hosted (`@fontsource-variable`).

### Elevation and shape

| Shadow | Use |
|---|---|
| `shadow-xs` | Controls and cards at rest. |
| `shadow-md` | A card under the pointer. |
| `shadow-lg` | Menus, tooltips, toasts. |
| `shadow-xl` | Modals (with a blurred ink backdrop). |
| `shadow-brand` | Primary button: light top edge and an iris-tinted drop. |

Radius: `rounded-lg` (8) for buttons and fields, `rounded-xl` (12) for
cards and panels, `rounded-2xl` (16) for modals and chat bubbles,
`rounded-full` for badges and avatars.

### Spacing

A 4 px grid. Inside a group (chips, buttons) `gap-2`; entity icon and text
`gap-3`; cards in a grid `gap-4`; inside a card `p-5` and `space-y-5`
between fields; between sections `space-y-6`; page margins `px-8 py-8`;
`mb-6` under a page header. Forms are one column.

### Details

- Icons: lucide, `size-4` in buttons and rows, inside an `IconTile` for
  entities.
- Everything clickable has `cursor-pointer` (global) and a visible hover
  state; focus is a 2px accent ring. Transitions are 150 ms.
- Logo: `Logo` (two speech bubbles on the AI gradient); the favicon is
  `src/app/icon.svg`.
