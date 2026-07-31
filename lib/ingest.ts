import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bronnen, vacatures } from "@/db/schema";
import { normaliseerTekst, normalizeerUrl } from "@/lib/normalize";
import { haalOneWorldOp } from "@/lib/sources/oneworld";
import { haalVillamediaOp } from "@/lib/sources/villamedia";
import { haalWerkenVoorCultuurOp } from "@/lib/sources/werkenvoorcultuur";
import { OphaalResultaat, RuweVacature } from "@/lib/sources/types";

type Adapter = (config: Record<string, unknown>) => Promise<OphaalResultaat>;

function configUrl(config: Record<string, unknown>): string {
  const url = config.url;
  if (typeof url !== "string" || !url) {
    throw new Error("Bron-config mist een geldige 'url'.");
  }
  return url;
}

const ADAPTERS: Record<string, Adapter> = {
  oneworld: (config) => haalOneWorldOp(configUrl(config)),
  villamedia: (config) => haalVillamediaOp(configUrl(config)),
  werkenvoorcultuur: (config) => haalWerkenVoorCultuurOp(configUrl(config)),
};

export interface IngestResultaat {
  bron: string;
  gevonden: number;
  nieuw: number;
  duplicaten: number;
  waarschuwing: string | null;
  fout: string | null;
}

async function bestaatAl(item: RuweVacature, urlGenormaliseerd: string): Promise<boolean> {
  const titelGenormaliseerd = normaliseerTekst(item.titel);
  const werkgeverGenormaliseerd = normaliseerTekst(item.werkgever);

  const voorwaarden = [
    eq(vacatures.urlGenormaliseerd, urlGenormaliseerd),
    item.bronId
      ? and(eq(vacatures.bron, item.bron), eq(vacatures.bronId, item.bronId))
      : undefined,
    werkgeverGenormaliseerd && titelGenormaliseerd
      ? and(
          sql`lower(${vacatures.werkgever}) = ${werkgeverGenormaliseerd}`,
          sql`lower(${vacatures.titel}) = ${titelGenormaliseerd}`,
        )
      : undefined,
  ].filter((v): v is NonNullable<typeof v> => v !== undefined);

  const treffer = await db
    .select({ id: vacatures.id })
    .from(vacatures)
    .where(or(...voorwaarden))
    .limit(1);

  return treffer.length > 0;
}

/** Haalt een bron op, ontdubbelt en landt nieuwe vacatures in de database. */
export async function ingestBron(bronNaam: string): Promise<IngestResultaat> {
  const [bronRij] = await db.select().from(bronnen).where(eq(bronnen.naam, bronNaam)).limit(1);
  if (!bronRij) {
    return {
      bron: bronNaam,
      gevonden: 0,
      nieuw: 0,
      duplicaten: 0,
      waarschuwing: null,
      fout: `Bron '${bronNaam}' staat niet in de bronnen-tabel. Eerst seeden.`,
    };
  }

  const adapter = ADAPTERS[bronNaam];
  if (!adapter) {
    return {
      bron: bronNaam,
      gevonden: 0,
      nieuw: 0,
      duplicaten: 0,
      waarschuwing: null,
      fout: `Geen adapter geimplementeerd voor bron '${bronNaam}'.`,
    };
  }

  let resultaat: OphaalResultaat;
  try {
    resultaat = await adapter(bronRij.config);
  } catch (error) {
    const fout = error instanceof Error ? error.message : "Onbekende fout bij ophalen.";
    console.error(`[ingest] ${bronNaam}: opgehaald mislukt (0 gevonden) - ${fout}`);
    await db
      .update(bronnen)
      .set({ laatstGedraaid: new Date(), laatsteFout: fout, laatsteAantalGevonden: 0 })
      .where(eq(bronnen.naam, bronNaam));
    return { bron: bronNaam, gevonden: 0, nieuw: 0, duplicaten: 0, waarschuwing: null, fout };
  }

  let nieuw = 0;
  let duplicaten = 0;

  for (const item of resultaat.items) {
    const urlGenormaliseerd = normalizeerUrl(item.url);
    const isDuplicaat = await bestaatAl(item, urlGenormaliseerd);
    if (isDuplicaat) {
      duplicaten++;
      continue;
    }

    await db.insert(vacatures).values({
      bron: item.bron,
      bronId: item.bronId,
      url: item.url,
      urlGenormaliseerd,
      titel: item.titel,
      werkgever: item.werkgever,
      standplaats: item.standplaats,
      urenMin: item.urenMin,
      urenMax: item.urenMax,
      dienstverband: item.dienstverband,
      publicatiedatum: item.publicatiedatum,
      sluitingsdatum: item.sluitingsdatum,
      ruweTekst: item.ruweTekst,
      werkgeverUrl: item.werkgeverUrl,
      status: "nieuw",
    });
    nieuw++;
  }

  console.log(
    `[ingest] ${bronNaam}: ${resultaat.items.length} gevonden, ${nieuw} nieuw, ${duplicaten} duplicaten` +
      (resultaat.waarschuwing ? ` - waarschuwing: ${resultaat.waarschuwing}` : ""),
  );

  await db
    .update(bronnen)
    .set({
      laatstGedraaid: new Date(),
      laatsteFout: resultaat.waarschuwing,
      laatsteAantalGevonden: resultaat.items.length,
    })
    .where(eq(bronnen.naam, bronNaam));

  return {
    bron: bronNaam,
    gevonden: resultaat.items.length,
    nieuw,
    duplicaten,
    waarschuwing: resultaat.waarschuwing,
    fout: null,
  };
}

export async function ingestAlleBronnen(): Promise<IngestResultaat[]> {
  const resultaten: IngestResultaat[] = [];
  for (const bronNaam of Object.keys(ADAPTERS)) {
    resultaten.push(await ingestBron(bronNaam));
  }
  return resultaten;
}
