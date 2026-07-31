import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { bronnen } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isGeautoriseerd } from "@/lib/admin-auth";
import { diagnoseerListing, haalWerkenVoorCultuurOp } from "@/lib/sources/werkenvoorcultuur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; vacaturezoeker-persoonlijk/1.0)" };

/**
 * Tijdelijk diagnose-endpoint: draait de volledige werkenvoorcultuur-adapter
 * (met echte netwerktoegang, anders dan de ontwikkel-sandbox) en rapporteert
 * zowel het eindresultaat als, voor de HTML-listingpagina, per
 * selectorstrategie hoeveel kandidaten die oplevert. Bedoeld om zichtbaar te
 * maken of de WP REST API of de HTML-fallback gebruikt wordt en waarom.
 */
export async function POST(request: NextRequest) {
  if (!isGeautoriseerd(request)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const [bronRij] = await db
    .select()
    .from(bronnen)
    .where(eq(bronnen.naam, "werkenvoorcultuur"))
    .limit(1);
  if (!bronRij) {
    return NextResponse.json({ error: "Bron 'werkenvoorcultuur' niet gevonden. Eerst seeden." }, { status: 404 });
  }
  const url = bronRij.config.url;
  if (typeof url !== "string" || !url) {
    return NextResponse.json({ error: "Bron mist een geldige 'url' in config." }, { status: 400 });
  }

  try {
    const resultaat = await haalWerkenVoorCultuurOp(url);

    let listingDiagnose = null;
    try {
      const listingResponse = await fetch(url, { headers: HEADERS });
      if (listingResponse.ok) {
        const html = await listingResponse.text();
        listingDiagnose = diagnoseerListing(html, url);
      }
    } catch {
      listingDiagnose = null;
    }

    return NextResponse.json({
      ok: true,
      url,
      aantalGevonden: resultaat.items.length,
      waarschuwing: resultaat.waarschuwing,
      voorbeeldItems: resultaat.items.slice(0, 5).map((item) => ({
        titel: item.titel,
        werkgever: item.werkgever,
        standplaats: item.standplaats,
        urenMin: item.urenMin,
        urenMax: item.urenMax,
        sluitingsdatum: item.sluitingsdatum,
        url: item.url,
      })),
      listingDiagnose,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onbekende fout bij ophalen." },
      { status: 500 },
    );
  }
}
