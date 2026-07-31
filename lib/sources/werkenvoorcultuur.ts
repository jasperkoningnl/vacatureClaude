import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
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
  /^\/vacatures\/page\/\d+\/?$/i, // paginanummers van de overzichtspagina zelf
];

const WERKGEVER_HINTS = ["werkgever", "organisatie", "company", "employer", "bedrijf"];
const LOCATIE_HINTS = ["locatie", "plaats", "location", "regio", "standplaats", "stad"];

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

/**
 * Bouwt kandidaten uit een set gevonden containers (bv. het resultaat van een
 * CSS-selector, of van de generieke signatuur-groepering hieronder). Ontdubbelt
 * alleen binnen deze ene set, zodat verschillende strategieen eerlijk op aantal
 * gevonden items vergeleken kunnen worden.
 */
function bouwKandidaten(
  $: cheerio.CheerioAPI,
  containers: AnyNode[],
  origin: string,
  baseUrl: string,
): Kandidaat[] {
  const kandidaten: Kandidaat[] = [];
  const lokaalGezien = new Set<string>();

  for (const container of containers) {
    const $el = $(container);
    const link = $el.find("a[href]").first();
    const href = link.attr("href");
    if (!href) continue;

    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;
    if (isUitgeslotenPad(absolute.pathname)) continue;

    const genormaliseerdeHref = absolute.toString();
    if (lokaalGezien.has(genormaliseerdeHref)) continue;

    const titel = $el.find("h1,h2,h3,h4").first().text().trim() || link.text().trim();
    if (!titel) continue;

    const vindHint = (hints: string[]): string | null => {
      for (const hint of hints) {
        const tekst = $el.find(`[class*="${hint}" i]`).first().text().trim();
        if (tekst) return tekst;
      }
      return null;
    };

    lokaalGezien.add(genormaliseerdeHref);
    kandidaten.push({
      titel,
      href: genormaliseerdeHref,
      listingTekst: $el.text().replace(/\s+/g, " ").trim(),
      werkgeverHint: vindHint(WERKGEVER_HINTS),
      standplaatsHint: vindHint(LOCATIE_HINTS),
    });
  }

  return kandidaten;
}

// Veelvoorkomende WordPress-listing-containers voor vacaturesites, van
// specifiek naar generiek.
const CONTAINER_SELECTORS = [
  "li.job_listing",
  "[class*='job-listing' i]",
  "[class*='job_listing' i]",
  "[class*='vacature-item' i]",
  "[class*='vacature-card' i]",
  "[class*='vacature' i]",
  "[class*='vacancy' i]",
  "article",
  "main ul li",
  "main article",
];

/**
 * Generieke fallback: zoek alle koppen (h1-h4) die samen met een link in
 * dezelfde naaste voorouder-met-class zitten, groepeer die voorouders op
 * tag+classlijst, en gebruik de grootste groep. Een "uitgelicht"-blok komt
 * doorgaans maar 1x voor en heeft een unieke class, dus verliest die
 * vergelijking bijna altijd van de echte lijst met tientallen items.
 */
function vindKandidatenViaSignatuurGroepering(
  $: cheerio.CheerioAPI,
  origin: string,
  baseUrl: string,
): Kandidaat[] {
  const groepen = new Map<string, AnyNode[]>();

  $("h1,h2,h3,h4").each((_, kopEl) => {
    const $kandidaat = $(kopEl).closest("[class]");
    if ($kandidaat.length === 0) return;
    if ($kandidaat.find("a[href]").length === 0) return;

    const node = $kandidaat.get(0);
    if (!node || node.type !== "tag") return;

    const classAttr = ($kandidaat.attr("class") ?? "").trim().split(/\s+/).sort().join(".");
    if (!classAttr) return;
    const signatuur = `${node.tagName}.${classAttr}`;

    const groep = groepen.get(signatuur) ?? [];
    if (!groep.includes(node)) groep.push(node);
    groepen.set(signatuur, groep);
  });

  let grootsteGroep: AnyNode[] = [];
  for (const groep of groepen.values()) {
    if (groep.length > grootsteGroep.length) grootsteGroep = groep;
  }

  if (grootsteGroep.length < 2) return [];
  return bouwKandidaten($, grootsteGroep, origin, baseUrl);
}

/**
 * Probeert meerdere strategieen en kiest de strategie die de MEESTE
 * kandidaten oplevert (niet de eerste met >0 resultaten). Dat voorkomt dat
 * een enkel "uitgelicht"-blok (dat vaak als eerste/specifiekste selector
 * matcht) de echte lijst met tientallen vacatures verdringt.
 */
function vindKandidatenOpPagina(html: string, baseUrl: string): Kandidaat[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;

  let beste: Kandidaat[] = [];

  for (const selector of CONTAINER_SELECTORS) {
    const containers = $(selector).toArray();
    if (containers.length === 0) continue;
    const kandidaten = bouwKandidaten($, containers, origin, baseUrl);
    if (kandidaten.length > beste.length) beste = kandidaten;
  }

  const viaSignatuur = vindKandidatenViaSignatuurGroepering($, origin, baseUrl);
  if (viaSignatuur.length > beste.length) beste = viaSignatuur;

  return beste;
}

