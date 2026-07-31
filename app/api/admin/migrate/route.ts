import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { NextRequest, NextResponse } from "next/server";
import { isGeautoriseerd } from "../../../../lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isGeautoriseerd(request)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL ontbreekt" }, { status: 500 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: "./db/migrations" });
    return NextResponse.json({ ok: true, message: "Migraties toegepast." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onbekende fout" },
      { status: 500 },
    );
  }
}
