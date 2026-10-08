# Design rules

How SalesMate shows information and lets people act on it. Every screen is
built from the components in `src/components/` following these rules; when a
screen needs something new, add it here and as a component, not inline.

## 1. Shell

- The sidebar (`Sidebar`, `SidebarBrand`, `SidebarSection`, `SidebarItem`,
  `UserMenu` in `src/components/sidebar.tsx`) is exactly one screen tall and
  never scrolls with the page. Only its project list (`grow`) scrolls inside
  it. Counts use `CountBadge`; projects show a `SidebarDot` with their
  initial. Each project is a `SidebarGroup`: its agents hang below it, one
  level down, and a chevron shows or hides them (open by itself while on the
  project's pages; a paused agent shows a grey dot). The person's own settings live in the `UserMenu` at the bottom:
  **Mi cuenta** (Perfil, Seguridad, Organización), switching organization and
  «Salir».
- Content takes the full width of the window (`px-8`); forms keep a reading
  width (`max-w-3xl`). The page reserves the scrollbar's space
  (`scrollbar-gutter: stable`) so nothing shifts when a page gets long.
- Sidebar and content are white; a hairline separates them. The active
  entry is a light grey row with its icon in the accent colour.
- **One title per screen.** A section's header and tabs (a project,
  Configuración) show only on the section's own pages (`SectionChrome`);
  deeper pages (an agent, a document, a new connection) bring their own
  header. Tab pages don't repeat the tab's name: their actions go in a
  `Toolbar`.
- **Breadcrumbs** go in a bar across the top of the content, sticky, and
  only one level below a section: an agent, a document, a base, a new
  connection. A section's own pages (a project and its tabs, a settings
  page) have its header and tabs instead, so they get no bar (`@crumbs`
  slot in `src/app/app`, rules in `src/app/app/crumbs.ts`). Agents hang
  straight from their project in the trail, as in the sidebar. There are
  no «back» buttons.
- **Loading**: every main route has a `loading.tsx` with skeletons
  (`src/components/skeleton.tsx`) shaped like the page that is coming.
- The sidebar has four entries and the projects:
  - **Panel**: the home. Copilot comes first, always: the greeting is the
    page's title and a large box to ask or ask for something (`ChatHero`,
    with the project to talk about, ready-made questions and «O empieza por»
    shortcuts). Until it can answer (no AI connected, no project) the box
    shows disabled with a notice that says how to fix it. Once a
    conversation starts it takes the page. Below it: the
    first steps, recent tables, projects, what waits for approval and the
    latest activity. Copilot has no entry of its own.
  - **Tablas**: every table of every project (the prospect bases the agents
    fill), most recently active first, and «Nueva tabla» (pick the project).
  - **Por aprobar**: what the agents want to do and waits for a person, with
    its count. Its own entry, because deciding is the daily job.
  - **Configuración**: Conexiones, IA, Exclusiones and Auditoría, shared by
    every project.
- A project has five tabs: **Resumen** (its home: what is left to set it up,
  its agents and «Añadir agente»), **Prospectos**, **Conocimiento**
  (documents and tables), **Conversaciones** and **Ajustes** (General:
  project data, «Oferta y cliente» and contact hours; and Reglas y
  exclusiones). The summary shows only the agents the project has; adding
  one picks its kind in a modal.
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
Records with many user-defined columns (prospect bases) use `DataGrid`
(`components/data-grid.tsx`): it scrolls inside its own box, keeps the header
and the first column in place, and each column header sorts by link.
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
  button and keep what was typed (forms and wizards are submitted by hand,
  so React doesn't reset them when the server says no). Modals have a title
  and no description.
- Creating something that needs a first configuration (an agent) is a
  `Wizard`: one step per decision, each checked before moving on, a
  «Revisar» step that summarises the choices, and one server action at the
  end. Afterwards it is edited on its own page.
- Connecting something from outside (an AI account) is a `Wizard` that
  doubles as the guide: choose, how to get the credential in the provider's
  console (numbered steps with a button to each console page, and what
  usually goes wrong), then paste it. The guide lives where it is needed,
  not in a separate help page.
- A record in a long table (a row of a prospect base) opens in a `Drawer`:
  a side panel over the table, in the URL (`?row=<id>`, `?row=new` to add
  one), with the record's form; saving closes it like a modal. The table
  stays behind, with its filters and page.
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

**Personality.** Lima, minimalist, slightly rounded, «Mate» logo (chosen in
October 2026). Everything is white and flat: the sidebar is set apart by a
hairline, the active entry is a light grey row. The lime fills only what acts
or is selected, with dark text on top. Borders separate things; nothing casts
a shadow at rest. No gradients.

### Colour

| Scale | Use |
|---|---|
| **Brand** (lime, `brand-50…950`) | `brand-500` (#84CC16) fills the primary button, selected chips and options, counters, the user's chat bubble and the logo, always with `brand-950` text. `brand-700` (#4D7C0F) is the readable shade: links, active tabs and navigation, borders of selected things, focus. Tints `brand-50/100` for soft backgrounds. |
| **Ink** (neutral greys, `ink-0…950`) | Text (`ink-900`), secondary text (`ink-500`), page, sidebar and surfaces (`ink-0`), active and hover rows (`ink-100`, `ink-50`), borders (`ink-200`, `ink-300` on hover). |
| **Leaf / Amber / Coral** (status) | Working · needs attention · error. Dot `500`, text `700`, tint `50` for notices. |

Semantic names (use these in components): `background`, `surface`,
`sidebar`, `foreground`, `muted`, `border`, `border-strong`, `accent` and
`accent-hover` (text, links, active, focus), `primary`, `primary-hover` and
`primary-foreground` (the lime fill and the text on it), `success`,
`warning`, `danger`. Never put text on lime in white, and never use
`brand-500` for text on white: it doesn't read. Every text colour passes
WCAG AA on its background.

### Typography

| Role | Face | Size / line | Weight |
|---|---|---|---|
| Page title (h1) | Inter | 24/32 (`text-2xl`) | 600, tight tracking |
| Section title (h2) | Inter | 20/28 (`text-xl`) | 600 |
| Card title (h3) | Inter | 16/24 (`text-base`) | 600 |
| Interface text | Inter | 14/20 (`text-sm`) | 400; labels and buttons 500 |
| Secondary data | Inter | 12/16 (`text-xs`, `text-muted`) | 400 |
| Code, identifiers | JetBrains Mono | 12/16 | 400 |

One family for everything. Figures in tables and counters use
`tabular-nums`. The fonts are self-hosted (`@fontsource-variable`).

### Elevation and shape

No shadows at rest: cards, controls and buttons are flat and bordered. A
card under the pointer darkens its border (and a very light `shadow-md`).
Only what floats casts a shadow: menus, tooltips and toasts (`shadow-lg`),
modals (`shadow-xl`, with a blurred backdrop).

Radius (slightly rounded): `rounded-lg` = 4 px for buttons and fields,
`rounded-xl` = 6 px for cards and panels, `rounded-2xl` = 8 px for modals and
chat bubbles, `rounded-full` for avatars and dots. Badges are a coloured dot
and a word, without a box.

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
- Logo: `Logo`, «Mate»: two overlapping circles (you and your agent) in
  `brand-950` on a flat `brand-500` tile; the favicon is `src/app/icon.svg`.
