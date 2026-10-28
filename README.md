# BIA Foresight

Plataforma privada de inteligencia comercial para BIA Honduras (piloto Marketing y Ventas): ventas internas del cubo → dashboard + asistente con evidencia, con perfiles Estándar/Plus.

Stack: Next.js (App Router, TS) · Tailwind · Supabase (Postgres, Storage, Auth) · OpenRouter · Resend · Vercel.

## Arranque

```sh
cp .env.example .env.local        # llenar con el proyecto Supabase de desarrollo
npm install
npx shadcn@latest init             # UI: preferencia shadcn/ui (no se pudo instalar en el scaffold inicial)
npm run dev
```

Base de datos: aplicar `supabase/migrations/*.sql` en orden (Supabase CLI `supabase db push` o SQL editor) y cargar `supabase/seed/homologacion_canal.csv` en `ventas.homologacion`.

Ingesta del histórico (G2):

```sh
XLSX_PATH="…/Data Historica.xlsx" npm run ingest
PARITY_DIR="…/marketing/analisis" PARITY_CARGA_ID=<uuid> npm test   # paridad con el perfil en pandas
```

## Estructura

- `docs/GOALS.md` · `docs/SUPUESTOS.md` · `docs/backlog.md` — qué, con qué supuestos y en qué orden.
- `supabase/migrations/0001_init.sql` — cargas, publicaciones versionadas, homologación, hechos (24 campos + flags), perfiles.
- `supabase/migrations/0002_funciones.sql` — **único punto de cálculo**: `kpi_periodo`, `variacion_por_dimension`, `serie_mensual`, `control_mensual`.
- `src/lib/semantic/` — contrato tipado (zod) que usan dashboard, asistente y exportación.
- `src/lib/supabase/` — clientes (usuario con RLS / servicio).
- `src/app/` — Inicio (dashboard del prototipo), Asistente, Cargas y versiones, Conocimiento, Perfiles y accesos.
- `scripts/ingest.ts` — XLSX → `ventas.hecho` en streaming, idempotente por SHA-256, con flags (duplicado, discrepancia, fecha serial).
- `tests/parity.test.ts` — totales mensuales en DB == `analisis/totales_por_mes.csv`.

## Reglas que no se negocian
- Importes en `numeric`; nunca redondear en JavaScript.
- Dashboard, chat y exportación leen la misma versión publicada y las mismas funciones SQL.
- Nunca "conciliado con BI" por coincidir con el Excel: requiere el reporte de BI.
- `subgrupo` y datos de cliente no se envían al modelo de IA. Secretos solo en servidor.
