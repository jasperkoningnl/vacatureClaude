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

// "subtitle" dekt het echte patroon van deze site (<p class="subtitle-1">Werkgever</p>).
const WERKGEVER_HINTS = ["werkgever", "organisatie", "company", "employer", "bedrijf", "subtitle"];
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

// "uur" en "uren" komen beide voor ("18 - 36 uren per week", "32 uur per week").
function vindUren(tekst: string): { min: number | null; max: number | null } {
  const range = tekst.match(/\b(\d{1,2})\s*(?:-|tot|–)\s*(\d{1,2})\s*uren?\b/i);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  const enkel = tekst.match(/\b(\d{1,2})\s*uren?\b/i);
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
 * Bepaalt de link voor een kandidaat-container op drie manieren, want
 * WordPress-thema's koppelen een vacature-kaart aan zijn link op meerdere
 * manieren: de link zelf IS de kaart (bv. <a class="card-vacancy-link"><div
 * class="card-vacancy">...</div></a>), de link zit genest in de kaart, of de
 * link omvat de kaart als voorouder. Alleen op "geneste link" controleren
 * (zoals eerdere versies deden) mist het eerste en laatste geval volledig.
 */
function vindLinkVoorContainer(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
): { href: string; linkTekst: string } | null {
  if ($el.is("a[href]")) {
    const href = $el.attr("href");
    if (href) return { href, linkTekst: $el.text().trim() };
  }

  const genest = $el.find("a[href]").first();
  if (genest.length > 0) {
    const href = genest.attr("href");
    if (href) return { href, linkTekst: genest.text().trim() };
  }

  const voorouder = $el.closest("a[href]");
  if (voorouder.length > 0) {
    const href = voorouder.attr("href");
    if (href) return { href, linkTekst: voorouder.text().trim() };
  }

  return null;
}

/** Zoekt tekst naast een icoon met een bepaald alt-attribuut (bv. "Location icon"). */
function vindTekstBijIconAlt(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  altBevat: string,
): string | null {
  let gevonden: string | null = null;
  $el.find(`img[alt*="${altBevat}" i]`).each((_, img) => {
    if (gevonden) return;
    const tekst = $(img).parent().text().replace(/\s+/g, " ").trim();
    if (tekst) gevonden = tekst;
  });
  return gevonden;
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
    const gevondenLink = vindLinkVoorContainer($, $el);
    if (!gevondenLink) continue;

    let absolute: URL;
    try {
      absolute = new URL(gevondenLink.href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;
    if (isUitgeslotenPad(absolute.pathname)) continue;

    const genormaliseerdeHref = absolute.toString();
    if (lokaalGezien.has(genormaliseerdeHref)) continue;

    const titel = $el.find("h1,h2,h3,h4").first().text().trim() || gevondenLink.linkTekst;
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
      standplaatsHint: vindTekstBijIconAlt($, $el, "location") ?? vindHint(LOCATIE_HINTS),
    });
  }

  return kandidaten;
}

