export interface RuweVacature {
  bron: string;
  bronId: string | null;
  url: string;
  titel: string;
  werkgever: string | null;
  standplaats: string | null;
  urenMin: number | null;
  urenMax: number | null;
  dienstverband: string | null;
  publicatiedatum: Date | null;
  sluitingsdatum: Date | null;
  ruweTekst: string | null;
  werkgeverUrl: string | null;
}

export interface OphaalResultaat {
  items: RuweVacature[];
  waarschuwing: string | null;
}
