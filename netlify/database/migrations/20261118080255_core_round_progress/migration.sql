ALTER TABLE "game_rounds" ADD COLUMN "all_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "steps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "acted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "game_rounds_idle_idx" ON "game_rounds" ("game","acted_at") WHERE "status" = 'open';--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_steps_check" CHECK ("steps" >= 0);