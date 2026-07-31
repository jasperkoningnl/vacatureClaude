CREATE TABLE "bronnen" (
	"id" serial PRIMARY KEY NOT NULL,
	"naam" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"laatst_gedraaid" timestamp with time zone,
	"laatste_fout" text,
	CONSTRAINT "bronnen_naam_unique" UNIQUE("naam")
);
--> statement-breakpoint
CREATE TABLE "cao_schalen" (
	"id" serial PRIMARY KEY NOT NULL,
	"cao_naam" text NOT NULL,
	"schaal" text NOT NULL,
	"jaar" integer NOT NULL,
	"bedrag_min" numeric(10, 2) NOT NULL,
	"bedrag_max" numeric(10, 2) NOT NULL,
	"uren_basis" integer NOT NULL,
	"bron_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cao_secundair" (
	"id" serial PRIMARY KEY NOT NULL,
	"cao_naam" text NOT NULL,
	"jaar" integer NOT NULL,
	"vakantietoeslag_pct" numeric(5, 2) NOT NULL,
	"eindejaarsuitkering_pct" numeric(5, 2),
	"eju_over_incl_vakantiegeld" boolean DEFAULT false NOT NULL,
	"ikb_pct" numeric(5, 2),
	"bron_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"bron" text NOT NULL,
	"bron_id" text,
	"url" text NOT NULL,
	"url_genormaliseerd" text NOT NULL,
	"titel" text NOT NULL,
	"werkgever" text,
	"standplaats" text,
	"plaats_genormaliseerd" text,
	"uren_min" integer,
	"uren_max" integer,
	"dienstverband" text,
	"publicatiedatum" timestamp with time zone,
	"sluitingsdatum" timestamp with time zone,
	"ruwe_tekst" text,
	"verrijkte_tekst" text,
	"werkgever_url" text,
	"salaris_ruw_min" numeric(10, 2),
	"salaris_ruw_max" numeric(10, 2),
	"salaris_ruw_periode" text,
	"salaris_ruw_uren" integer,
	"maandsalaris_32u_min" numeric(10, 2),
	"maandsalaris_32u_max" numeric(10, 2),
	"jaarsalaris_allin_32u" numeric(10, 2),
	"salaris_bron" text,
	"salaris_aanname" boolean DEFAULT false NOT NULL,
	"cao_naam" text,
	"cao_schaal" text,
	"reistijd_minuten" integer,
	"status" text DEFAULT 'nieuw' NOT NULL,
	"afwijs_reden" text,
	"ai_score" integer,
	"ai_motivatie" text,
	"mijn_oordeel" text,
	"mijn_notitie" text,
	"aangemaakt_op" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "werkgevers" (
	"id" serial PRIMARY KEY NOT NULL,
	"naam" text NOT NULL,
	"plaats" text,
	"vacaturepagina_url" text NOT NULL,
	"laatste_hash" text,
	"status" text DEFAULT 'actief' NOT NULL,
	"notitie" text,
	"aangemaakt_op" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cao_schalen_naam_schaal_jaar_idx" ON "cao_schalen" USING btree ("cao_naam","schaal","jaar");--> statement-breakpoint
CREATE UNIQUE INDEX "cao_secundair_naam_jaar_idx" ON "cao_secundair" USING btree ("cao_naam","jaar");--> statement-breakpoint
CREATE UNIQUE INDEX "vacatures_url_genormaliseerd_idx" ON "vacatures" USING btree ("url_genormaliseerd");--> statement-breakpoint
CREATE UNIQUE INDEX "vacatures_bron_bron_id_idx" ON "vacatures" USING btree ("bron","bron_id") WHERE "vacatures"."bron_id" is not null;