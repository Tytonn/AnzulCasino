ALTER TABLE "wallets" ADD COLUMN "work_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "crime_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_state" DROP COLUMN "rebuy_claimed";