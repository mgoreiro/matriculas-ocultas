# Matrículas ocultas

Arrastra una foto, la app detecta las matrículas de los vehículos y las oculta, y descargas el resultado a la misma resolución.
**Todo ocurre en tu navegador**: la foto nunca sale de tu equipo (el servidor local solo sirve los ficheros estáticos de la app).

## Ejecutar

Requisito: Python 3 (solo para servir los ficheros; no se instala nada).

```bash
./serve.py        # o: python3 serve.py [puerto]
```

Abre <http://localhost:8765>, arrastra una foto (o pulsa «Seleccionar archivo») y listo. Funciona sin conexión: modelos y runtime ya están en `models/` y `vendor/`.

## Uso

- **Detección automática** con el modelo elegido (*Rápido* 8 MB / *Preciso* 29 MB). «Buscar también por zonas» repite la detección sobre mosaicos ampliados para encontrar matrículas lejanas. El deslizador *Confianza mín.* filtra las detecciones dudosas.
- **Ajuste manual**: clic en una caja para quitarla/ponerla (falsos positivos), o arrastra sobre la foto para dibujar una caja a mano. El panel inferior muestra cada matrícula con su recorte antes/después y botones para quitar o eliminar.
- **Ajuste a la silueta** (activado por defecto): la caja del detector se recorta a la forma real de la matrícula (zona clara/azul frente a la carrocería, envolvente convexa), de modo que solo se oculta la matrícula y no un rectángulo mayor. Se ve como contorno rosa; sin contraste fiable (matrícula blanca sobre coche blanco) se usa la caja.
- **Modos de ocultación**
  - *Relleno con carrocería cercana* (por defecto): busca en la propia imagen un parche liso cuyo contorno encaje con el de la matrícula, lo clona y corrige el color por difusión (clonado «seamless»). Si no hay un parche fiable cae a…
  - *Relleno suave (difusión)*: interpola los colores del borde (pirámide + relajación de Laplace) y añade grano acorde al de la foto.
  - *Pintar de blanco*: rellena solo la matrícula con su propio tono claro.
  - *Desenfoque fuerte* y *Pixelado* (con intensidad ajustable).
  - *Margen* amplía la caja un % y *Difuminado* suaviza el borde de la zona sustituida.
- **Descarga** en JPG (calidad ajustable) o PNG, a la resolución original. Se respeta la orientación EXIF; el JPG resultante no conserva metadatos EXIF (ubicación, etc.).

## Stack y por qué

Página estática + `onnxruntime-web` (WASM, CPU) + YOLOv9 en ONNX: sin backend ni dependencias de Python, la privacidad es total (no hay a dónde enviar la foto) y se distribuye copiando una carpeta.

## Ficheros descargados (ya incluidos; ~47 MB)

| Fichero | Origen | Tamaño |
|---|---|---|
| `models/yolo-v9-t-640-license-plates-end2end.onnx` | [ankandrew/open-image-models](https://github.com/ankandrew/open-image-models) (release `assets`) | 7,8 MB |
| `models/yolo-v9-s-608-license-plates-end2end.onnx` | idem | 28,6 MB |
| `vendor/ort.wasm.min.js`, `ort-wasm-simd-threaded.{mjs,wasm}` | paquete npm `onnxruntime-web@1.22.0` (MIT) | 11,6 MB |

Para volver a descargarlos, usa las URL de arriba / `npm pack onnxruntime-web@1.22.0` y copia esos tres ficheros de `package/dist/` a `vendor/`.
Revisa las licencias de los modelos en su repositorio si vas a redistribuirlos.

## Límites conocidos

- Matrículas muy pequeñas, de perfil o muy inclinadas pueden no detectarse: dibújalas a mano.
- El relleno por clonado funciona mejor sobre carrocería lisa; en zonas con muchos detalles (rejillas, rótulos, retrovisores) prueba *Relleno suave*, *Desenfoque* o aumenta el margen.
- Fotos de muchos megapíxeles tardan más (la detección va en un solo hilo de WASM).

## Estructura

**Licencia:** GPL-3.0 (ver `LICENSE` y `NOTICE.md`).

`index.html` (UI) · `js/app.js` (interfaz y cajas) · `js/detect.js` (ONNX, mosaicos, NMS) · `js/refine.js` (silueta) · `js/inpaint.js` (ocultación) · `serve.py`
