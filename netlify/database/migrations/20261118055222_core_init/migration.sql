CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"season_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"kind" text DEFAULT 'player' NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "chat_messages_kind_check" CHECK ("kind" in ('player', 'system')),
	CONSTRAINT "chat_messages_player_check" CHECK ("kind" <> 'player' or ("user_id" is not null and char_length("body") between 1 and 300))
);
--> statement-breakpoint
CREATE TABLE "config" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_state" (
	"season_id" integer,
	"user_id" uuid,
	"game_day" date,
	"bonus_claimed" boolean DEFAULT false NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"steal_attempts_used" integer DEFAULT 0 NOT NULL,
	"extra_steal_bought" boolean DEFAULT false NOT NULL,
	"stolen_today" bigint DEFAULT 0 NOT NULL,
	"net_worth_at_reset" bigint,
	"vault_moved" boolean DEFAULT false NOT NULL,
	"rebuy_claimed" boolean DEFAULT false NOT NULL,
	"tier_bought" boolean DEFAULT false NOT NULL,
	"challenges" jsonb DEFAULT '[]' NOT NULL,
	CONSTRAINT "daily_state_pkey" PRIMARY KEY("season_id","user_id","game_day"),
	CONSTRAINT "daily_state_counts_check" CHECK ("streak" >= 0 and "steal_attempts_used" >= 0),
	CONSTRAINT "daily_state_stolen_check" CHECK ("stolen_today" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_rounds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_rounds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"stake" bigint NOT NULL,
	"payout" bigint,
	"multiplier" numeric(14,4),
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"secret" jsonb,
	"shared_round_id" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "game_rounds_status_check" CHECK ("status" in ('open', 'settled', 'void')),
	CONSTRAINT "game_rounds_stake_check" CHECK ("stake" >= 0),
	CONSTRAINT "game_rounds_payout_check" CHECK ("payout" is null or "payout" >= 0),
	CONSTRAINT "game_rounds_settled_check" CHECK (("status" = 'open') = ("settled_at" is null)),
	CONSTRAINT "game_rounds_secret_check" CHECK ("status" = 'open' or "secret" is null)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid,
	"key" text,
	"scope" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("user_id","key"),
	CONSTRAINT "idempotency_keys_key_check" CHECK (char_length("key") between 8 and 100)
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY,
	"kind" text DEFAULT 'invite' NOT NULL,
	"target_user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	CONSTRAINT "invite_codes_kind_check" CHECK ("kind" in ('invite', 'reset')),
	CONSTRAINT "invite_codes_reset_target_check" CHECK ("kind" <> 'reset' or "target_user_id" is not null),
	CONSTRAINT "invite_codes_used_check" CHECK (("used_by" is null) = ("used_at" is null))
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"account" text NOT NULL,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_check" CHECK ("account" in ('wallet', 'vault')),
	CONSTRAINT "ledger_delta_check" CHECK ("delta" <> 0),
	CONSTRAINT "ledger_balance_after_check" CHECK ("balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"season_id" integer,
	"user_id" uuid,
	"at" timestamp with time zone,
	"net_worth" bigint NOT NULL,
	CONSTRAINT "net_worth_snapshots_pkey" PRIMARY KEY("season_id","user_id","at")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text,
	"subject" text,
	"window_start" timestamp with time zone,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("bucket","subject","window_start")
);
--> statement-breakpoint
CREATE TABLE "season_results" (
	"season_id" integer,
	"user_id" uuid,
	"final_rank" integer NOT NULL,
	"final_net_worth" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_results_pkey" PRIMARY KEY("season_id","user_id"),
	CONSTRAINT "season_results_rank_key" UNIQUE("season_id","final_rank")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"starting_balance" bigint NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_window_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "seasons_starting_balance_check" CHECK ("starting_balance" > 0),
	CONSTRAINT "seasons_status_check" CHECK ("status" in ('scheduled', 'active', 'final_day', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_rounds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shared_rounds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"game" text NOT NULL,
	"round_no" bigint NOT NULL,
	"state" text NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"secret" jsonb,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_rounds_round_key" UNIQUE("season_id","game","round_no")
);
--> statement-breakpoint
CREATE TABLE "shield_purchases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shield_purchases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shield_purchases_price_check" CHECK ("price" > 0)
);
--> statement-breakpoint
CREATE TABLE "shields" (
	"season_id" integer,
	"user_id" uuid,
	"charges" integer DEFAULT 0 NOT NULL,
	"immune_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shields_pkey" PRIMARY KEY("season_id","user_id"),
	CONSTRAINT "shields_charges_check" CHECK ("charges" >= 0)
);
--> statement-breakpoint
CREATE TABLE "steals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "steals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"thief_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"game_day" date NOT NULL,
	"outcome" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"fine" bigint DEFAULT 0 NOT NULL,
	"thief_rank" integer NOT NULL,
	"target_rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steals_outcome_check" CHECK ("outcome" in ('success', 'failed', 'blocked')),
	CONSTRAINT "steals_self_check" CHECK ("thief_id" <> "target_id"),
	CONSTRAINT "steals_amounts_check" CHECK ("amount" >= 0 and "fine" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar" text DEFAULT 'chip' NOT NULL,
	"avatar_color" text DEFAULT 'violet' NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"theme" text DEFAULT 'midnight' NOT NULL,
	"sound_volume" smallint DEFAULT 70 NOT NULL,
	"sound_muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_role_check" CHECK ("role" in ('player', 'admin')),
	CONSTRAINT "users_sound_volume_check" CHECK ("sound_volume" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"season_id" integer,
	"user_id" uuid,
	"balance" bigint DEFAULT 0 NOT NULL,
	"vault" bigint DEFAULT 0 NOT NULL,
	"tier" text DEFAULT 'base' NOT NULL,
	"net_worth_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_pkey" PRIMARY KEY("season_id","user_id"),
	CONSTRAINT "wallets_balance_check" CHECK ("balance" >= 0),
	CONSTRAINT "wallets_vault_check" CHECK ("vault" >= 0),
	CONSTRAINT "wallets_tier_check" CHECK ("tier" in ('base', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'crown'))
);
--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" ("created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created_idx" ON "chat_messages" ("created_at");--> statement-breakpoint
CREATE INDEX "config_key_idx" ON "config" ("key","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_rounds_one_open_key" ON "game_rounds" ("season_id","user_id","game") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "game_rounds_feed_idx" ON "game_rounds" ("season_id","settled_at");--> statement-breakpoint
CREATE INDEX "game_rounds_player_idx" ON "game_rounds" ("season_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "game_rounds_shared_idx" ON "game_rounds" ("shared_round_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_wallet_idx" ON "ledger" ("season_id","user_id","id");--> statement-breakpoint
CREATE INDEX "ledger_ref_idx" ON "ledger" ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" ("window_start");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "shield_purchases_player_idx" ON "shield_purchases" ("season_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "steals_thief_idx" ON "steals" ("season_id","thief_id","game_day");--> statement-breakpoint
CREATE INDEX "steals_target_idx" ON "steals" ("season_id","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_users_id_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "config" ADD CONSTRAINT "config_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "daily_state" ADD CONSTRAINT "daily_state_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_shared_round_id_shared_rounds_id_fkey" FOREIGN KEY ("shared_round_id") REFERENCES "shared_rounds"("id");--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_target_user_id_users_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_used_by_users_id_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "season_results" ADD CONSTRAINT "season_results_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shared_rounds" ADD CONSTRAINT "shared_rounds_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id");--> statement-breakpoint
ALTER TABLE "shield_purchases" ADD CONSTRAINT "shield_purchases_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "shields" ADD CONSTRAINT "shields_wallet_fk" FOREIGN KEY ("season_id","user_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "steals" ADD CONSTRAINT "steals_thief_wallet_fk" FOREIGN KEY ("season_id","thief_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "steals" ADD CONSTRAINT "steals_target_wallet_fk" FOREIGN KEY ("season_id","target_id") REFERENCES "wallets"("season_id","user_id");--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id");--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");