// Veelvoorkomende WordPress-listing-containers voor vacaturesites, van
// specifiek naar generiek. "a.card-vacancy-link" is het bevestigde patroon
// van werkenvoorcultuur.nl zelf; de rest is generieke dekking voor
// vergelijkbare sites of toekomstige opmaakwijzigingen.
const CONTAINER_SELECTORS = [
  "a.card-vacancy-link",
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
    if (!vindLinkVoorContainer($, $kandidaat)) return;

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

export interface ListingDiagnose {
  htmlLengte: number;
  perSelector: Array<{
    selector: string;
    aantalElementen: number;
    aantalKandidaten: number;
  }>;
  signatuurGroepering: { aantalKandidaten: number };
  gekozenStrategie: string;
  aantalGekozenKandidaten: number;
  voorbeeldKandidaten: Array<{
    titel: string;
    href: string;
    werkgeverHint: string | null;
    standplaatsHint: string | null;
  }>;
  linksInMain: {
    totaal: number;
    sameOrigin: number;
    crossOrigin: number;
    voorbeeldCrossOriginHosts: string[];
  };
  volgendePaginaUrl: string | null;
  facetwpTotaalPaginas: number | null;
}

/**
 * Diagnostische variant van vindKandidatenOpPagina: draait dezelfde
 * strategieen maar geeft per strategie de score terug, plus statistieken
 * over links binnen <main>. Gebruikt door /api/admin/debug-werkenvoorcultuur
 * om vanuit een omgeving met echte netwerktoegang te kunnen zien waarom de
 * listing weinig/geen items geeft.
 */
export function diagnoseerListing(html: string, baseUrl: string): ListingDiagnose {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;

  const perSelector: ListingDiagnose["perSelector"] = [];
  let beste: Kandidaat[] = [];
  let besteNaam = "geen";

  for (const selector of CONTAINER_SELECTORS) {
    const containers = $(selector).toArray();
    const kandidaten = containers.length > 0 ? bouwKandidaten($, containers, origin, baseUrl) : [];
    perSelector.push({
      selector,
      aantalElementen: containers.length,
      aantalKandidaten: kandidaten.length,
    });
    if (kandidaten.length > beste.length) {
      beste = kandidaten;
      besteNaam = selector;
    }
  }

  const viaSignatuur = vindKandidatenViaSignatuurGroepering($, origin, baseUrl);
  if (viaSignatuur.length > beste.length) {
    beste = viaSignatuur;
    besteNaam = "signatuur-groepering";
  }

  let sameOrigin = 0;
  let crossOrigin = 0;
  const crossOriginHosts = new Set<string>();
  $("main a[href], body a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.origin === origin) {
        sameOrigin++;
      } else {
        crossOrigin++;
        crossOriginHosts.add(url.host);
      }
    } catch {
      // negeren, geen geldige url
    }
  });

  return {
    htmlLengte: html.length,
    perSelector,
    signatuurGroepering: { aantalKandidaten: viaSignatuur.length },
    gekozenStrategie: besteNaam,
    aantalGekozenKandidaten: beste.length,
    voorbeeldKandidaten: beste.slice(0, 5).map((k) => ({
      titel: k.titel,
      href: k.href,
      werkgeverHint: k.werkgeverHint,
      standplaatsHint: k.standplaatsHint,
    })),
    linksInMain: {
      totaal: sameOrigin + crossOrigin,
      sameOrigin,
      crossOrigin,
      voorbeeldCrossOriginHosts: Array.from(crossOriginHosts).slice(0, 5),
    },
    volgendePaginaUrl: vindVolgendePaginaUrl(html, baseUrl),
    facetwpTotaalPaginas: vindFacetwpTotaalPaginas(html),
  };
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

/**
 * werkenvoorcultuur.nl gebruikt FacetWP voor filtering/paginering, die de
 * volgende pagina puur via JavaScript/AJAX laadt (de paginaknoppen hebben
 * geen href). Deze functie leest het totaal aantal pagina's uit het
 * server-side ingebedde `window.FWP_JSON`-blok, puur om eerlijk te kunnen
 * waarschuwen als de HTML-fallback (zonder JS) niet alles kon ophalen.
 */
function vindFacetwpTotaalPaginas(html: string): number | null {
  const match = html.match(/window\.FWP_JSON\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
      preload_data?: { settings?: { pager?: { total_pages?: unknown } } };
    };
    const totaal = parsed.preload_data?.settings?.pager?.total_pages;
    return typeof totaal === "number" ? totaal : null;
  } catch {
    return null;
  }
}

interface RestKandidaat {
  href: string;
  titel: string;
}

/**
 * werkenvoorcultuur.nl is WordPress met een publiek geregistreerd "vacancy"
 * custom post type (bevestigd via de <link rel="alternate" type=
 * "application/json" href=".../wp-json/wp/v2/vacancy/{id}"> op elke
 * vacaturepagina). De standaard WP REST API paginering (?page=&per_page=)
 * is stabiel en gedocumenteerd, in tegenstelling tot de FacetWP-AJAX-lijst
 * op de overzichtspagina zelf. Dit is daarom de eerste keuze om ALLE
 * vacature-URLs te verzamelen; alleen als dit niets oplevert (bv. omdat het
 * post-type op een andere site anders heet) valt de adapter terug op
 * HTML-scraping van de overzichtspagina.
 */
