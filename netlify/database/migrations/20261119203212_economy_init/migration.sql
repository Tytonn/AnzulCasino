CREATE TABLE "economy_announcements" (
	"season_id" integer,
	"key" text,
	"message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_announcements_pkey" PRIMARY KEY("season_id","key")
);
--> statement-breakpoint
CREATE TABLE "economy_drop_claims" (
	"drop_id" bigint,
	"season_id" integer NOT NULL,
	"user_id" uuid,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_drop_claims_pkey" PRIMARY KEY("drop_id","user_id"),
	CONSTRAINT "economy_drop_claims_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "economy_drops" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "economy_drops_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"appears_at" timestamp with time zone NOT NULL,
	"pot" bigint DEFAULT 0 NOT NULL,
	"winners" integer DEFAULT 1 NOT NULL,
	"message_id" bigint,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_drops_pot_check" CHECK ("pot" >= 0),
	CONSTRAINT "economy_drops_winners_check" CHECK ("winners" > 0)
);
--> statement-breakpoint
CREATE TABLE "economy_players" (
	"season_id" integer,
	"user_id" uuid,
	"collected_at" timestamp with time zone,
	"version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "economy_players_pkey" PRIMARY KEY("season_id","user_id"),
	CONSTRAINT "economy_players_version_check" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "economy_drops_waiting_key" ON "economy_drops" ("season_id") WHERE "posted_at" is null;--> statement-breakpoint
CREATE INDEX "economy_drops_posted_idx" ON "economy_drops" ("season_id","posted_at");--> statement-breakpoint
ALTER TABLE "economy_announcements" ADD CONSTRAINT "economy_announcements_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id");--> statement-breakpoint
ALTER TABLE "economy_announcements" ADD CONSTRAINT "economy_announcements_message_id_chat_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id");--> statement-breakpoint
ALTER TABLE "economy_drop_claims" ADD CONSTRAINT "economy_drop_claims_drop_id_economy_drops_id_fkey" FOREIGN KEY ("drop_id") REFERENCES "economy_drops"("id");--> statement-breakpoint
ALTER TABLE "economy_drop_claims" ADD CONSTRAINT "economy_drop_claims_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "economy_drops" ADD CONSTRAINT "economy_drops_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id");--> statement-breakpoint
ALTER TABLE "economy_drops" ADD CONSTRAINT "economy_drops_message_id_chat_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id");--> statement-breakpoint
ALTER TABLE "economy_players" ADD CONSTRAINT "economy_players_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");