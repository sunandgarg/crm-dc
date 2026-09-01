ALTER TABLE "app_users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "upload_batches" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");
CREATE INDEX "upload_batches_user_id_status_idx" ON "upload_batches"("user_id", "status");
