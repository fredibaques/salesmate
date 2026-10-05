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
- UI patterns: forms that create something open from a button in a modal (`ModalButton` + `ActionForm`, which closes the modal and shows a toast on success); empty lists use `EmptyState` with a title, a short explanation and the action that fills them; clickable rows use `RowLink`. Everything clickable needs a hover state.
