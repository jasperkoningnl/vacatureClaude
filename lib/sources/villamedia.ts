import { haalGeneriekeRssOp } from "./generic-rss";
import { OphaalResultaat } from "./types";

/** Villamedia vacatures RSS-feed. */
export async function haalVillamediaOp(feedUrl: string): Promise<OphaalResultaat> {
  return haalGeneriekeRssOp("villamedia", feedUrl);
}
