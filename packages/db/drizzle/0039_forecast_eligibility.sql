ALTER TYPE forecast_review_issue_type ADD VALUE IF NOT EXISTS 'forecast_skipped';
--> statement-breakpoint
ALTER TABLE skus ADD COLUMN IF NOT EXISTS force_forecast boolean NOT NULL DEFAULT false;
