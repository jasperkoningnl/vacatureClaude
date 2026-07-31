import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Bronnen: registry van alle ingest-bronnen (feeds, json-endpoints, html-pagina's,
// de generieke werkgever-extractor) met hun laatste run-status.
export const bronnen = pgTable("bronnen", {
  id: serial("id").primaryKey(),
  naam: text("naam").notNull().unique(),
  type: text("type").notNull(), // 'rss' | 'json' | 'html' | 'werkgever'
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  laatstGedraaid: timestamp("laatst_gedraaid", { withTimezone: true }),
  laatsteFout: text("laatste_fout"),
  laatsteAantalGevonden: integer("laatste_aantal_gevonden"),
});

// Werkgevers die met de generieke werkgever-extractor gevolgd worden (Fase 2/3).
export const werkgevers = pgTable("werkgevers", {
  id: serial("id").primaryKey(),
  naam: text("naam").notNull(),
  plaats: text("plaats"),
  vacaturepaginaUrl: text("vacaturepagina_url").notNull(),
  laatsteHash: text("laatste_hash"),
  status: text("status").notNull().default("actief"), // 'actief' | 'handmatig' | 'fout'
  notitie: text("notitie"),
  aangemaaktOp: timestamp("aangemaakt_op", { withTimezone: true }).notNull().defaultNow(),
});

// CAO-schalen: kale bruto maandsalarissen per schaal, zonder toeslagen.
// Bedragen worden nooit door de AI verzonnen, alleen handmatig geimporteerd.
export const caoSchalen = pgTable(
  "cao_schalen",
  {
    id: serial("id").primaryKey(),
    caoNaam: text("cao_naam").notNull(),
    schaal: text("schaal").notNull(),
    jaar: integer("jaar").notNull(),
    bedragMin: numeric("bedrag_min", { precision: 10, scale: 2 }).notNull(),
    bedragMax: numeric("bedrag_max", { precision: 10, scale: 2 }).notNull(),
    urenBasis: integer("uren_basis").notNull(),
    bronUrl: text("bron_url").notNull(),
  },
  (table) => [
    uniqueIndex("cao_schalen_naam_schaal_jaar_idx").on(
      table.caoNaam,
      table.schaal,
      table.jaar,
    ),
  ],
);

// Secundaire arbeidsvoorwaarden per CAO, gebruikt om het all-in jaarsalaris te berekenen.
export const caoSecundair = pgTable(
  "cao_secundair",
  {
    id: serial("id").primaryKey(),
    caoNaam: text("cao_naam").notNull(),
    jaar: integer("jaar").notNull(),
    vakantietoeslagPct: numeric("vakantietoeslag_pct", { precision: 5, scale: 2 }).notNull(),
    eindejaarsuitkeringPct: numeric("eindejaarsuitkering_pct", { precision: 5, scale: 2 }),
    ejuOverInclVakantiegeld: boolean("eju_over_incl_vakantiegeld").notNull().default(false),
    ikbPct: numeric("ikb_pct", { precision: 5, scale: 2 }),
    bronUrl: text("bron_url").notNull(),
  },
  (table) => [
    uniqueIndex("cao_secundair_naam_jaar_idx").on(table.caoNaam, table.jaar),
  ],
);

// Vacatures: de kerntabel. Niets wordt weggegooid, afgewezen vacatures blijven staan
// met status en afwijs_reden zodat het filter te controleren is.
export const vacatures = pgTable(
  "vacatures",
  {
    id: serial("id").primaryKey(),

    // Herkomst
    bron: text("bron").notNull(),
    bronId: text("bron_id"),
    url: text("url").notNull(),
    urlGenormaliseerd: text("url_genormaliseerd").notNull(),

    // Kernvelden
    titel: text("titel").notNull(),
    werkgever: text("werkgever"),
    standplaats: text("standplaats"),
    plaatsGenormaliseerd: text("plaats_genormaliseerd"),
    urenMin: integer("uren_min"),
    urenMax: integer("uren_max"),
    dienstverband: text("dienstverband"),
    publicatiedatum: timestamp("publicatiedatum", { withTimezone: true }),
    sluitingsdatum: timestamp("sluitingsdatum", { withTimezone: true }),
    ruweTekst: text("ruwe_tekst"),
    verrijkteTekst: text("verrijkte_tekst"),
    werkgeverUrl: text("werkgever_url"),

    // Salaris, letterlijk zoals in de vacature vermeld
    salarisRuwMin: numeric("salaris_ruw_min", { precision: 10, scale: 2 }),
    salarisRuwMax: numeric("salaris_ruw_max", { precision: 10, scale: 2 }),
    salarisRuwPeriode: text("salaris_ruw_periode"), // 'maand' | 'jaar'
    salarisRuwUren: integer("salaris_ruw_uren"),

    // Salaris, genormaliseerd
    maandsalaris32uMin: numeric("maandsalaris_32u_min", { precision: 10, scale: 2 }),
    maandsalaris32uMax: numeric("maandsalaris_32u_max", { precision: 10, scale: 2 }),
    jaarsalarisAllin32u: numeric("jaarsalaris_allin_32u", { precision: 10, scale: 2 }),
    salarisBron: text("salaris_bron"), // 'letterlijk' | 'cao' | 'werkgeverssite' | 'handmatig' | 'onbekend'
    salarisAanname: boolean("salaris_aanname").notNull().default(false),
    caoNaam: text("cao_naam"),
    caoSchaal: text("cao_schaal"),

    // Overig
    reistijdMinuten: integer("reistijd_minuten"),

    // Status en beoordeling
    status: text("status").notNull().default("nieuw"),
    afwijsReden: text("afwijs_reden"),
    aiScore: integer("ai_score"),
    aiMotivatie: text("ai_motivatie"),
    mijnOordeel: text("mijn_oordeel"), // 'ja' | 'nee'
    mijnNotitie: text("mijn_notitie"),

    aangemaaktOp: timestamp("aangemaakt_op", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vacatures_url_genormaliseerd_idx").on(table.urlGenormaliseerd),
    uniqueIndex("vacatures_bron_bron_id_idx")
      .on(table.bron, table.bronId)
      .where(sql`${table.bronId} is not null`),
  ],
);
