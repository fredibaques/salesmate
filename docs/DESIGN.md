# Design rules

How SalesMate shows information and lets people act on it. Every screen is
built from the components in `src/components/` following these rules; when a
screen needs something new, add it here and as a component, not inline.

## 1. Shell

- The sidebar is exactly one screen tall and never scrolls with the page.
  Only its project list scrolls inside it when there are many projects.
- Content sits in a centred column (`max-w-6xl`, `px-8 py-8`).
- The sidebar has three sections and the projects:
  - **Panel**: overview.
  - **Copilot**: the assistant and «Por aprobar» (what the agents want to do).
  - **Configuración**: Conexiones, Exclusiones and Auditoría, shared by every
    project.
- A project has four tabs: **Agentes** (its home), **Conocimiento** (documents
  and tables, and «Oferta y cliente»), **Conversaciones** and **Ajustes**
  (general data, and rules and exclusions).
- Light theme only.

## 2. Page anatomy

Every page reads top to bottom the same way:

1. **`PageHeader`**: optional back link, title (with its status badge),
   one line saying what the page is for, and the page's actions on the
   right. Top-level pages use the default `level="page"` (h1); pages inside
   a project or an agent use `level="section"` (h2) under the project
   header.
2. **Tabs** (`Tabs` + `TabLink`) when an entity has several facets (project,
   agent, Configuración). They wrap, never scroll. A tab stays active on its
   sub-pages (`also`). Inside a tab, related pages use pill sub-tabs
   (`SubTabs` + `SubTabLink`), e.g. Conocimiento → Documentos · Oferta y cliente.
3. **Content**: a grid of entity cards, or sections (`Card` with title,
   description and actions), separated by `space-y-6`.

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

## 4. Entities are cards

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

## 5. Records are rows

Things that happen (conversations, approvals, audit events, rules,
exclusions) are rows in a list or `Table`. A row that opens a detail uses
`RowLink` (or a link with `after:absolute after:inset-0` in a table row).
Remove actions on a row are a `dangerGhost` icon button with an
`aria-label`.

## 6. States

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

## 7. Creating, editing, removing

- Creating opens a modal from a button (`ModalButton` + `ActionForm`): the
  modal closes and a toast confirms on success; errors stay next to the
  button.
- Editing an entity's settings happens on its page, in sections, with one
  «Guardar» per form.
- Removing asks first (`ConfirmForm`) and lives in the entity's header
  (`dangerGhost`), never as the most prominent action.

## 8. Copy

- Spanish, sentence case, «tú». Buttons are verbs («Añadir agente», «Subir
  fichero»).
- Explain what something does for the user, not how it is built. No
  internal terms (playbook, chunk, scope) in the UI.
- One sentence under each title. Hints under fields only when the field
  is not obvious.

## 9. Visual tokens

- Colours come from the theme tokens (`accent`, `success`, `warning`,
  `danger`, `muted`, `border`, `surface`, `background`); never raw colours
  except a tool's brand colour in its avatar.
- Radius: `rounded-xl` for cards and panels, `rounded-lg` for controls.
- Spacing: `p-5` inside cards, `gap-4` in grids, `space-y-6` between
  sections, `mb-6` under a page header.
- Icons: lucide, `size-4` in buttons and rows, inside an `IconTile` for
  entities.
- Everything clickable has `cursor-pointer` (global) and a visible hover
  state; focus is a 2px accent ring.
