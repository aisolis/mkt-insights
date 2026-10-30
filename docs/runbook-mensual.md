# Carga mensual — guía para Insights

Para quien publica los datos cada mes (admin o aprobador en BIA Foresight). Toma unos 15 minutos y no necesita a Intelia.

## Antes de empezar

- Entra a BIA Foresight con tu correo, tu clave y el código de tu app de autenticación.
- Ten a mano el reporte de BI del mes (Power BI o Excel con venta neta y kg por canal). Se usa en el paso 5.

## 1. Exportar el mes del cubo

Exporta del cubo **solo el mes que cerró**. Mantén las mismas 24 columnas y el mismo orden de siempre:

Fecha · Ruta · Empresa · Marca · Café/Rep · Proveedor · Cliente Codigo · Cliente Nombre · Zona · Documento · Año · Mes Nom · Grupo · Canal BIA · ArtCodigo · ArtDescrip · Cantidad · Venta Bruta · Descuentos · Venta Neta · Kg · Fardos/Caja · Subgrupo · Sucursal

- El archivo debe ser `.xlsx` y pesar menos de 50 MB. Un mes son unas 60 mil filas, alrededor de 7 MB.
- Si necesitas corregir meses anteriores, inclúyelos en el mismo archivo o súbelos en otro. Cada mes que venga en un archivo **reemplaza** lo publicado de ese mes.
- La exportación completa del histórico (más de 50 MB) se carga por script: pídesela a Intelia.

## 2. Subir

En **Cargas y versiones → Carga del mes**, elige el archivo y pulsa **Subir y validar**. Lee y valida las filas; tarda uno o dos minutos.

Si sale un error, el mensaje dice la hoja y la fila. Los más comunes:

| Mensaje | Qué hacer |
|---|---|
| «la columna N debería ser …» | El archivo no tiene el formato del cubo. Vuelve a exportarlo con las mismas columnas. |
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
  - aparecen canales que no están en la homologación;
  - hay muchas filas repetidas.
- **Info:** no requiere acción. Por ejemplo, si el último mes está completo o es parcial.

Si una alerta no tiene explicación, no publiques: descarta la carga y revisa la exportación.

## 4. Publicar

1. Escribe una nota corta (qué trae, quién exportó, algo que el equipo deba saber).
2. Marca si el último mes está **completo**. Si lo dejas sin marcar, el dashboard lo muestra como parcial y las comparaciones lo advierten.
3. Si hubo alertas de tipo «Revisar», confirma que las revisaste.
4. Pulsa **Publicar versión**. Tarda unos segundos.

Desde ese momento, el dashboard y el asistente muestran la versión nueva. La cabecera indica el número de versión y la fecha de corte.

## 5. Conciliar con BI

Compara la venta neta y los kg por canal del dashboard con el reporte de BI del mes.

- **Si coinciden:** en la versión vigente pulsa **Marcar conciliada con BI** y escribe contra qué reporte comparaste (por ejemplo, «Reporte BI oct-2026: venta neta y kg por canal iguales»). La cabecera pasa a decir «conciliada con BI».
- **Si no coinciden:** no la marques. Revisa la diferencia con BI antes de comunicar las cifras.

## Si algo salió mal

En la versión vigente pulsa **Retirar** y escribe el motivo. Vuelve a regir la versión anterior y el retiro queda en el historial. Después sube el archivo corregido.

Solo se puede retirar la versión vigente, y siempre tiene que quedar al menos una versión publicada.
