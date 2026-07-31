import { count, desc } from "drizzle-orm";
import type { CSSProperties } from "react";
import AdminActies from "./admin-acties";

export const dynamic = "force-dynamic";

interface BronStatus {
  naam: string;
  type: string;
  laatstGedraaid: Date | null;
  laatsteFout: string | null;
}

interface VacatureRij {
  id: number;
  bron: string;
  titel: string;
  werkgever: string | null;
  standplaats: string | null;
  url: string;
  status: string;
  aangemaaktOp: Date;
}

interface DbState {
  totaal: number;
  perBron: { bron: string; aantal: number }[];
  bronnenStatus: BronStatus[];
  laatste: VacatureRij[];
}

async function laadDbState(): Promise<{ data: DbState | null; fout: string | null }> {
  if (!process.env.DATABASE_URL) {
    return { data: null, fout: "DATABASE_URL is nog niet gezet in de omgevingsvariabelen." };
  }

  try {
    const { db } = await import("@/db/client");
    const { bronnen, vacatures } = await import("@/db/schema");

    const [totaalRij] = await db.select({ aantal: count() }).from(vacatures);
    const perBron = await db
      .select({ bron: vacatures.bron, aantal: count() })
      .from(vacatures)
      .groupBy(vacatures.bron);
    const bronnenStatus = await db
      .select({
        naam: bronnen.naam,
        type: bronnen.type,
        laatstGedraaid: bronnen.laatstGedraaid,
        laatsteFout: bronnen.laatsteFout,
      })
      .from(bronnen)
      .orderBy(bronnen.naam);
    const laatste = await db
      .select({
        id: vacatures.id,
        bron: vacatures.bron,
        titel: vacatures.titel,
        werkgever: vacatures.werkgever,
        standplaats: vacatures.standplaats,
        url: vacatures.url,
        status: vacatures.status,
        aangemaaktOp: vacatures.aangemaaktOp,
      })
      .from(vacatures)
      .orderBy(desc(vacatures.aangemaaktOp))
      .limit(20);

    return {
      data: { totaal: totaalRij?.aantal ?? 0, perBron, bronnenStatus, laatste },
      fout: null,
    };
  } catch (error) {
    return {
      data: null,
      fout:
        (error instanceof Error ? error.message : "Onbekende databasefout") +
        " (nog geen tabellen? Draai eerst de migratie hieronder.)",
    };
  }
}

export default async function TestResultsPage() {
  const { data, fout } = await laadDbState();

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1>Testresultaten ingest</h1>
      <p>Deze pagina toont de huidige staat van de database en laat je de pijplijn handmatig draaien.</p>

      <AdminActies />

      {fout && (
        <div style={{ background: "#fee", padding: 12, borderRadius: 4, marginBottom: 24 }}>
          <strong>Database nog niet klaar:</strong> {fout}
        </div>
      )}

      {data && (
        <>
          <section style={{ marginBottom: 24 }}>
            <h2>Overzicht</h2>
            <p>Totaal aantal vacatures in de database: {data.totaal}</p>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thTd}>Bron</th>
                  <th style={thTd}>Aantal</th>
                </tr>
              </thead>
              <tbody>
                {data.perBron.map((rij) => (
                  <tr key={rij.bron}>
                    <td style={thTd}>{rij.bron}</td>
                    <td style={thTd}>{rij.aantal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Bronnen status</h2>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={thTd}>Naam</th>
                  <th style={thTd}>Type</th>
                  <th style={thTd}>Laatst gedraaid</th>
                  <th style={thTd}>Laatste fout/waarschuwing</th>
                </tr>
              </thead>
              <tbody>
                {data.bronnenStatus.map((bron) => (
                  <tr key={bron.naam}>
                    <td style={thTd}>{bron.naam}</td>
                    <td style={thTd}>{bron.type}</td>
                    <td style={thTd}>
                      {bron.laatstGedraaid ? new Date(bron.laatstGedraaid).toLocaleString("nl-NL") : "-"}
                    </td>
                    <td style={thTd}>{bron.laatsteFout ?? "-"}</td>
                  </tr>
                ))}
                {data.bronnenStatus.length === 0 && (
                  <tr>
                    <td style={thTd} colSpan={4}>
                      Nog geen bronnen geseed. Klik hierboven op &quot;Bronnen seeden&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Laatste 20 vacatures</h2>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={thTd}>Titel</th>
                  <th style={thTd}>Werkgever</th>
                  <th style={thTd}>Standplaats</th>
                  <th style={thTd}>Bron</th>
                  <th style={thTd}>Status</th>
                  <th style={thTd}>Aangemaakt</th>
                  <th style={thTd}>Link</th>
                </tr>
              </thead>
              <tbody>
                {data.laatste.map((v) => (
                  <tr key={v.id}>
                    <td style={thTd}>{v.titel}</td>
                    <td style={thTd}>{v.werkgever ?? "-"}</td>
                    <td style={thTd}>{v.standplaats ?? "-"}</td>
                    <td style={thTd}>{v.bron}</td>
                    <td style={thTd}>{v.status}</td>
                    <td style={thTd}>{new Date(v.aangemaaktOp).toLocaleString("nl-NL")}</td>
                    <td style={thTd}>
                      <a href={v.url} target="_blank" rel="noreferrer">
                        open
                      </a>
                    </td>
                  </tr>
                ))}
                {data.laatste.length === 0 && (
                  <tr>
                    <td style={thTd} colSpan={7}>
                      Nog geen vacatures. Klik hierboven op &quot;Ingest draaien&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

const thTd: CSSProperties = {
  border: "1px solid #ddd",
  padding: "6px 10px",
  textAlign: "left",
  fontSize: 14,
};
