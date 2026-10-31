---
name: widgets-dinamicos
description: Crea o modifica widgets dinámicos (sliders enlazados, listas de chips, KPIs, gráficas SVG, heatmaps, modales, plan año por año) de The Oracle of Omaha (Calculadora Financiera Personal). Úsalo siempre que se añada una variable financiera nueva a la UI, una gráfica, o un control interactivo en app/.
---

# Widgets dinámicos — The Oracle of Omaha

Toda la UI se construye con la librería propia `app/js/widgets.js` (sin dependencias) y las
gráficas con `app/js/charts.js` (SVG puro). Nada de frameworks ni CDNs: la app debe funcionar offline.

## Reglas de oro
1. **Un estado, muchas vistas.** Cada widget lee/escribe en el objeto `state` de `app/js/app.js`
   y llama a `render()` (con *debounce* vía `requestAnimationFrame`). Nunca calcules dentro de un widget.
2. **Cálculo puro en `engine.js`.** Funciones sin DOM, testeables con `node --test`.
3. **Slider + input numérico siempre enlazados** (`W.slider`). El usuario arrastra para explorar y teclea
   para precisión. Muestra unidad y formato (`%`, `$`, `años`).
4. **Feedback inmediato (<16 ms por frame).** Monte Carlo pesado se recalcula con debounce de 120 ms.
5. **Formato financiero consistente**: `fmt.money`, `fmt.pct`, `fmt.compact` de `widgets.js`.
6. **Accesible**: cada control tiene `<label>`, contraste AA, foco visible, funciona con teclado.
7. **Tema por tokens CSS** (`--bg`, `--panel`, `--ink`, `--accent`, `--gold`, `--pos`, `--neg`…) en `app/css/app.css`; estilos de marca, modales y tablas en `app/css/oraculo.css`.
8. **El inversor define sus datos.** Nada de valores precargados en el primer uso: hasta que `state.configurado` sea `true`
   se muestra el asistente (`abrirAsistente()`); las cifras de la investigación solo aparecen como *sugerencias* (chips).
9. **Todo lo proyectable es personalizable por año.** Los parámetros por año viven en `state.porAnio[año]`
   (`tasa`, `capitalizacion`, `aporte`, `extra`, `comision`, `inflacion`) y el motor los resuelve con
   `Engine.parametrosDelAnio(o, y)`. Una variable proyectable nueva debe sumarse a `CAMPOS_ANIO` y a `parametrosDelAnio`.
10. **Honestidad numérica.** Retornos pasados se limitan con `TECHO_PASADO` (15%) al proyectar y el bono de rebalanceo
    del portafolio con `BONO_REBALANCEO_MAX` (0,5 pp). Si una cifra puede engañar, muestra un aviso (`pintarAvisos`).

## API disponible (`window.W`)
| Widget | Firma | Uso |
|---|---|---|
| `W.slider(opts)` | `{label, min, max, step, value, unit, fmt, onInput, hint}` → `HTMLElement` | variable continua |
| `W.chips(opts)` | `{label, values, fmt, onChange, placeholder}` | varios valores (p. ej. capitales iniciales) |
| `W.segmented(opts)` | `{label, options:[{value,label}], value, onChange}` | opción discreta (frecuencia, nominal/real) |
| `W.kpi(opts)` | `{label, value, sub, tone}` | tarjeta de métrica (`tone`: pos/neg/neutral) |
| `W.tramos(opts)` | `{label, rows:[{desde, monto}], onChange}` | contribuciones variables por tramos |

En `app.js` además:
| Pieza | Uso |
|---|---|
| `abrirModal(cerrar => contenido, {clase})` | ventana modal apilable (Esc / clic fuera cierra); clases `modal-grande`, `modal-cfg` |
| `abrirAsistente()` | configuración guiada del plan (validación + sugerencias) |
| `proy.dibujarGrid()` / `proy.sincronizarGrid()` | tabla editable «Plan año por año» (no se reconstruye al teclear) |
| `abrirCatalogo(alCambiar)` | universo de activos + formulario de activo propio (`state.propios`) |
| `abrirFicha(activo)` | ficha ampliada: métricas, Monte Carlo, «Lectura del Oráculo», mercado en vivo y enlaces a fuentes (`enlacesDe`) |

## Gráficas (`window.Charts`)
- `Charts.line(container, {series:[{name, data:[{x,y}], color, dash, band:{lo,hi}}], xLabel, yFmt})`
  — líneas con bandas (rango de tasas / percentiles Monte Carlo) y tooltip por hover.
- `Charts.stacked(container, {x, layers:[{name, values, color}], yFmt})` — aportes vs. interés.
- `Charts.bars(container, {items:[{label, value, color}], fmt})` — comparativas de activos.
- `Charts.heatmap(container, {rows, cols, cell(r,c), fmt})` — sensibilidad tasa × años.

Cada gráfica se redibuja completa en cada `render()`; son baratas (<300 nodos SVG).

## Receta para añadir una variable nueva
1. Añadir el campo a `state` con valor por defecto razonable.
2. Usarla en `engine.js` y cubrirla con un test en `tests/engine.test.js`.
3. Crear el control con el widget adecuado en el `build()` de la vista correspondiente de `app.js` (p. ej. `proy.build`).
4. Si afecta resultados, reflejarla en KPIs y en el "Veredicto rápido".
5. Ejecutar `node --test` y abrir la app (`Iniciar.bat`) para verificar visualmente.
