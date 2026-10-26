# Ocultar matrículas

Aplicación web para **ocultar matrículas en fotos**: arrastras una imagen, la app detecta las matrículas de los vehículos, las oculta de forma discreta y descargas el resultado con la misma resolución que el original.

**Privacidad:** la detección y la ocultación se ejecutan por completo en el navegador. La foto no se envía a ningún servidor ni a terceros. Lo único que viaja por la red es lo que el usuario escribe en el formulario de contacto.

- Repositorio: <https://github.com/mgoreiro/matriculas-ocultas> · Licencia GPL-3.0 · © Miguel González Oreiro

## Contenido

1. [Ejecutar en local](#ejecutar-en-local)
2. [Uso](#uso)
3. [Cómo funciona](#cómo-funciona)
4. [Ficheros y modelos](#ficheros-y-modelos)
5. [Publicar en un servidor (nginx)](#publicar-en-un-servidor-nginx)
6. [Formulario de contacto](#formulario-de-contacto)
7. [Solución de problemas](#solución-de-problemas)
8. [Límites conocidos](#límites-conocidos)
9. [Estructura del proyecto y licencias](#estructura-del-proyecto-y-licencias)

## Ejecutar en local

Requisito: Python 3 (solo para servir los ficheros; no se instala nada más). Los modelos de detección y el runtime ya están en `models/` y `vendor/`, así que funciona sin conexión.

```bash
./serve.py        # o: python3 serve.py [puerto]   → http://localhost:8765
```

La app debe abrirse por `http://` (no con doble clic sobre `index.html`): el navegador bloquea módulos, workers y modelos desde `file://`; la página avisa si pasa.
`serve.py` envía las mismas cabeceras de seguridad (CSP) que producción y atiende también `POST /api/contacto` con la lógica del servicio real (ver [Formulario de contacto](#formulario-de-contacto)).

## Uso

Al abrir la página aparece una **ventana de bienvenida** con la guía rápida y la casilla «No mostrar de nuevo» (se recuerda en el navegador). El botón **Ayuda** abre el **manual de usuario** completo y **Contactar** el formulario de contacto.

Barra superior de controles:

| Control | Función |
|---|---|
| **ReDetectar** | Vuelve a ejecutar la detección sobre la imagen actual (conserva las cajas dibujadas a mano) |
| **Limpiar** | Descarta cajas manuales y ajustes y vuelve a empezar con la imagen actual |
| **Nueva** | Abre otra imagen |
| *Modelo* | *Rápido* (8 MB) o *Preciso* (29 MB) |
| *Buscar también por zonas* | Repite la detección sobre mosaicos ampliados (matrículas lejanas) |
| *Confianza mín.* | Filtra detecciones dudosas |

Revisión de resultados:

- Cada matrícula se marca con un **cuadrilátero rosa** que sigue su borde real (también en perspectiva); solo esa zona se modifica.
- **Clic** sobre una zona la quita o la pone (falsos positivos); **arrastrar** sobre la foto original dibuja una caja para una matrícula no detectada. El panel inferior muestra cada matrícula con su recorte antes/después, y botones para quitarla o eliminarla.
- *Ajustar a la silueta de la matrícula* (activado por defecto) recorta la zona al borde exacto; si no hay contraste fiable (matrícula blanca sobre coche blanco) se usa la caja del detector.

Modos de ocultación (desplegable *Ocultar con*):

| Modo | Qué hace |
|---|---|
| **Relleno con carrocería cercana** (por defecto) | Busca en la propia foto un parche liso cuyo contorno encaje, lo clona y corrige el color por difusión. Si no hay un parche fiable cae al relleno suave |
| **Relleno suave (difusión)** | Interpola los colores del borde hacia dentro y añade grano acorde a la foto |
| **Inteligente (IA, LaMa)** | El resultado más natural: inpainting neuronal (LaMa). Ver [modelo de IA](#modelo-de-ia-lama) |
| **Pintar del color de la carrocería** | Color plano (tono central del entorno) con el grano de la foto |
| **Pintar de blanco** | Rellena solo la matrícula con su propio tono claro |
| **Desenfoque fuerte / Pixelado** | Con *Intensidad* ajustable |

*Margen* (px) amplía el cuadrilátero y *Difuminado* (px) suaviza el borde de la zona sustituida. La **descarga** es en JPG (calidad ajustable) o PNG, a la resolución original; se respeta la orientación EXIF y el archivo resultante no conserva metadatos EXIF (ubicación, fecha…).

### Modelo de IA (LaMa)

- Modelo: [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX) (`lama_fp32.onnx`, 198 MB, Apache-2.0). **No está en el repositorio** (supera el límite de GitHub).
- En local: `./descargar-lama.sh` lo deja en `models/`.
- En un servidor: `deploy.sh --lama` lo descarga una vez en el propio servidor. Cada visitante lo baja **una sola vez**: el navegador lo guarda en Cache Storage (con petición de almacenamiento persistente) y el desplegable pasa a «instalado»; las siguientes veces no usa red. Si el navegador limpia los datos del sitio habría que descargarlo de nuevo.
- Tarda unos 15 s por matrícula (WASM, un hilo) y se ejecuta en un **Web Worker** (`js/lama-worker.js`), así que la página sigue respondiendo.

## Cómo funciona

- **Detección:** YOLOv9 de matrículas (ONNX) con `onnxruntime-web` (WASM, CPU), con pasada global y mosaicos solapados opcionales, fusionadas con NMS.
- **Silueta exacta:** dentro de cada caja se segmenta la zona clara/azul frente a la carrocería, se toma su envolvente convexa y se reduce a un cuadrilátero de 4 lados (`js/refine.js`). Se amplía por lados los px del margen.
- **Ocultación:** todos los modos actúan solo sobre ese cuadrilátero más la banda de difuminado (`js/inpaint.js`). El modo IA recorta una ventana de contexto, rellena con LaMa a 512×512 y pega solo la zona (`js/lama.js`).
- **Stack:** página estática + `onnxruntime-web`; sin backend para procesar imágenes. Solo el formulario de contacto tiene un pequeño servicio (Python estándar).

## Ficheros y modelos

Incluidos en el repositorio (~47 MB):

| Fichero | Origen | Tamaño |
|---|---|---|
| `models/yolo-v9-t-640-license-plates-end2end.onnx` | [ankandrew/open-image-models](https://github.com/ankandrew/open-image-models) (release `assets`, MIT) | 7,8 MB |
| `models/yolo-v9-s-608-license-plates-end2end.onnx` | idem | 28,6 MB |
| `vendor/ort.wasm.min.js`, `ort-wasm-simd-threaded.{mjs,wasm}` | `onnxruntime-web@1.22.0` (npm, MIT) | 11,6 MB |

Para recuperar el runtime: `npm pack onnxruntime-web@1.22.0` y copiar esos tres ficheros de `package/dist/` a `vendor/`. Revisa las licencias de los modelos (ver `NOTICE.md`) si los redistribuyes.

## Publicar en un servidor (nginx)

Requisitos del servidor: nginx con TLS, `rsync`, `systemd` y Python 3 (este último solo para el formulario de contacto). La app queda en `https://midominio.com/matriculas/` (todas sus rutas son relativas, así que funciona en cualquier subruta).

1. **Preparar el servidor (una vez):**
   ```bash
   ./deploy/preparar-servidor.sh usuario@midominio.com
   ```
   Crea `/var/www/matriculas-ocultas`, instala el fragmento de nginx en `/etc/nginx/snippets/matriculas.conf` y el servicio systemd `matriculas-contacto`, y crea `/etc/matriculas-contacto.env` a partir de `.env.example`. Pide tu contraseña de ssh/sudo; no toca tu configuración de nginx existente.
2. **Activar el fragmento:** añade `include snippets/matriculas.conf;` dentro del `server { }` con TLS (busca el fichero con `sudo grep -rl "midominio.com" /etc/nginx/`) y recarga: `sudo nginx -t && sudo systemctl reload nginx`.
3. **Subir la app:**
   ```bash
   ./deploy/deploy.sh usuario@midominio.com --lama
   ```
   Sube por rsync solo lo que usa el navegador (~20 MB), copia `server/contacto.py` a `~/matriculas-contacto/` y reinicia el servicio de contacto. Con `--lama` el servidor descarga el modelo de IA (198 MB) si aún no lo tiene; no se vuelve a descargar en despliegues posteriores. Es compatible con el rsync de macOS.
4. **Configurar el correo** (ver siguiente sección) y arrancar: `sudo systemctl restart matriculas-contacto`.

El fragmento (`deploy/nginx-matriculas.conf`) sirve `.wasm`/`.mjs` con el tipo correcto, activa gzip, usa caché de un año para `vendor/` y `models/`, enruta `/matriculas/api/contacto` al servicio local y añade una **CSP** que impide a la página conectar con otros orígenes (refuerza que la foto no puede salir). Si no quieres que sea pública, descomenta el bloque `auth_basic`.

## Formulario de contacto

Los mensajes los envía `server/contacto.py` (solo biblioteca estándar de Python 3; escucha en `127.0.0.1:8770` detrás de nginx). El **asunto** es «Comentario sobre app matrículas de \<nombre\>».

Configuración en `/etc/matriculas-contacto.env` (en local, un `.env` junto al proyecto; ver `.env.example`):

| Variable | Significado |
|---|---|
| `CONTACT_TO` | **Destinatario** de los mensajes (obligatorio). En esta instalación: `mgoreiro@gmail.com` |
| `SMTP_HOST`, `SMTP_PORT` | Servidor SMTP (por defecto `localhost`, 587; el 465 usa SSL implícito) |
| `SMTP_SECURITY` | `starttls` \| `ssl` \| `none` (por defecto según el puerto) |
| `SMTP_USER`, `SMTP_PASSWORD` | Credenciales. En Gmail: contraseña de aplicación (requiere verificación en dos pasos); puede escribirse sin espacios o entre comillas |
| `FROM_MODE` | `user` (por defecto): cabecera *From* = nombre y correo que escribe el visitante, con *Reply-To* igual. `server`: *From* = `SMTP_FROM`/`SMTP_USER` y *Reply-To* = visitante |
| `SMTP_FROM` | Remitente propio para `FROM_MODE=server` |
| `CONTACT_PORT` | Puerto de escucha (8770) |
| `MAIL_DRY_RUN=1` | No envía: escribe el correo en el log (pruebas) |

Nota sobre `FROM_MODE=user`: muchos servidores de destino rechazan o marcan como spam un *From* de un dominio que no autoriza a tu servidor (SPF/DMARC), y algunos SMTP lo reescriben. Si los correos no llegan, usa `server`.

Protecciones: campo trampa anti-bots, 5 mensajes/hora por IP, límites de longitud, validación del correo y saneado de cabeceras, comprobación de origen y casilla de consentimiento. El servicio no guarda los mensajes (solo los reenvía).

Probar en local sin enviar: crea `.env` con `CONTACT_TO=tu@correo` y `MAIL_DRY_RUN=1`, ejecuta `./serve.py` y usa el botón *Contactar*; el correo aparece en la consola.

## Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| El navegador abre la foto en vez de procesarla | La app no cargó (JS con error o abierta por `file://`). Mira la consola; abre por `http://localhost:8765` |
| Formulario de contacto: **502** | No hay nada en el puerto 8770: `sudo systemctl status matriculas-contacto`, `sudo journalctl -u matriculas-contacto -n 30 --no-pager`. Causas típicas: falta `~/matriculas-contacto/contacto.py` (repite `deploy.sh` tras `git pull`) o falta `CONTACT_TO` en `/etc/matriculas-contacto.env`. Tras corregir: `sudo systemctl reset-failed matriculas-contacto && sudo systemctl restart matriculas-contacto`; comprobar con `curl localhost:8770/api/health` |
| «No se pudo enviar el mensaje» | Fallo de SMTP: revisa credenciales, `SMTP_HOST/PORT` y el log del servicio |
| El correo no llega o va a spam | Prueba `FROM_MODE=server` (ver arriba) |
| `rsync: unrecognized option` | Usa la versión actual de `deploy.sh` (`git pull`) |
| La IA no funciona / 404 del modelo | Falta `models/lama_fp32.onnx`: `./descargar-lama.sh` (local) o `deploy.sh --lama` (servidor) |
| Aviso de certificado en HTTPS | Renueva el certificado de Let's Encrypt del dominio (`sudo certbot renew`) |

## Límites conocidos

- Matrículas muy pequeñas, de perfil o muy inclinadas pueden no detectarse: dibújalas a mano.
- El relleno por clonado funciona mejor sobre carrocería lisa; con muchos detalles (rejillas, rótulos, retrovisores) prueba *Relleno suave*, *Inteligente (IA)* o aumenta el margen.
- En fotos de muchos megapíxeles la detección es más lenta (un solo hilo de WASM).
- La IA trabaja a 512×512 por ventana: en matrículas muy grandes el relleno es algo más suave que el resto de la foto.

## Estructura del proyecto y licencias

```
index.html              interfaz (bienvenida, manual con licencia y enlace al repositorio, contacto)
js/app.js               carga, cajas, render, descarga
js/ui.js                bienvenida, manual y formulario de contacto
js/detect.js            detección ONNX, mosaicos, NMS
js/refine.js            silueta exacta (cuadrilátero)
js/inpaint.js           modos de ocultación
js/lama.js, lama-worker.js   modo IA (Web Worker, caché del modelo)
server/contacto.py      servicio de contacto (SMTP)
deploy/                 fragmento nginx, servicio systemd, scripts de despliegue
serve.py                servidor local de desarrollo (CSP + /api/contacto)
models/, vendor/        modelos de detección y runtime ONNX
```

Código bajo **GPL-3.0** (`LICENSE`). Componentes de terceros y sus licencias: `NOTICE.md`.
