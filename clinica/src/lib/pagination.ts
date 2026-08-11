export function totalPages(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(1, page), pages);
}

export function pageRangeLabel(page: number, pageSize: number, totalCount: number): string {
  if (totalCount === 0) return "Sin resultados";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  return `Mostrando ${from}–${to} de ${totalCount}`;
}
