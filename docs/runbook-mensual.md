# Carga mensual — guía para Insights

Para quien publica los datos cada mes (admin o aprobador en BIA Foresight). Toma unos 15 minutos y no necesita a Intelia.

## Antes de empezar

- Entra a BIA Foresight con tu correo, tu clave y el código de tu app de autenticación.
- Pide a BI su reporte del mes (Excel o CSV con venta neta y/o kg por mes, y si se puede por canal). Se usa en el paso 3c.

## 1. Exportar el mes del cubo

Exporta del cubo **solo el mes que cerró**, con las columnas de siempre:

Fecha · Ruta · Empresa · Marca · Café/Rep · Proveedor · Cliente Codigo · Cliente Nombre · Zona · Documento · Año · Mes Nom · Grupo · Canal BIA · ArtCodigo · ArtDescrip · Cantidad · Venta Bruta · Descuentos · Venta Neta · Kg · Fardos/Caja · Subgrupo · Sucursal

- Las columnas se reconocen **por nombre**: el orden no importa, ni las mayúsculas, tildes o signos. Columnas de más se ignoran.
- Si el cubo cambia el nombre de una columna (por ejemplo, «Kg» pasa a «Kilos»), la carga falla con «falta la columna de …». Pulsa **Arreglar las columnas de este archivo**: la plataforma sugiere la columna que sobra («Usar «Kilos» para kilos»), la agrega como nombre alternativo y deja **Reintentar** a mano. En **Columnas del Excel** también se configuran el nombre principal y los alternativos de cada dato, la fila de los encabezados, las hojas que se saltan y qué columnas descriptivas pueden faltar.

- El archivo debe ser `.xlsx` y pesar menos de 50 MB. Un mes son unas 60 mil filas, alrededor de 7 MB.
- Si necesitas corregir meses anteriores, inclúyelos en el mismo archivo o súbelos en otro. Cada mes que venga en un archivo **reemplaza** lo publicado de ese mes.
- La exportación completa del histórico (más de 50 MB) se carga por script: pídesela a Intelia.

## 2. Subir

En **Cargas y versiones → Carga del mes**, elige el archivo y pulsa **Subir y validar**. Lee y valida las filas; tarda uno o dos minutos.

Si sale un error, el mensaje dice la hoja y la fila. Los más comunes:

| Mensaje | Qué hacer |
|---|---|
| «falta la columna de …» o «hay varias columnas de …» | Una columna cambió de nombre, no vino o viene dos veces. El mensaje dice qué nombres se aceptan y qué encabezados trae el archivo. Si solo cambió el nombre, agrégalo en **Columnas del Excel**, prueba el archivo ahí mismo y pulsa **Reintentar**; si falta, vuelve a exportar. |
| «Este archivo ya se cargó» | Ese mismo archivo ya está en la plataforma. No hace falta subirlo otra vez. |
| «fecha inválida» o «valor numérico inválido» | Hay una celda con texto donde va una fecha o un número. Corrige la fila indicada y vuelve a exportar. |
| «No se encontró el archivo subido» | La subida se cortó. Pulsa **Reintentar** o **Descartar** y vuelve a subirlo. |

## 3. Revisar las alertas

Cuando la carga queda **Lista para publicar**, la plataforma la compara con lo que ya está publicado:

- **Bloquea:** no se puede publicar. Por ejemplo, ventas con fecha futura. Corrige el archivo, descarta la carga y súbela de nuevo.
- **Revisar:** hay que confirmarlo antes de publicar. Por ejemplo:
  - un mes ya publicado cambia más de 1 %;
  - un mes nuevo sube o baja más de 30 % contra el anterior;
  - faltan meses entre lo publicado y el archivo;
  - aparecen canales que no están en la homologación (ver paso 3b);
  - un canal sube o baja de golpe (ver abajo);
  - hay muchas filas repetidas.
- **Info:** no requiere acción. Por ejemplo, si el último mes está completo o es parcial.

**Alertas por canal.** Además de los totales del mes, la plataforma compara cada canal BIA:

| Caso | Contra qué | Alerta «Revisar» si el canal cambia más de |
|---|---|---|
| El mes ya estaba publicado (lo reemplaza) | Lo publicado para ese mes | 5 % |
| El mes es nuevo | Promedio de los 3 meses anteriores publicados | 25 % |

Se ignoran los canales chicos (menos de 3 % de la venta neta del mes, en el archivo y en la referencia). No se compara un mes nuevo parcial, ni un mes que reemplaza a otro con distintos días (eso ya lo dicen las alertas del mes). Del promedio salen los meses publicados como parciales. Ejemplo: «Octubre 2026: Detalle baja 38 % frente al promedio de los 3 meses anteriores (L 1.2 M contra L 1.9 M)». También avisa si un canal con peso desaparece o aparece.

Si una alerta no tiene explicación, no publiques: descarta la carga y revisa la exportación.

## 3b. Homologar canales nuevos (solo si BIA ya decidió)

Si aparece «canales sin homologar», el canal viene escrito distinto en el cubo («MAYOREO NORTE», «B2C»…). En **Cargas y versiones → Homologación de canales**:

