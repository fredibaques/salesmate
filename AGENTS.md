<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SalesMate conventions

- Read `docs/ARCHITECTURE.md` before changing server code.
- Every domain table has `org_id` and an RLS policy; access it only inside `withTenant()` (`src/server/db/tenant.ts`).
- Every external effect goes through `proposeAction()` in `src/server/gateway/gateway.ts`; never call a connector directly from UI or agents.
- Schema changes: edit `src/server/db/schema/*`, then `pnpm db:generate` and review the SQL.
- Before committing: `pnpm lint && pnpm typecheck && pnpm test`.
- UI copy is in Spanish; code, identifiers and comments in English.
- UI: follow `docs/DESIGN.md` and build screens from `src/components/ui.tsx`. In short: every page starts with `PageHeader`; entities (projects, agents, connections, knowledge) are `EntityCard`s in a `CardGrid`, records are rows (`RowLink`/`Table`); on/off is a `SwitchButton`; creating opens a modal (`ModalButton` + `ActionForm`, which closes it and shows a toast); empty lists use `EmptyState`; page-level messages use `Notice`; buttons always come from `buttonClass` (variants and sizes in `docs/DESIGN.md`, live at `/app/design`). Light theme only. Everything clickable needs a hover state.
