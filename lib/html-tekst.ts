import * as cheerio from "cheerio";

/**
 * Zet HTML om naar platte tekst: scripts/stijlen eruit, whitespace
 * samengevoegd. Gebruikt voor ruwe_tekst opslag en voor de generieke
 * werkgever-extractor die platte tekst aan Claude geeft.
 */
export function htmlNaarTekst(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const tekst = $.root().text();
  return tekst.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
