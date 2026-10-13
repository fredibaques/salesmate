CREATE TABLE "invitation_projects" (
	"invitation_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	CONSTRAINT "invitation_projects_invitation_id_project_id_pk" PRIMARY KEY("invitation_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_projects" ADD CONSTRAINT "invitation_projects_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_projects" ADD CONSTRAINT "invitation_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_projects" ADD CONSTRAINT "invitation_projects_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE POLICY "invitation_projects_tenant_isolation" ON "invitation_projects" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "project_members_tenant_isolation" ON "project_members" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
-- Members keep what they saw until now: every project of their organization.
INSERT INTO "project_members" ("project_id", "user_id", "org_id")
SELECT p."id", m."user_id", p."org_id"
FROM "projects" p
JOIN "member" m ON m."organization_id" = p."org_id"
WHERE m."role" = 'member'
ON CONFLICT DO NOTHING;
