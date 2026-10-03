-- Phase 17: Document storage path (local disk / S3 key)

ALTER TABLE "documents" ADD COLUMN "storage_path" TEXT;
