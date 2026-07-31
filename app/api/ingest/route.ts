import { NextRequest, NextResponse } from "next/server";
import { isGeautoriseerd } from "@/lib/admin-auth";
import { ingestAlleBronnen } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Handmatige trigger voor deze fase: haalt de drie feed/html-bronnen op en
 * landt nieuwe vacatures. Zodra de pijplijn ook verrijking, salaris en
 * AI-beoordeling bevat, wordt dit gesplitst in een korte cron-trigger die
 * werk in de database zet plus een aparte batch-route, zodat de Vercel
 * Hobby functietimeout niet in de weg zit.
 */
export async function POST(request: NextRequest) {
  if (!isGeautoriseerd(request)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const resultaten = await ingestAlleBronnen();
  return NextResponse.json({ ok: true, resultaten });
}
