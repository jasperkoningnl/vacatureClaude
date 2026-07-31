"use client";

import { useState } from "react";

interface ActieResultaat {
  label: string;
  response: unknown;
  fout: string | null;
}

const ACTIES = [
  { label: "1. Migreren (schema aanmaken)", path: "/api/admin/migrate" },
  { label: "2. Bronnen seeden", path: "/api/admin/seed-bronnen" },
  { label: "3. Ingest draaien", path: "/api/ingest" },
] as const;

export default function AdminActies() {
  const [secret, setSecret] = useState("");
  const [bezig, setBezig] = useState<string | null>(null);
  const [resultaten, setResultaten] = useState<ActieResultaat[]>([]);

  async function voerActieUit(label: string, path: string) {
    setBezig(label);
    try {
      const response = await fetch(`${path}?secret=${encodeURIComponent(secret)}`, {
        method: "POST",
      });
      const json = await response.json();
      setResultaten((huidig) => [
        { label, response: json, fout: response.ok ? null : String(json.error ?? "Fout") },
        ...huidig,
      ]);
    } catch (error) {
      setResultaten((huidig) => [
        {
          label,
          response: null,
          fout: error instanceof Error ? error.message : "Onbekende fout",
        },
        ...huidig,
      ]);
    } finally {
      setBezig(null);
    }
  }

  return (
    <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h2>Beheeracties</h2>
      <p>
        Voer eerst je ADMIN_SECRET in (dezelfde waarde als in de Vercel env var), en klik dan de
        stappen in volgorde: migreren, seeden, ingest draaien.
      </p>
      <input
        type="password"
        placeholder="ADMIN_SECRET"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        style={{ padding: 8, width: 280, marginBottom: 12 }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ACTIES.map((actie) => (
          <button
            key={actie.path}
            onClick={() => voerActieUit(actie.label, actie.path)}
            disabled={bezig !== null || secret.length === 0}
            style={{ padding: "8px 12px" }}
          >
            {bezig === actie.label ? "Bezig..." : actie.label}
          </button>
        ))}
      </div>
      {resultaten.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Resultaten (nieuwste eerst)</h3>
          {resultaten.map((resultaat, index) => (
            <pre
              key={index}
              style={{
                background: "#f5f5f5",
                padding: 12,
                borderRadius: 4,
                overflowX: "auto",
                fontSize: 12,
              }}
            >
              {resultaat.label}
              {"\n"}
              {resultaat.fout ? `Fout: ${resultaat.fout}` : JSON.stringify(resultaat.response, null, 2)}
            </pre>
          ))}
        </div>
      )}
    </section>
  );
}
