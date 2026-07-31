/**
 * Voert `taak` uit voor elk item met maximaal `concurrency` tegelijk, in
 * plaats van strikt sequentieel. Gebruikt op plekken waar per item een
 * netwerk- of databasecall gebeurt (bv. detailpagina's ophalen, dedup-checks
 * doen) om te voorkomen dat het tijdsbudget van een serverless functie wordt
 * overschreden puur door wachten op onafhankelijke I/O.
 */
export async function voerBeperktParallelUit<T, R>(
  items: T[],
  concurrency: number,
  taak: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultaten: R[] = new Array(items.length);
  let volgendeIndex = 0;

  async function werker(): Promise<void> {
    for (;;) {
      const index = volgendeIndex++;
      if (index >= items.length) return;
      resultaten[index] = await taak(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => werker()));
  return resultaten;
}
