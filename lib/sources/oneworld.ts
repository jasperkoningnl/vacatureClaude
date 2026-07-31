import { haalGeneriekeRssOp } from "./generic-rss";
import { OphaalResultaat } from "./types";

/**
 * OneWorld vacaturebank (WPJobBoard RSS). De feed-URL filtert zelf al op
 * category=7 (betaald werk), dus hier verder geen extra filtering.
 */
export async function haalOneWorldOp(feedUrl: string): Promise<OphaalResultaat> {
  return haalGeneriekeRssOp("oneworld", feedUrl);
}
