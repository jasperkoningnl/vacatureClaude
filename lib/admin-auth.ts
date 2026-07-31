import { NextRequest } from "next/server";

/**
 * Controleert het geheime ADMIN_SECRET, meegegeven als ?secret=... query-param.
 * Gebruikt door alle beheer-routes (migreren, seeden, ingest-trigger).
 */
export function isGeautoriseerd(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const provided = request.nextUrl.searchParams.get("secret");
  return provided === secret;
}
