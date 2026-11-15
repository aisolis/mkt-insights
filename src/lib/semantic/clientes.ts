import { z } from "zod";
import type { Rpc } from "./consultas";
import { KpiRequest } from "./contracts";

/**
 * Clientes por estado (G9, solo Plus). Primer y único lugar con detalle por cliente: código y nombre.
 * El cálculo vive en PostgreSQL (supabase/migrations/0015_clientes.sql) y la base exige perfil Plus.
 * S15/S22: nada de este archivo se usa en el asistente; el detalle por cliente nunca va al modelo de IA.
 */

/** Estados que se pueden listar. "activos" = nuevos + recuperados + continúan; "en_riesgo" es parte de "continúan". */
export const EstadoCliente = z.enum(["activos", "nuevos", "recuperados", "continuan", "en_riesgo", "perdidos"]);
export type EstadoCliente = z.infer<typeof EstadoCliente>;

/** Estado pedido en la URL (?ver=perdidos); por defecto los perdidos, lo más accionable. */
export function leerEstadoCliente(v: string | string[] | undefined): EstadoCliente {
  const r = EstadoCliente.safeParse(Array.isArray(v) ? v[0] : v);
  return r.success ? r.data : "perdidos";
}

const Totales = z.object({ clientes: z.number(), venta: z.number(), venta_cmp: z.number() });
export type TotalesEstado = z.infer<typeof Totales>;

/** Clientes por ruta principal: la ruta donde más compró en el periodo (en el comparado, si es perdido). */
export const FilaRutaClientes = z.object({
  ruta: z.string(),
  activos: z.number(), nuevos: z.number(), recuperados: z.number(), continuan: z.number(), perdidos: z.number(), en_riesgo: z.number(),
  venta_activos: z.number(),       // venta del periodo de sus clientes activos
  venta_perdidos_cmp: z.number(),  // lo que compraban en el periodo comparado los que se perdieron
});
export type FilaRutaClientes = z.infer<typeof FilaRutaClientes>;

export const ResumenClientesRequest = KpiRequest;
export const ResumenClientes = z.object({
  umbral_riesgo: z.number(),
  estados: z.object({ activos: Totales, nuevos: Totales, recuperados: Totales, continuan: Totales, en_riesgo: Totales, perdidos: Totales }),
  por_ruta: z.array(FilaRutaClientes),
});
export type ResumenClientes = z.infer<typeof ResumenClientes>;

export const ListaClientesRequest = KpiRequest.extend({
  estado: EstadoCliente,
  limite: z.number().int().min(1).max(50000).default(50),
  desplazamiento: z.number().int().min(0).default(0),
});
export const ClienteFila = z.object({
  empresa: z.string(),
  cliente_codigo: z.string(),
  cliente_nombre: z.string().nullable(),
  ruta: z.string(),
  estado: z.enum(["nuevo", "recuperado", "continua", "perdido"]),
  en_riesgo: z.boolean(),
  venta: z.number(),
  venta_cmp: z.number(),
  variacion: z.number(),
  ultima_compra: z.string().nullable(),
});
export type ClienteFila = z.infer<typeof ClienteFila>;
export const ListaClientes = z.object({ total: z.number(), filas: z.array(ClienteFila) });
export type ListaClientes = z.infer<typeof ListaClientes>;

/** Las consultas de clientes sobre cualquier transporte (app: consultasClientesSesion; tests: cliente directo). */
export function crearConsultasClientes(rpc: Rpc) {
  return {
    clientesResumen(req: z.input<typeof ResumenClientesRequest>) {
      const r = ResumenClientesRequest.parse(req);
      return rpc("clientes_resumen", {
        p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
        p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
      }, ResumenClientes);
    },

    clientesLista(req: z.input<typeof ListaClientesRequest>) {
      const r = ListaClientesRequest.parse(req);
      return rpc("clientes_lista", {
        p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
        p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
        p_estado: r.estado, p_limite: r.limite, p_desplazamiento: r.desplazamiento,
      }, ListaClientes);
    },
  };
}

/**
 * Para la app (páginas y route handlers): lee con la sesión del usuario, así la base aplica el control Plus.
 * Los módulos de servidor se cargan aquí adentro para que las pruebas importen este archivo sin Next.
 */
export async function consultasClientesSesion() {
  const [{ createClient }, { connection }] = await Promise.all([import("@/lib/supabase/server"), import("next/server")]);
  const rpc: Rpc = async (fn, args, schema) => {
    await connection(); // las cifras dependen de la versión publicada al momento del request
    const supabase = await createClient();
    const { data, error } = await supabase.schema("ventas").rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return schema.parse(data);
  };
  return crearConsultasClientes(rpc);
}

/** Nombre y explicación en lenguaje sencillo de cada estado (pantalla y exportación). */
export const ESTADOS_CLIENTE: Record<EstadoCliente, { titulo: string; explicacion: (periodo: string, comparado: string, umbralPct: string) => string }> = {
  activos: {
    titulo: "Activos",
    explicacion: (p) => `Compraron en ${p} (venta neta del mes mayor que cero). Son los "clientes con compra" del dashboard: nuevos + recuperados + siguen comprando. Su venta puede pasar un poco la venta neta del mes: no resta a los clientes que ese mes quedaron en negativo por devoluciones.`,
  },
  nuevos: {
    titulo: "Nuevos",
    explicacion: (p) => `Su primera compra registrada es en ${p}: no tienen compras en ningún mes anterior de la versión publicada.`,
  },
  recuperados: {
    titulo: "Recuperados",
    explicacion: (p, c) => `Compraron en ${p}, no compraron en ${c}, pero sí habían comprado en algún mes anterior.`,
  },
  continuan: {
    titulo: "Siguen comprando",
    explicacion: (p, c) => `Compraron en ${p} y también en ${c}.`,
  },
  en_riesgo: {
    titulo: "En riesgo",
    explicacion: (p, c, u) => `Siguen comprando, pero en ${p} compraron más de ${u} menos que en ${c}.`,
  },
  perdidos: {
    titulo: "Perdidos",
    explicacion: (p, c) => `Compraron en ${c} y no compraron en ${p}.`,
  },
};
