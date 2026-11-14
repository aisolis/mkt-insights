# Despliegue: Supabase en la nube y Vercel

Entorno compartido para desarrollar y revisar. **Sin ventas reales**: la base tiene la estructura completa, la homologación de canales y los usuarios del equipo. Las ventas se cargan con archivos de prueba o, cuando BIA/TI lo aprueben (Q13), con la exportación real.

## Qué hay

| Pieza | Dónde | Notas |
|---|---|---|
| Base de datos, Auth y archivos | Supabase, región us-west-2 (Oregón), plan gratis | Migraciones 0001–0027 aplicadas y registradas en `supabase_migrations.schema_migrations` |
| Web | Vercel, importada desde GitHub `biahndcompras/mkt-insights` | Corre en `pdx1` (Oregón, junto a la base). Cada push a `main` se publica; cada rama tiene su vista previa |
| Claves | `.env.nube` en el equipo de quien administra (ignorado por git) | Nunca en el repositorio ni en el chat |

## Configuración ya aplicada en Supabase

- Exponer en la API de datos los esquemas `public, graphql_public, ventas, conocimiento` (como en `supabase/config.toml`).
- Auth: registro cerrado (solo por invitación), clave de 10+ caracteres con letras y números, 2FA TOTP activo, códigos de correo válidos 24 h, URLs permitidas `localhost:3000` y la de Vercel.
- Archivos privados: `cargas` (50 MB), `conocimiento` (20 MB), `controles-bi` (1 MB).

**Pendiente:** las plantillas de correo en español (`supabase/templates`) no se pueden subir en el plan gratis sin un correo propio. Al configurar Resend (Auth → SMTP) se cargan. Mientras tanto las cuentas se crean sin correo (abajo).

## Variables en Vercel (Settings → Environment Variables)

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (solo servidor) |
| `OPENROUTER_API_KEY` | Llave de OpenRouter (sin ella el asistente responde en modo automático) |
| `OPENROUTER_MODEL` | `deepseek/deepseek-v4.1-flash` |
| `OPENROUTER_EMBEDDING_MODEL` | `baai/bge-m3` |

No van a Vercel: `SUPABASE_DB_URL` ni `SUPABASE_ACCESS_TOKEN` (solo para migraciones y configuración).

## Dar acceso a una persona

Sin correo propio, se crea la cuenta con una clave temporal (se muestra una sola vez en la terminal):

```bash
npm run invitar -- persona@correo.com "Nombre" plus --admin --nube --sin-correo
```

Sin `--admin` queda sin administración; `estandar` en vez de `plus` quita el detalle por cliente. Al entrar por primera vez configura el 2FA con una app de autenticación. Después, el admin maneja perfiles, permisos y ámbitos en **Perfiles y accesos**.

## Una migración nueva

1. Crear `supabase/migrations/00NN_nombre.sql` y probarla en local (`docker exec -i supabase_db_bia-foresight psql -U postgres -d postgres -v ON_ERROR_STOP=1 < archivo`).
2. Aplicarla en la nube con la Supabase CLI (`npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`): la CLI ve las 27 primeras como ya aplicadas y sube solo las nuevas.
3. Hacer push: Vercel publica la web.

## Límites del plan gratis

- Supabase pausa el proyecto tras 7 días sin uso (se reactiva desde el panel) y la base admite 500 MB: el histórico real ocupa ~451 MB, así que con datos reales hace falta el plan Pro.
- Vercel ejecuta cada función hasta 300 s: alcanza para procesar un mes (~60 mil filas); el histórico completo se carga por script.
