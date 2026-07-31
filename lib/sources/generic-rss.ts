import Parser from "rss-parser";
import { htmlNaarTekst } from "../html-tekst";
import { OphaalResultaat, RuweVacature } from "./types";

const parser = new Parser();

/**
 * Generieke RSS 2.0 ophaler. Vult alleen de velden die het RSS-formaat
 * gegarandeerd biedt (title, link, guid, pubDate, content). Bron-specifieke
 * adapters roepen dit aan en laten hier bewust geen aannames over
 * werkgever/standplaats overheen, want die staan niet in kale RSS-tags.
 */
export async function haalGeneriekeRssOp(
  bron: string,
  feedUrl: string,
): Promise<OphaalResultaat> {
  const feed = await parser.parseURL(feedUrl);

  if (!feed.items || feed.items.length === 0) {
    return {
      items: [],
      waarschuwing: "Feed leverde 0 items op. Controleer of de feed-URL nog klopt.",
    };
  }

  const items: RuweVacature[] = feed.items
    .filter((item) => item.link && item.title)
    .map((item) => {
      const ruweHtml = item.content ?? item.contentSnippet ?? item.summary ?? "";
      return {
        bron,
        bronId: item.guid ?? item.link ?? null,
        url: item.link as string,
        titel: (item.title as string).trim(),
        werkgever: null,
        standplaats: null,
        urenMin: null,
        urenMax: null,
        dienstverband: null,
        publicatiedatum: item.pubDate ? new Date(item.pubDate) : null,
        sluitingsdatum: null,
        ruweTekst: ruweHtml ? htmlNaarTekst(ruweHtml) : null,
        werkgeverUrl: null,
      };
    });

  return { items, waarschuwing: null };
}