1. La tabla «Canales sin homologar» muestra cada canal de origen con sus filas y su venta neta por carga y mes.
2. Si BIA ya dijo a qué canal BIA va, pulsa **Homologar**, elige el canal BIA y guarda. Un canal BIA nuevo hay que confirmarlo aparte.
3. La carga que está lista para publicar se actualiza al momento: vuelve a **Cargas y versiones** y revisa otra vez sus alertas.

Si BIA todavía no decidió (hoy pasa con SEMI-MAYOREO y PENDIENTE), **no lo homologues**: se publica con su nombre de origen y la alerta lo recuerda.

Los meses ya publicados **no cambian** al editar la homologación: siguen con el canal con que se publicaron. Para corregirlos, vuelve a subir el Excel de esos meses y publícalo; queda como una versión nueva. Cada cambio queda en el historial de la página (quién, cuándo, antes y después, y qué cargas se actualizaron).

## 3c. Control de BI

En la tarjeta de la carga, **Control de BI → Elegir reporte de BI**:

- El archivo de BI (`.xlsx` o `.csv`, hasta 900 KB) con las columnas **Año**, **Mes** (número o nombre), **Empresa** y **Canal** si BI los separa, y **Venta Neta** y/o **Kg**. Una fila por clave; las filas de total se ignoran. Números con punto decimal («1234.56» o «1,234.56»).
- Quién lo generó en BI, la fecha de corte del reporte y cuántos decimales trae BI en kg (venta neta se compara al centavo).

La plataforma compara cifra por cifra al mismo nivel que el reporte y muestra cada diferencia (Foresight, BI y diferencia) y los meses que solo están de un lado. No hay tolerancia: si un centavo difiere, no coincide.

- **Coincide:** al publicar con el último mes completo, la versión queda **conciliada con BI** sola, con el nombre del reporte, quién lo generó y el corte.
- **No coincide o no hay control:** sale una alerta «Revisar». Se puede aprobar y publicar escribiendo el motivo, pero la versión queda **sin conciliar con BI**. Revisa la diferencia con BI antes de comunicar cifras.

Si el reporte de BI llega después de publicar, súbelo en **Conciliar vN con BI**, debajo de la tabla de versiones: si coincide (y el mes se publicó completo), la versión vigente queda conciliada.

## 4. Aprobar y publicar

Son dos pasos. Los puede hacer la misma persona; cada uno queda en el historial con quién lo hizo y con qué rol (aprobador o admin).

**Aprobar la carga**

1. Marca si el último mes está **completo**. Si lo dejas sin marcar, el dashboard lo muestra como parcial y las comparaciones lo advierten.
2. Si hay alertas «Revisar», escribe por qué se aceptan (por ejemplo, «Octubre se reexportó con las notas de crédito; Ventas confirmó el cambio en Detalle»). El motivo y las alertas quedan guardados con la versión.
3. Pulsa **Aprobar la carga**. Todavía no cambia nada para el equipo.

Si después de aprobar cambia algo de la carga (una homologación de canales o se publica otra versión), la aprobación deja de valer: la tarjeta lo dice y hay que revisar las alertas y aprobar de nuevo. **Quitar la aprobación** (con motivo) la anula si se aprobó por error.

**Publicar**

1. Escribe una nota corta (qué trae, quién exportó, algo que el equipo deba saber).
2. Si quieres avisar al equipo, marca **Enviar el resumen por correo**. Llega a todas las personas con acceso activo, una por una, con el resumen del último mes cerrado y el enlace. Solo se envía desde la plataforma en producción; en desarrollo no se envían correos.
3. Pulsa **Publicar vN**. Tarda unos segundos.

Desde ese momento, el dashboard y el asistente muestran la versión nueva. La cabecera indica el número de versión y la fecha de corte.

## 4b. Resumen ejecutivo del mes

Al publicar, la página muestra el enlace **Ver el resumen ejecutivo del mes**. También está en cada versión de la tabla (enlace «Resumen del mes») y en `/resumen`, para cualquiera con acceso.

- Muestra venta neta, volumen, precio por kg y clientes con compra del último mes cerrado, contra el mes anterior y contra el mismo mes del año anterior.
- Lista los canales, rutas y marcas que más explican la variación.
- Avisa si el mes es parcial, si la versión no está conciliada con BI o si fue retirada.
- Se puede elegir otra versión u otro mes arriba.
- **Imprimir o guardar PDF** deja una hoja limpia, sin el menú, para mandarla o llevarla a una reunión.

Si la versión todavía no está conciliada con BI, el resumen lo dice. Concilia (paso 3c) antes de circular cifras.

## 5. Conciliar con BI

Ya no se marca a mano: la conciliación sale del control de BI (paso 3c). Si la versión vigente quedó sin conciliar, sube el reporte de BI en **Conciliar vN con BI**.

## Si algo salió mal

En la versión vigente pulsa **Retirar** y escribe el motivo. Vuelve a regir la versión anterior y el retiro queda en el historial. Después sube el archivo corregido.

Solo se puede retirar la versión vigente, y siempre tiene que quedar al menos una versión publicada.
