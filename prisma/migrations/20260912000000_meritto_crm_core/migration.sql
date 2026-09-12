CREATE TABLE "crm_teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "manager_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crm_teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_teams_name_key" ON "crm_teams"("name");
CREATE INDEX "crm_teams_manager_id_is_active_idx" ON "crm_teams"("manager_id", "is_active");

ALTER TABLE "app_users" ADD COLUMN "team_id" UUID;

ALTER TABLE "crm_contacts"
    ADD COLUMN "owner_id" UUID,
    ADD COLUMN "medium" TEXT,
    ADD COLUMN "campaign_name" TEXT,
    ADD COLUMN "is_favourite" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "status_reason" TEXT,
    ADD COLUMN "notes_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "first_contacted_at" TIMESTAMPTZ(6),
    ADD COLUMN "last_activity_at" TIMESTAMPTZ(6);

ALTER TABLE "crm_activities" ADD COLUMN "actor_id" UUID;
ALTER TABLE "crm_tasks" ADD COLUMN "assignee_id" UUID;

CREATE TABLE "crm_assignment_history" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "from_owner_id" UUID,
    "to_owner_id" UUID,
    "changed_by_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_assignment_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_saved_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crm_saved_views_pkey" PRIMARY KEY ("id")
);

DROP INDEX IF EXISTS "crm_contacts_stage_id_assigned_to_idx";
CREATE INDEX "app_users_team_id_is_active_idx" ON "app_users"("team_id", "is_active");
CREATE INDEX "crm_contacts_stage_id_owner_id_idx" ON "crm_contacts"("stage_id", "owner_id");
CREATE INDEX "crm_contacts_owner_id_next_follow_up_idx" ON "crm_contacts"("owner_id", "next_follow_up");
CREATE INDEX "crm_activities_actor_id_created_at_idx" ON "crm_activities"("actor_id", "created_at");
CREATE INDEX "crm_tasks_assignee_id_status_due_at_idx" ON "crm_tasks"("assignee_id", "status", "due_at");
CREATE INDEX "crm_tasks_contact_id_status_idx" ON "crm_tasks"("contact_id", "status");
CREATE INDEX "crm_assignment_history_contact_id_created_at_idx" ON "crm_assignment_history"("contact_id", "created_at");
CREATE INDEX "crm_assignment_history_to_owner_id_created_at_idx" ON "crm_assignment_history"("to_owner_id", "created_at");
CREATE UNIQUE INDEX "crm_saved_views_user_id_name_key" ON "crm_saved_views"("user_id", "name");
CREATE INDEX "crm_saved_views_user_id_is_default_idx" ON "crm_saved_views"("user_id", "is_default");

ALTER TABLE "app_users" ADD CONSTRAINT "app_users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "crm_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_teams" ADD CONSTRAINT "crm_teams_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_from_owner_id_fkey" FOREIGN KEY ("from_owner_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_to_owner_id_fkey" FOREIGN KEY ("to_owner_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "crm_contacts" AS contact
SET "owner_id" = app_user."id"
FROM "app_users" AS app_user
WHERE contact."assigned_to" IS NOT NULL
  AND (contact."assigned_to" = app_user."full_name" OR contact."assigned_to" = app_user."email");

UPDATE "crm_tasks" AS task
SET "assignee_id" = app_user."id"
FROM "app_users" AS app_user
WHERE task."assigned_to" IS NOT NULL
  AND (task."assigned_to" = app_user."full_name" OR task."assigned_to" = app_user."email");
