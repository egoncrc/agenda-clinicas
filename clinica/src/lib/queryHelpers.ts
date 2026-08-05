/**
 * El SDK de Directus (@directus/sdk) solo habilita los operadores de fecha
 * (_gte/_lte/_gt/_lt) en el tipado si el campo del Schema está marcado con el
 * literal 'datetime' — pero esa marca rompe a su vez los payloads de
 * createItem/updateItem, que usan el tipo crudo del Schema (mismo hueco de
 * tipado ya documentado en el bot, src/repositories/appointments.ts). Se
 * mantienen los campos de fecha como `string` (simple para escribir) y se usa
 * este helper para pasar filtros de rango: el filtro sí funciona en runtime,
 * es solo el tipado del SDK el que no lo permite.
 */
export function dateRangeFilter(gte?: string, lte?: string): never {
  const filter: Record<string, string> = {};
  if (gte !== undefined) filter._gte = gte;
  if (lte !== undefined) filter._lte = lte;
  return filter as never;
}

/**
 * Mismo workaround para una sola comparación. Hace falta para los filtros de
 * solape (`inicio _lt finAusencia` **y** `fin _gt inicioAusencia`, más un tercer
 * `inicio _gt now`), que se componen dentro de un `_and` explícito porque
 * `dateRangeFilter` produce un objeto plano y repetiría la clave `inicio`.
 */
export function dateCompareFilter(op: "_lt" | "_lte" | "_gt" | "_gte", iso: string): never {
  return { [op]: iso } as never;
}
