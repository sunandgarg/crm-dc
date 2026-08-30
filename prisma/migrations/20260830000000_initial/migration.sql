-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'counsellor',
    "team" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_approved" BOOLEAN NOT NULL DEFAULT true,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" TEXT DEFAULT 'counsellor',
    "is_approved" BOOLEAN DEFAULT true,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" TEXT,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "college_id" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "source" TEXT DEFAULT 'dekhocampus',
    "medium" TEXT DEFAULT 'dekhocampus',
    "campaign" TEXT DEFAULT 'API',
    "api_type" TEXT DEFAULT 'nopaperforms',
    "leads_per_minute" INTEGER DEFAULT 5,
    "api_timeout_seconds" INTEGER DEFAULT 30,
    "default_push_concurrency" INTEGER DEFAULT 1,
    "column_mapping" JSONB DEFAULT '{}',
    "payload_wrapper" TEXT DEFAULT 'object',
    "auth_type" TEXT DEFAULT 'secret_key',
    "auth_header_key" TEXT,
    "auth_header_value" TEXT,
    "custom_headers" JSONB DEFAULT '{}',
    "default_values" JSONB DEFAULT '{}',
    "sample_csv_content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "state" TEXT,
    "city" TEXT,
    "contact_person_name" TEXT,
    "contact_person_email" TEXT,
    "contact_person_mobile" TEXT,
    "daily_lead_limit" INTEGER,
    "daily_limit" INTEGER,
    "daily_pushed_count" INTEGER NOT NULL DEFAULT 0,
    "daily_count_reset_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto_retry_enabled" BOOLEAN DEFAULT false,
    "auto_retry_max_attempts" INTEGER DEFAULT 0,
    "auto_retry_delay_minutes" INTEGER DEFAULT 5,
    "admission_commitment" INTEGER,
    "deal_price" DECIMAL(12,2),
    "gst_inclusive" BOOLEAN,
    "publisher_id" TEXT,
    "publisher_panel_url" TEXT,
    "utm_link" TEXT,
    "whatsapp_group_link" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_batches" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "total_leads" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "processed_count" INTEGER DEFAULT 0,
    "current_lead_index" INTEGER DEFAULT 0,
    "status" TEXT DEFAULT 'pending',
    "is_paused" BOOLEAN DEFAULT false,
    "is_cancelled" BOOLEAN DEFAULT false,
    "leads_per_minute" INTEGER,
    "csv_data" TEXT,
    "api_config" JSONB,
    "source_label" TEXT,
    "error_message" TEXT,
    "scheduled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "upload_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "address" TEXT,
    "state" TEXT,
    "city" TEXT,
    "course" TEXT,
    "specialization" TEXT,
    "lead_source" TEXT,
    "lead_medium" TEXT,
    "lead_campaign" TEXT,
    "extra_data" JSONB DEFAULT '{}',
    "status" TEXT DEFAULT 'pending',
    "api_response" TEXT,
    "retry_count" INTEGER DEFAULT 0,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_logs" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "lead_id" UUID,
    "batch_id" UUID,
    "user_id" TEXT,
    "application_no" TEXT,
    "trigger_point" TEXT DEFAULT 'Lead Upload',
    "webhook_id" TEXT,
    "data_push_type" TEXT DEFAULT 'Real Time',
    "email" TEXT,
    "mobile" TEXT,
    "form" TEXT,
    "status" TEXT NOT NULL,
    "response" TEXT,
    "lead_data" JSONB,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "university_id" UUID,
    "stage_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT NOT NULL,
    "alternate_mobile" TEXT,
    "state" TEXT,
    "city" TEXT,
    "course" TEXT,
    "specialization" TEXT,
    "source" TEXT,
    "priority" TEXT DEFAULT 'Medium',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lead_score" INTEGER DEFAULT 50,
    "lead_quality" TEXT,
    "lead_score_updated_at" TIMESTAMPTZ(6),
    "assigned_to" TEXT,
    "notes" TEXT,
    "custom_fields" JSONB DEFAULT '{}',
    "last_contacted_at" TIMESTAMPTZ(6),
    "next_follow_up" TIMESTAMPTZ(6),
    "expected_enrollment_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "outcome" TEXT,
    "duration_minutes" INTEGER,
    "scheduled_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" UUID NOT NULL,
    "contact_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assigned_to" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_cities" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_specializations" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "course" TEXT NOT NULL,
    "specialization" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_specializations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_columns" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "column_name" TEXT NOT NULL,
    "column_key" TEXT NOT NULL,
    "is_required" BOOLEAN DEFAULT false,
    "sort_order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_column_values" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "column_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "parent_column_id" UUID,
    "parent_value_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_column_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "priority" INTEGER DEFAULT 1,
    "status" TEXT DEFAULT 'Active',
    "conditions" JSONB DEFAULT '[]',
    "actions" JSONB DEFAULT '[]',
    "retry_enabled" BOOLEAN DEFAULT true,
    "max_retries" INTEGER DEFAULT 2,
    "retry_after" TEXT DEFAULT '5min',
    "triggered_count" INTEGER DEFAULT 0,
    "success_count" INTEGER DEFAULT 0,
    "fail_count" INTEGER DEFAULT 0,
    "last_triggered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "template_id" UUID,
    "integration_id" UUID,
    "recipient_count" INTEGER DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "send_at" TIMESTAMPTZ(6),
    "timezone" TEXT DEFAULT 'UTC',
    "recurrence" TEXT,
    "ab_test_config" JSONB,
    "recipient_filter" JSONB,
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_mappings" (
    "id" UUID NOT NULL,
    "original_url" TEXT NOT NULL,
    "short_code" TEXT NOT NULL,
    "header" TEXT,
    "domain" TEXT,
    "title" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "custom_code" BOOLEAN NOT NULL DEFAULT false,
    "code_length" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_healthy" BOOLEAN DEFAULT true,
    "user_tracking" BOOLEAN DEFAULT false,
    "user_id" TEXT,
    "last_checked_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "url_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_toggles" (
    "id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_toggles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_records" (
    "id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "external_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resource_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" BIGINT,
    "owner_id" UUID,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE INDEX "otp_codes_user_id_created_at_idx" ON "otp_codes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "upload_batches_status_scheduled_at_idx" ON "upload_batches"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "leads_status_created_at_idx" ON "leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "leads_email_mobile_idx" ON "leads"("email", "mobile");

-- CreateIndex
CREATE INDEX "api_logs_university_id_created_at_idx" ON "api_logs"("university_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_name_key" ON "pipeline_stages"("name");

-- CreateIndex
CREATE INDEX "crm_contacts_stage_id_assigned_to_idx" ON "crm_contacts"("stage_id", "assigned_to");

-- CreateIndex
CREATE INDEX "crm_contacts_email_mobile_idx" ON "crm_contacts"("email", "mobile");

-- CreateIndex
CREATE INDEX "crm_activities_contact_id_created_at_idx" ON "crm_activities"("contact_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "url_mappings_short_code_key" ON "url_mappings"("short_code");

-- CreateIndex
CREATE UNIQUE INDEX "feature_toggles_feature_key_key" ON "feature_toggles"("feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_user_id_permission_key" ON "user_permissions"("user_id", "permission");

-- CreateIndex
CREATE INDEX "resource_records_resource_created_at_idx" ON "resource_records"("resource", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "resource_records_resource_external_id_key" ON "resource_records"("resource", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_object_key_key" ON "file_assets"("object_key");

-- CreateIndex
CREATE INDEX "audit_logs_resource_created_at_idx" ON "audit_logs"("resource", "created_at");

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "upload_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "upload_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_cities" ADD CONSTRAINT "state_cities_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_specializations" ADD CONSTRAINT "course_specializations_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_columns" ADD CONSTRAINT "custom_columns_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_column_values" ADD CONSTRAINT "custom_column_values_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "custom_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
