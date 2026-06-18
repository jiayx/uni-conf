-- Migration: 0002_add_subscription_info
-- Add subscription info fields to sources table

ALTER TABLE sources ADD COLUMN upload_bytes INTEGER;
ALTER TABLE sources ADD COLUMN download_bytes INTEGER;
ALTER TABLE sources ADD COLUMN total_bytes INTEGER;
ALTER TABLE sources ADD COLUMN expire_time INTEGER;
