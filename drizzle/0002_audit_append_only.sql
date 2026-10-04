-- The audit log is append-only for the application role: RLS already has no
-- UPDATE/DELETE policy, and the privileges are revoked as a second barrier.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM salesmate_app;
