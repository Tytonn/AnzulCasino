ALTER TABLE "game_rounds" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "big_bet" boolean DEFAULT false NOT NULL;