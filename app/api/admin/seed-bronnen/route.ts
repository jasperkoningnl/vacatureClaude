import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../db/client";
import { bronnen } from "../../../../db/schema";
import { BRONNEN_SEED } from "../../../../lib/bronnen-seed";
import { isGeautoriseerd } from "../../../../lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isGeautoriseerd(request)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  try {
    for (const bron of BRONNEN_SEED) {
      await db
        .insert(bronnen)
        .values({ naam: bron.naam, type: bron.type, config: bron.config })
        .onConflictDoUpdate({
          target: bronnen.naam,
          set: { type: bron.type, config: bron.config },
        });
    }
    return NextResponse.json({ ok: true, aantal: BRONNEN_SEED.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onbekende fout" },
      { status: 500 },
    );
  }
}