async function haalKandidatenViaWpRest(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<RestKandidaat[] | null> {
  const alle: RestKandidaat[] = [];
  const perPage = 100;
  const maxPaginas = 20;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${origin}/wp-json/wp/v2/vacancy?per_page=${perPage}&page=${pagina}&_fields=link,title`;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: STANDAARD_HEADERS });
    } catch {
      return pagina === 1 ? null : alle;
    }
    if (!response.ok) return pagina === 1 ? null : alle;

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return pagina === 1 ? null : alle;
    }
    if (!Array.isArray(data)) return pagina === 1 ? null : alle;

    for (const ruw of data) {
      if (!ruw || typeof ruw !== "object") continue;
      const item = ruw as Record<string, unknown>;
      const link = item.link;
      if (typeof link !== "string" || !link) continue;
      const titleObj = item.title as { rendered?: unknown } | undefined;
      const titelRuw = typeof titleObj?.rendered === "string" ? titleObj.rendered : "";
      const titel = htmlNaarTekst(titelRuw).trim() || link;
      alle.push({ href: link, titel });
    }

    if (data.length < perPage) break; // laatste pagina bereikt
  }

  return alle;
}

interface JobPostingLd {
  hiringOrganization?: { name?: unknown };
  jobLocation?: { address?: { addressLocality?: unknown } };
  employmentType?: unknown;
  datePosted?: unknown;
  validThrough?: unknown;
  workHours?: unknown;
}

/**
 * Vacaturedetailpagina's op deze site bevatten een schema.org JobPosting
 * JSON-LD blok met werkgever, locatie, uren en sluitingsdatum als
 * machineleesbare velden (bevestigd op een echte detailpagina). Dit is
 * betrouwbaarder dan tekst uit het overzicht regex-matchen, dus wordt als
 * voorkeursbron gebruikt wanneer de detailpagina wordt opgehaald.
 */
function vindJobPostingLd(html: string): JobPostingLd | null {
  const $ = cheerio.load(html);
  let gevonden: JobPostingLd | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (gevonden) return;
    const raw = $(el).contents().text();
    if (!raw || !raw.includes("JobPosting")) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const graph =
        parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["@graph"])
          ? ((parsed as Record<string, unknown>)["@graph"] as unknown[])
          : null;
      const kandidaten = Array.isArray(parsed) ? parsed : (graph ?? [parsed]);
      const match = kandidaten.find(
        (item) => item && typeof item === "object" && (item as Record<string, unknown>)["@type"] === "JobPosting",
      );
      if (match) gevonden = match as JobPostingLd;
    } catch {
      // negeren, geen geldige JSON
    }
  });
  return gevonden;
}

function parseIsoDatum(waarde: unknown): Date | null {
  if (typeof waarde !== "string" || !waarde) return null;
  const datum = new Date(waarde);
  return Number.isNaN(datum.getTime()) ? null : datum;
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
 * Werken voor Cultuur: WordPress met FacetWP-gefilterde listing (paginering
 * gaat puur via JavaScript/AJAX, niet via volgbare links). Probeert daarom
 * eerst de publieke WP REST API van het "vacancy" post type om ALLE
 * vacature-URLs betrouwbaar te verzamelen; valt terug op HTML-scraping van
 * de overzichtspagina (met linkgebaseerde paginering, voor zover aanwezig)
 * als de REST API niets oplevert. Werkgever, locatie, uren en
 * sluitingsdatum komen bij voorkeur uit het JobPosting-schema.org-blok op de
 * detailpagina; als dat ontbreekt wordt teruggevallen op de kaarttekst uit
 * het overzicht.
 */
export async function haalWerkenVoorCultuurOp(
  listingUrl: string,
  opties: HaalOpties = {},
): Promise<OphaalResultaat> {
  const fetchImpl = opties.fetchImpl ?? fetch;
  const maxDetailFetches = opties.maxDetailFetches ?? 200;
  const maxPaginas = opties.maxPaginas ?? 30;
  const origin = new URL(listingUrl).origin;

  let alleKandidaten: Kandidaat[] = [];
  let paginaTeller = 0;
  let eersteHtmlLengte: number | null = null;
  let laatsteStatus: number | null = null;
  let facetwpTotaalPaginas: number | null = null;
  let viaRest = false;

  const restResultaat = await haalKandidatenViaWpRest(origin, fetchImpl);
  if (restResultaat && restResultaat.length > 0) {
    viaRest = true;
    alleKandidaten = restResultaat.map((item) => ({
      titel: item.titel,
      href: item.href,
      listingTekst: "",
      werkgeverHint: null,
      standplaatsHint: null,
    }));
  } else {
    const gezienHrefs = new Set<string>();
    const gezienPaginaUrls = new Set<string>();
    let huidigeUrl: string | null = listingUrl;

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
      if (paginaTeller === 0) {
        eersteHtmlLengte = html.length;
        facetwpTotaalPaginas = vindFacetwpTotaalPaginas(html);
      }

      const paginaKandidaten = vindKandidatenOpPagina(html, huidigeUrl);
      for (const kandidaat of paginaKandidaten) {
        if (gezienHrefs.has(kandidaat.href)) continue;
        gezienHrefs.add(kandidaat.href);
        alleKandidaten.push(kandidaat);
      }

      paginaTeller++;
      huidigeUrl = vindVolgendePaginaUrl(html, huidigeUrl);
    }
  }

  if (alleKandidaten.length === 0) {
    return {
      items: [],
      waarschuwing:
        `Geen vacatures gevonden via de WP REST API of de listingpagina (status: ${laatsteStatus}, HTML lengte eerste pagina: ${eersteHtmlLengte ?? 0} tekens, ${paginaTeller} pagina('s) doorlopen). ` +
        "De opmaak van de site is mogelijk anders dan verwacht. Controleer de pagina handmatig en geef door welke HTML-structuur elke vacature-rij gebruikt.",
    };
  }

  const items: RuweVacature[] = [];

  for (let i = 0; i < alleKandidaten.length; i++) {
    const kandidaat = alleKandidaten[i];

    let detailHtml: string | null = null;
    if (i < maxDetailFetches) {
      try {
        const detailResponse = await fetchImpl(kandidaat.href, { headers: STANDAARD_HEADERS });
        if (detailResponse.ok) detailHtml = await detailResponse.text();
      } catch {
        detailHtml = null;
      }
    }

    const jobPostingLd = detailHtml ? vindJobPostingLd(detailHtml) : null;
    const detailTekst = detailHtml ? htmlNaarTekst(detailHtml) : null;
    const combinedTekst = detailTekst ?? kandidaat.listingTekst;

    const werkgeverViaLd =
      typeof jobPostingLd?.hiringOrganization?.name === "string" ? jobPostingLd.hiringOrganization.name : null;
    const standplaatsViaLd =
      typeof jobPostingLd?.jobLocation?.address?.addressLocality === "string"
        ? jobPostingLd.jobLocation.address.addressLocality
        : null;
    const dienstverbandViaLd = typeof jobPostingLd?.employmentType === "string" ? jobPostingLd.employmentType : null;
    const publicatiedatumViaLd = parseIsoDatum(jobPostingLd?.datePosted);
    const sluitingsdatumViaLd = parseIsoDatum(jobPostingLd?.validThrough);
    const urenTekstViaLd = typeof jobPostingLd?.workHours === "string" ? jobPostingLd.workHours : null;

    const uren = vindUren(urenTekstViaLd ?? kandidaat.listingTekst);
    const sluitingsdatum = sluitingsdatumViaLd ?? vindSluitingsdatum(kandidaat.listingTekst);

    items.push({
      bron: "werkenvoorcultuur",
      bronId: kandidaat.href,
      url: kandidaat.href,
      titel: kandidaat.titel,
      werkgever: werkgeverViaLd ?? kandidaat.werkgeverHint,
      standplaats: standplaatsViaLd ?? kandidaat.standplaatsHint,
      urenMin: uren.min,
      urenMax: uren.max,
      dienstverband: dienstverbandViaLd,
      publicatiedatum: publicatiedatumViaLd,
      sluitingsdatum,
      ruweTekst: combinedTekst,
      werkgeverUrl: null,
    });
  }

  const waarschuwingen: string[] = [];
  if (alleKandidaten.length > maxDetailFetches) {
    waarschuwingen.push(
      `${alleKandidaten.length} vacatures gevonden; voor de eerste ${maxDetailFetches} is ook de detailpagina bijgehaald, de rest bevat alleen overzichtsgegevens.`,
    );
  }
  if (!viaRest && facetwpTotaalPaginas && facetwpTotaalPaginas > paginaTeller) {
    waarschuwingen.push(
      `De WP REST API leverde niets op en de listingpagina gebruikt JavaScript-paginering (FacetWP): slechts ${paginaTeller} van ${facetwpTotaalPaginas} pagina('s) kon zonder JavaScript opgehaald worden.`,
    );
  }

  return {
    items,
    waarschuwing: waarschuwingen.length > 0 ? waarschuwingen.join(" ") : null,
  };
}
