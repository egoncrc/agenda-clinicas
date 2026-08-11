/**
 * Composición del filtro y del orden de la tabla de pacientes. Vive acá, puro y
 * sin Directus, porque la paginación es del lado del servidor: filtrar u ordenar
 * en el cliente solo afectaría a la página visible.
 */

export type EstadoFilter = "activos" | "inactivos" | "todos";

/** Filtros de la fila de encabezado. Estado va aparte: es un select, no texto. */
export interface PatientColumnFilters {
  nombre: string;
  telefono: string;
  identificacion: string;
  correo: string;
  ubicacion: string;
}

export const EMPTY_COLUMN_FILTERS: PatientColumnFilters = {
  nombre: "",
  telefono: "",
  identificacion: "",
  correo: "",
  ubicacion: "",
};

export type PatientSortKey = keyof PatientColumnFilters | "estado";

export interface PatientSort {
  key: PatientSortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: PatientSort = { key: "nombre", dir: "asc" };

/**
 * Devuelve siempre un `_and`: el buscador global usa `_or` y el filtro de
 * Ubicación necesita otro, y sobre un objeto plano el segundo pisaría al primero
 * sin dar error — la tabla mostraría resultados de un solo filtro.
 */
export function buildPatientFilter(input: {
  clinicId: string | undefined;
  estado: EstadoFilter;
  search: string;
  columns: PatientColumnFilters;
}): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [{ clinic: { _eq: input.clinicId } }];

  // `_neq: false` en vez de `_eq: true`: una fila creada fuera del panel puede
  // tener `activo` en NULL y no por eso está dada de baja.
  if (input.estado === "activos") conditions.push({ activo: { _neq: false } });
  else if (input.estado === "inactivos") conditions.push({ activo: { _eq: false } });

  const query = input.search.trim();
  if (query) {
    conditions.push({
      _or: [
        { nombre: { _icontains: query } },
        { telefono: { _contains: query } },
        { identificacion: { _icontains: query } },
        { correo: { _icontains: query } },
      ],
    });
  }

  const nombre = input.columns.nombre.trim();
  if (nombre) conditions.push({ nombre: { _icontains: nombre } });

  // Teléfono va con `_contains` (dígitos, no texto), igual que en el buscador global.
  const telefono = input.columns.telefono.trim();
  if (telefono) conditions.push({ telefono: { _contains: telefono } });

  const identificacion = input.columns.identificacion.trim();
  if (identificacion) conditions.push({ identificacion: { _icontains: identificacion } });

  const correo = input.columns.correo.trim();
  if (correo) conditions.push({ correo: { _icontains: correo } });

  // "Ubicación" no existe como columna: es distrito + cantón + provincia.
  const ubicacion = input.columns.ubicacion.trim();
  if (ubicacion) {
    conditions.push({
      _or: [
        { distrito: { _icontains: ubicacion } },
        { canton: { _icontains: ubicacion } },
        { provincia: { _icontains: ubicacion } },
      ],
    });
  }

  return { _and: conditions };
}

type PatientSortField =
  | "nombre"
  | "telefono"
  | "identificacion"
  | "correo"
  | "distrito"
  | "canton"
  | "provincia"
  | "activo";

/** El SDK tipa `sort` como `Field | \`-${Field}\``, así que no sirve un `string[]`. */
export type PatientSortToken = PatientSortField | `-${PatientSortField}`;

const SORT_FIELDS: Record<PatientSortKey, readonly PatientSortField[]> = {
  nombre: ["nombre"],
  telefono: ["telefono"],
  identificacion: ["identificacion"],
  correo: ["correo"],
  // Mismo orden en que se arma el texto visible (`distrito, cantón, provincia`),
  // para que la columna se lea ordenada.
  ubicacion: ["distrito", "canton", "provincia"],
  // Ojo: `activo` en NULL no es `false` y Postgres lo manda al final en ASC, así
  // que las filas creadas fuera del panel (que se muestran como "Activo") no
  // quedan agrupadas con las `true`. Sin campo calculado no hay forma de evitarlo.
  estado: ["activo"],
};

export function patientSort(sort: PatientSort): PatientSortToken[] {
  return SORT_FIELDS[sort.key].map((field) => (sort.dir === "desc" ? (`-${field}` as PatientSortToken) : field));
}

/** Clic en un encabezado: la misma columna invierte, otra arranca ascendente. */
export function nextSort(current: PatientSort, key: PatientSortKey): PatientSort {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
}
