# Design rules

How SalesMate shows information and lets people act on it. Every screen is
built from the components in `src/components/` following these rules; when a
screen needs something new, add it here and as a component, not inline.

## 1. Shell

- The sidebar is exactly one screen tall and never scrolls with the page.
  Only its project list scrolls inside it when there are many projects.
- Content sits in a centred column (`max-w-6xl`, `px-8 py-8`).
- Global sections (Panel, Bandeja, Copiloto, Conexiones, Exclusiones,
  Auditoría) live in the sidebar; everything about one project lives under
  that project, in tabs.

## 2. Page anatomy

Every page reads top to bottom the same way:

1. **`PageHeader`**: optional back link, title (with its status badge),
   one line saying what the page is for, and the page's actions on the
   right. Top-level pages use the default `level="page"` (h1); pages inside
   a project or an agent use `level="section"` (h2) under the project
   header.
2. **Tabs** (`TabLink`) when an entity has several facets (project, agent).
3. **Content**: a grid of entity cards, or sections (`Card` with title,
   description and actions), separated by `space-y-6`.

One primary (filled) button per view: the main thing to do there. Others
are `secondary` or `ghost`.

## 3. Entities are cards

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

## 4. Records are rows

Things that happen (conversations, approvals, audit events, rules,
exclusions) are rows in a list or `Table`. A row that opens a detail uses
`RowLink` (or a link with `after:absolute after:inset-0` in a table row).
Remove actions on a row are a `dangerGhost` icon button with an
`aria-label`.

## 5. States

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

## 6. Creating, editing, removing

- Creating opens a modal from a button (`ModalButton` + `ActionForm`): the
  modal closes and a toast confirms on success; errors stay next to the
  button.
- Editing an entity's settings happens on its page, in sections, with one
  «Guardar» per form.
- Removing asks first (`ConfirmForm`) and lives in the entity's header
  (`dangerGhost`), never as the most prominent action.

## 7. Copy

- Spanish, sentence case, «tú». Buttons are verbs («Añadir agente», «Subir
  fichero»).
- Explain what something does for the user, not how it is built. No
  internal terms (playbook, chunk, scope) in the UI.
- One sentence under each title. Hints under fields only when the field
  is not obvious.

## 8. Visual tokens

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
