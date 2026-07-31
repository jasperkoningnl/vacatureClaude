export interface BronSeed {
  naam: string;
  type: "rss" | "json" | "html" | "werkgever";
  config: Record<string, unknown>;
}

/**
 * Fase 1-bronnen. Werkenbijdeoverheid en de generieke werkgever-extractor
 * volgen in een latere stap, dit is bewust alleen wat nu al werkt.
 */
export const BRONNEN_SEED: BronSeed[] = [
  {
    naam: "oneworld",
    type: "rss",
    config: { url: "https://www.oneworld.nl/wpjobboard/xml/rss/?category=7" },
  },
  {
    naam: "villamedia",
    type: "rss",
    config: { url: "https://www.villamedia.nl/feeds/rss/vacatures" },
  },
  {
    naam: "werkenvoorcultuur",
    type: "html",
    config: { url: "https://werkenvoorcultuur.nl/vacatures" },
  },
];
