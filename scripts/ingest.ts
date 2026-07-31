import { ingestAlleBronnen } from "@/lib/ingest";

/**
 * Draait de volledige ingest buiten Vercel om, bv. vanuit een GitHub Action.
 * Een Action-runner heeft geen 60s-functietijdslimiet, dus dit voorkomt dat
 * de ingest vastloopt zodra een bron tientallen items met detailpagina's
 * oplevert. Verbindt rechtstreeks met de database via DATABASE_URL; de
 * ADMIN_SECRET/HTTP-route zijn hier niet nodig.
 */
async function main(): Promise<void> {
  const resultaten = await ingestAlleBronnen();

  let heeftFout = false;
  for (const resultaat of resultaten) {
    if (resultaat.fout) {
      heeftFout = true;
      console.error(`[ingest] ${resultaat.bron}: FOUT - ${resultaat.fout}`);
      continue;
    }
    const waarschuwing = resultaat.waarschuwing ? ` (waarschuwing: ${resultaat.waarschuwing})` : "";
    console.log(
      `[ingest] ${resultaat.bron}: ${resultaat.gevonden} gevonden, ${resultaat.nieuw} nieuw, ${resultaat.duplicaten} duplicaten${waarschuwing}`,
    );
  }

  if (heeftFout) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[ingest] Onverwachte fout tijdens de run:", error);
  process.exitCode = 1;
});
