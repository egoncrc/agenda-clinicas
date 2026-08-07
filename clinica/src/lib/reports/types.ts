/**
 * Contratos de la sección de Reportes.
 *
 * La sección nace con 8 reportes y va a crecer. El costo real no es escribir el
 * reporte número 9: es que escribirlo obligue a tocar la barra de filtros, la
 * vista, el exportador a PDF y el de Excel. Por eso todo reporte se declara como
 * datos (`ReportDefinition`) y hay UNA vista y UN par de exportadores genéricos
 * que no saben qué reporte están mostrando.
 *
 * La pieza que lo hace posible es `ReportSection`: SIEMPRE lleva `columns` +
 * `rows`, incluso cuando en pantalla se dibuja como gráfico. El gráfico es una
 * forma de ver la tabla, no una estructura aparte — así el Excel y el PDF salen
 * de lo mismo sin que nadie escriba código de exportación por reporte.
 *
 * Agregar un reporte = un archivo nuevo en esta carpeta + una línea en
 * `registry.ts`. Nada más.
 */
import type { ClinicDoctor, ServiceRow, SpecialtyRow } from "@/lib/directus";

/**
 * Rol efectivo de quien mira. No es el nombre del rol de Directus: `admin` sale
 * de `admin_access` y `medico` es el caso por defecto (ver stores/auth.ts).
 */
export type ReportRole = "admin" | "recepcion" | "medico";

export type DatePreset = "hoy" | "semana" | "mes" | "personalizado";

/** Cómo desglosar los totales. Solo aplica a recepción/admin: un médico se ve a sí mismo. */
export type GroupBy = "especialidad" | "medico" | "ambos";

export interface ReportFilters {
  /** ISO, ya resueltos en CLINIC_TIMEZONE y con el día completo incluido. */
  desde: string;
  hasta: string;
  preset: DatePreset;
  /** `null` = todas las sedes a las que el usuario tiene acceso. */
  clinicId: string | null;
  /** Forzado al médico propio cuando el rol es `medico`. */
  doctorId: string | null;
  specialtyId: string | null;
  serviceId: string | null;
  groupBy: GroupBy;
}

/** Qué controles muestra la barra de filtros para un reporte dado. */
export type FilterKey = "rango" | "clinicId" | "doctorId" | "specialtyId" | "serviceId" | "groupBy";

export interface Kpi {
  label: string;
  value: string;
  /** Aclaración corta bajo el número (ej. "sobre 1.240 citas"). */
  hint?: string;
  tone?: "default" | "warn" | "danger" | "success";
}

export type ColumnFormat = "text" | "number" | "percent" | "hours" | "date" | "datetime";

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  /**
   * Cómo se presenta el valor crudo. El valor de `rows` se guarda SIEMPRE crudo
   * (number para `percent`/`hours`/`number`, ISO para las fechas): el Excel
   * necesita el número de verdad para poder ordenar y graficar, y la pantalla y
   * el PDF formatean al vuelo. Guardar "91%" como texto rompería la hoja.
   */
  format?: ColumnFormat;
}

export type SectionView = "table" | "bar" | "line" | "donut" | "calendar";

export interface ReportSection {
  id: string;
  title: string;
  /** Cómo se dibuja en pantalla. En Excel y PDF toda sección es una tabla. */
  view: SectionView;
  columns: Column[];
  rows: Record<string, unknown>[];
  /** Claves usadas por las vistas de gráfico. Si faltan, se toman las dos primeras columnas. */
  labelKey?: string;
  valueKey?: string;
  /** Segunda serie, solo para `line` (ej. nuevos vs recurrentes). */
  valueKey2?: string;
  /** Nota al pie de la sección: advertencias sobre los datos, no decoración. */
  note?: string;
}

export interface ReportResult {
  kpis: Kpi[];
  sections: ReportSection[];
  /** Advertencias de alcance que el usuario necesita para leer bien los números. */
  notes?: string[];
}

/**
 * Todo lo que un reporte necesita para traducir ids a nombres, resuelto una sola
 * vez por corrida. Se construye en `context.ts` sin filtrar por `activo`: un
 * médico dado de baja o un servicio retirado siguen apareciendo en las citas
 * históricas, y un reporte que los muestre como "(médico)" es un reporte roto.
 */
export interface ReportContext {
  /** Clínicas efectivamente consultadas (una, o todas las del usuario). */
  clinicIds: string[];
  clinicName(id: string): string;
  doctors: ClinicDoctor[];
  services: ServiceRow[];
  specialties: SpecialtyRow[];
  doctorName(id: string): string;
  serviceName(id: string): string;
  specialtyName(id: string): string;
  /**
   * Especialidad de una cita = la de su SERVICIO, no la del médico. El servicio
   * es lo que el paciente pidió, y a diferencia del médico (cuya especialidad
   * vive en la tabla puente y por tanto depende de la sede) no cambia según
   * dónde se atienda. Es el criterio único en todos los reportes.
   */
  specialtyOfService(serviceId: string): string | null;
  /** Solo para ocupación: las horas de agenda salen de `working_hours`, que no tiene servicio. */
  specialtyOfDoctor(doctorId: string): string | null;
  /**
   * TODAS las especialidades del médico, una por sede en la que trabaja
   * (`clinics_doctors.specialty` depende de la clínica). `specialtyOfDoctor`
   * devuelve solo la primera, que para un médico multi-sede es arbitraria; esto
   * es lo que la barra de filtros necesita para decirle a un médico a qué está
   * ligado sin mentirle.
   */
  specialtiesOfDoctor(doctorId: string): string[];
}

export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  /** Icono del catálogo (`ui/ReportIcon.vue`). */
  icon: string;
  roles: ReportRole[];
  filters: FilterKey[];
  run(filters: ReportFilters, ctx: ReportContext): Promise<ReportResult>;
}

/** Marcador único para las filas sin dato. No usar "" ni "-": hay que poder distinguirlo. */
export const SIN_DATO = "Sin especificar";
