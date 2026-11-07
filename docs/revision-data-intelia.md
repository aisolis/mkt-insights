# Revisión de `Data_Intelia.xlsx` (recibido el 6-nov-2026)

BIA envió un libro con tres hojas. Las tres se compararon contra la versión publicada v1 (exportación completa `Data Historica.xlsx`) en el Supabase local.

## Hoja «1. Venta-Kilos x Canal Sep 026»

1,855 filas agregadas por mes, empresa, canal, ruta, grupo y marca (kilos y venta neta). Solo trae MCM; GKSA no tiene ventas en septiembre 2026 en ninguna de las dos fuentes.

- **Total septiembre 2026, MCM:** coincide al centavo, L 140,170,115.00 y 641,341.19 kg.
- **Por canal:** Exportación, Gobierno, Institucional y Moderno coinciden al centavo. Detalle y Mayoreo difieren en L 749.90 y 185.47 kg en sentidos opuestos.
- **Causa de la diferencia:** el resumen clasifica Detalle y Mayoreo de otra forma que la columna «Canal BIA» de cada línea. En 22 rutas de la zona norte (rutas 5xx) unos L 239 mil pasan de un canal al otro en cada sentido. El efecto neto es L 749.90.
- **Grupo:** el resumen escribe «Banasupro» donde el cubo trae «BANASUPRO» y «Banasupro» (ruta 130).

Pendiente con BIA:

- Confirmar si esta hoja es el reporte oficial de BI. Si lo es, la v1 se puede marcar «conciliada con BI» con nota sobre el total.
- Confirmar qué canal manda cuando una línea y su ruta difieren.

## Hoja «2.Cierre Oct 026»

61,754 líneas de octubre 2026 (1 al 31), con las mismas 24 columnas del cubo. Solo trae MCM.

Se procesó con la carga de la app en 31 s y quedó «Lista para publicar», sin publicar. Las alertas son:

- **Revisar:** las otras dos hojas no tienen el formato del cubo y no se cargaron (esperado).
- **Revisar:** reemplaza octubre 2026: L 25.5 M → L 153.1 M. Es esperable: lo publicado llegaba solo hasta el 15-oct.
- **Revisar:** dos canales sin homologar, SEMI-MAYOREO (L 188, 2 líneas) y PENDIENTE (L 906.89, 7 líneas).
- **Información:** 434 líneas repetidas (0.7 %), que se conservan y se marcan (S3). Hay 20 líneas sin canal (L 1,801.92), que caen en «Sin canal».

Para publicar hay que decidir a qué canal van SEMI-MAYOREO y PENDIENTE, o publicar dejándolos con su nombre de origen (suman L 1,094.89).

## Hoja «3.Ene025-Sep026»

46,123 filas agregadas por trimestre (no línea por línea), así que no sirve para cargar. Sí sirve para verificar S1, la posible hoja truncada en 1,000,000 filas.

| Periodo | Empresa | Diferencia (resumen − cubo) |
|---|---|---|
| 2025 T1 | GKSA | +L 305,046.47 (0.18 %) |
| 2025 T1 | MCM | +L 30,563.49 (0.01 %) |
| 2025 T2 | GKSA | +L 79,638.94 (0.54 %) |
| 2025 T2 | MCM | 0 |
| 2025 T3 a 2026 T3 | MCM y GKSA | 0 (al centavo, también en kg) |

La hoja no está cortada al final: el total cuadra hasta septiembre 2026. Las diferencias están al principio de 2025 y suman L 415 mil (0.05 % de esos meses), probablemente por ajustes posteriores a la exportación. Con esto, la marca «sin certificar» queda solo en enero a junio de 2025 (antes iba de enero 2025 a agosto 2026).

La columna «N° Facturas» suma facturas por fila agregada (cada factura cuenta una vez por ruta y producto), así que no es comparable con el conteo de facturas del cubo.
