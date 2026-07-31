import * as cheerio from "cheerio";
import { htmlNaarTekst } from "../html-tekst";
import { OphaalResultaat, RuweVacature } from "./types";

const UITGESLOTEN_PAD_PATRONEN = [
  /^\/wp-content/i,
  /^\/wp-admin/i,
  /^\/wp-login/i,
  /^\/vacatures-/i, // stadsfilterpagina's, bv. /vacatures-amsterdam/
  /^\/dienst-/i,
  /^\/over-ons/i,
  /^\/faq/i,
  /^\/contact/i,
  /^\/privacy/i,
  /^\/algemene-voorwaarden/i,
  /^\/cookie/i,
  /^\/vacatures\/?$/i, // de overzichtspagina zelf
];

const MAAND_NAAR_NUMMER: Record<string, number> = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

function isUitgeslotenPad(pathname: string): boolean {
  return UITGESLOTEN_PAD_PATRONEN.some((patroon) => patroon.test(pathname));
}

function vindSluitingsdatum(tekst: string): Date | null {
  const numeriek = tekst.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (numeriek) {
    const dag = Number(numeriek[1]);
    const maand = Number(numeriek[2]);
    const jaar = Number(numeriek[3]);
    const datum = new Date(Date.UTC(jaar, maand - 1, dag));
    if (!Number.isNaN(datum.getTime())) return datum;
  }
  const metMaandnaam = tekst.match(
    /\b(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})\b/i,
  );
  if (metMaandnaam) {
    const dag = Number(metMaandnaam[1]);
    const maand = MAAND_NAAR_NUMMER[metMaandnaam[2].toLowerCase()];
    const jaar = Number(metMaandnaam[3]);
    const datum = new Date(Date.UTC(jaar, maand - 1, dag));
    if (!Number.isNaN(datum.getTime())) return datum;
  }
  return null;
}

function vindUren(tekst: string): { min: number | null; max: number | null } {
  const range = tekst.match(/\b(\d{1,2})\s*(?:-|tot|–)\s*(\d{1,2})\s*uur\b/i);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  const enkel = tekst.match(/\b(\d{1,2})\s*uur\b/i);
  if (enkel) {
    const uren = Number(enkel[1]);
    return { min: uren, max: uren };
  }
  return { min: null, max: null };
}

interface Kandidaat {
  titel: string;
  href: string;
  listingTekst: string;
  werkgeverHint: string | null;
  standplaatsHint: string | null;
}

function vindKandidaten(html: string, baseUrl: string): Kandidaat[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const gezienHrefs = new Set<string>();
  const kandidaten: Kandidaat[] = [];

  // Probeer een aantal veelvoorkomende WordPress-listing-containers, van
  // specifiek naar generiek. De eerste strategie die resultaten oplevert wint.
  const containerSelectors = [
    "article",
    '[class*="vacature" i]',
    "main li",
    "main article",
  ];

  for (const selector of containerSelectors) {
    const containers = $(selector);
    if (containers.length === 0) continue;

    containers.each((_, el) => {
      const $el = $(el);
      const link = $el.find("a[href]").first();
      const href = link.attr("href");
      if (!href) return;

      let absolute: URL;
      try {
        absolute = new URL(href, baseUrl);
      } catch {
        return;
      }
      if (absolute.origin !== origin) return;
      if (isUitgeslotenPad(absolute.pathname)) return;

      const genormaliseerdeHref = absolute.toString();
      if (gezienHrefs.has(genormaliseerdeHref)) return;

      const titel =
        $el.find("h1,h2,h3,h4").first().text().trim() || link.text().trim();
      if (!titel) return;

      const vindHint = (hints: string[]): string | null => {
        for (const hint of hints) {
          const tekst = $el.find(`[class*="${hint}" i]`).first().text().trim();
          if (tekst) return tekst;
        }
        return null;
      };

      gezienHrefs.add(genormaliseerdeHref);
      kandidaten.push({
        titel,
        href: genormaliseerdeHref,
        listingTekst: $el.text().replace(/\s+/g, " ").trim(),
        werkgeverHint: vindHint(["werkgever", "organisatie", "company"]),
        standplaatsHint: vindHint(["locatie", "plaats", "location"]),
      });
    });

    if (kandidaten.length > 0) break;
  }

  return kandidaten;
}

interface HaalOpties {
  maxDetailFetches?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Werken voor Cultuur: server-side gerenderde WordPress-listing, dus een
 * gewone HTML-fetch volstaat. Omdat de exacte opmaak van de listing niet
 * vooraf ingezien kon worden (netwerktoegang ontbrak tijdens het bouwen),
 * probeert dit een aantal generieke selector-strategieen en meldt het
 * duidelijk als geen enkele kandidaten oplevert, in plaats van te gokken.
 */
export async function haalWerkenVoorCultuurOp(
  listingUrl: string,
  opties: HaalOpties = {},
): Promise<OphaalResultaat> {
  const fetchImpl = opties.fetchImpl ?? fetch;
  const maxDetailFetches = opties.maxDetailFetches ?? 60;

  const listingResponse = await fetchImpl(listingUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; vacaturezoeker-persoonlijk/1.0)" },
  });
  if (!listingResponse.ok) {
    return {
      items: [],
      waarschuwing: `Listing-pagina gaf status ${listingResponse.status} terug.`,
    };
  }
  const listingHtml = await listingResponse.text();
  const kandidaten = vindKandidaten(listingHtml, listingUrl);

  if (kandidaten.length === 0) {
    return {
      items: [],
      waarschuwing:
        `Geen vacature-links gevonden op de listingpagina (HTML lengte: ${listingHtml.length} tekens). ` +
        "De opmaak van de site is mogelijk anders dan verwacht, of de lijst wordt via JavaScript geladen. " +
        "Controleer de pagina handmatig en geef door welke HTML-structuur elke vacature-rij gebruikt.",
    };
  }

  const items: RuweVacature[] = [];
  let afgekapt = false;

  for (let i = 0; i < kandidaten.length; i++) {
    const kandidaat = kandidaten[i];
    if (i >= maxDetailFetches) {
      afgekapt = true;
      break;
    }

    let detailTekst: string | null = null;
    try {
      const detailResponse = await fetchImpl(kandidaat.href, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; vacaturezoeker-persoonlijk/1.0)" },
      });
      if (detailResponse.ok) {
        const detailHtml = await detailResponse.text();
        detailTekst = htmlNaarTekst(detailHtml);
      }
    } catch {
      detailTekst = null;
    }

    const combinedTekst = detailTekst ?? kandidaat.listingTekst;
    const uren = vindUren(kandidaat.listingTekst);
    const sluitingsdatum = vindSluitingsdatum(kandidaat.listingTekst);

    items.push({
      bron: "werkenvoorcultuur",
      bronId: kandidaat.href,
      url: kandidaat.href,
      titel: kandidaat.titel,
      werkgever: kandidaat.werkgeverHint,
      standplaats: kandidaat.standplaatsHint,
      urenMin: uren.min,
      urenMax: uren.max,
      dienstverband: null,
      publicatiedatum: null,
      sluitingsdatum,
      ruweTekst: combinedTekst,
      werkgeverUrl: null,
    });
  }

  return {
    items,
    waarschuwing: afgekapt
      ? `Meer dan ${maxDetailFetches} vacatures gevonden, alleen de eerste ${maxDetailFetches} zijn verwerkt in deze run.`
      : null,
  };
}