/** Zoekt een link naar de volgende paginerings-pagina, indien aanwezig. */
function vindVolgendePaginaUrl(html: string, huidigeUrl: string): string | null {
  const $ = cheerio.load(html);
  const origin = new URL(huidigeUrl).origin;

  const naarAbsoluteUrl = (href: string | undefined): string | null => {
    if (!href) return null;
    try {
      const url = new URL(href, huidigeUrl);
      if (url.origin !== origin) return null;
      return url.toString();
    } catch {
      return null;
    }
  };

  const expliciet = [
    'a[rel="next"]',
    "link[rel=\"next\"]",
    "a.next.page-numbers",
    ".pagination a.next",
    ".nav-links a.next",
    "a.next",
  ];
  for (const selector of expliciet) {
    const href = $(selector).first().attr("href");
    const url = naarAbsoluteUrl(href);
    if (url) return url;
  }

  // Tekst-gebaseerde fallback: link met "volgende", "»" of "next" als label.
  let gevonden: string | null = null;
  $("a[href]").each((_, el) => {
    if (gevonden) return;
    const tekst = $(el).text().trim().toLowerCase();
    if (["volgende", "volgende »", "volgende pagina", "»", "›", "next"].includes(tekst)) {
      gevonden = naarAbsoluteUrl($(el).attr("href"));
    }
  });

  return gevonden;
}

interface HaalOpties {
  maxDetailFetches?: number;
  maxPaginas?: number;
  fetchImpl?: typeof fetch;
}

const STANDAARD_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; vacaturezoeker-persoonlijk/1.0)",
};

/**
 * Werken voor Cultuur: server-side gerenderde WordPress-listing. Loopt de
 * volledige, gepagineerde vacaturelijst door (niet alleen de eerste pagina)
 * en kiest per pagina de containerstrategie die de meeste items oplevert, om
 * te voorkomen dat een enkel uitgelicht blok de rest van de lijst verdringt.
 * Werkgever, titel, locatie, uren en sluitingsdatum worden uit de
 * overzichtspagina zelf gehaald; de detailpagina wordt alleen best-effort
 * bijgehaald voor extra ruwe tekst, en is niet vereist voor de kernvelden.
 */
export async function haalWerkenVoorCultuurOp(
  listingUrl: string,
  opties: HaalOpties = {},
): Promise<OphaalResultaat> {
  const fetchImpl = opties.fetchImpl ?? fetch;
  const maxDetailFetches = opties.maxDetailFetches ?? 200;
  const maxPaginas = opties.maxPaginas ?? 30;

  const alleKandidaten: Kandidaat[] = [];
  const gezienHrefs = new Set<string>();
  const gezienPaginaUrls = new Set<string>();

  let huidigeUrl: string | null = listingUrl;
  let paginaTeller = 0;
  let eersteHtmlLengte: number | null = null;
  let laatsteStatus: number | null = null;

  while (huidigeUrl && paginaTeller < maxPaginas) {
    if (gezienPaginaUrls.has(huidigeUrl)) break;
    gezienPaginaUrls.add(huidigeUrl);

    const response = await fetchImpl(huidigeUrl, { headers: STANDAARD_HEADERS });
    laatsteStatus = response.status;
    if (!response.ok) {
      if (paginaTeller === 0) {
        return {
          items: [],
          waarschuwing: `Listing-pagina gaf status ${response.status} terug.`,
        };
      }
      break; // latere pagina niet meer beschikbaar, stop paginering met wat we hebben
    }

    const html = await response.text();
    if (paginaTeller === 0) eersteHtmlLengte = html.length;

    const paginaKandidaten = vindKandidatenOpPagina(html, huidigeUrl);
    for (const kandidaat of paginaKandidaten) {
      if (gezienHrefs.has(kandidaat.href)) continue;
      gezienHrefs.add(kandidaat.href);
      alleKandidaten.push(kandidaat);
    }

    paginaTeller++;
    huidigeUrl = vindVolgendePaginaUrl(html, huidigeUrl);
  }

  if (alleKandidaten.length === 0) {
    return {
      items: [],
      waarschuwing:
        `Geen vacature-links gevonden op de listingpagina (status: ${laatsteStatus}, HTML lengte eerste pagina: ${eersteHtmlLengte ?? 0} tekens, ${paginaTeller} pagina('s) doorlopen). ` +
        "De opmaak van de site is mogelijk anders dan verwacht, of de lijst wordt via JavaScript geladen. " +
        "Controleer de pagina handmatig en geef door welke HTML-structuur elke vacature-rij gebruikt.",
    };
  }

  const items: RuweVacature[] = [];

  for (let i = 0; i < alleKandidaten.length; i++) {
    const kandidaat = alleKandidaten[i];

    let detailTekst: string | null = null;
    if (i < maxDetailFetches) {
      try {
        const detailResponse = await fetchImpl(kandidaat.href, { headers: STANDAARD_HEADERS });
        if (detailResponse.ok) {
          const detailHtml = await detailResponse.text();
          detailTekst = htmlNaarTekst(detailHtml);
        }
      } catch {
        detailTekst = null;
      }
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
    waarschuwing:
      alleKandidaten.length > maxDetailFetches
        ? `${alleKandidaten.length} vacatures gevonden over ${paginaTeller} pagina('s); voor de eerste ${maxDetailFetches} is ook de detailpagina bijgehaald, de rest bevat alleen overzichtsgegevens.`
        : null,
  };
}
