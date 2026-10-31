<p align="center"><img src="app/img/oraculo.svg" width="96" alt="Emblema de The Oracle of Omaha"></p>

<h1 align="center">The Oracle of Omaha</h1>

<p align="center">
Calculadora de interés compuesto y proyecciones de inversión, en español.<br>
Plan año por año · portafolios con Monte Carlo · 35 activos investigados · datos de mercado bajo demanda.
</p>

<p align="center">
<img alt="Licencia MIT" src="https://img.shields.io/badge/licencia-MIT-c9952f">
<img alt="Node 18+" src="https://img.shields.io/badge/node-%E2%89%A518-34d3a6">
<img alt="Sin dependencias" src="https://img.shields.io/badge/dependencias-0-6aa8ff">
</p>

---

## Qué es
Una herramienta educativa para responder rápido a la pregunta de cualquier inversor: *¿cuánto tendré, cuánto vale eso
en dinero de hoy y cuánto se llevan los costos?* Empieza en blanco: **tú defines tu plan** (capital, aportes, años,
rentabilidad, inflación y comisión) y la app muestra el resultado, sus riesgos y de dónde sale cada número.

| Pestaña | Qué puedes hacer |
|---|---|
| **Proyección** | Comparar varios capitales; sliders de años, tasa, rango ±, inflación y comisión; capitalización anual a diaria; aportes mensuales o anuales con crecimiento, etapas y retiros. **Plan año por año**: cambia la tasa, capitalización, aporte, aporte extra, comisión o inflación de cualquier año. |
| **Portafolio y diversificación** | Carteras modelo (Buffett 90/10, 60/40, Todo clima…), catálogo completo de activos, **activos propios**, Monte Carlo de 2.000 trayectorias (P10/P50/P90), beneficio de diversificar y escenarios macro. |
| **Universo de activos** | 35 activos: acciones, renta fija, inmobiliario, materias primas, alternativos, cripto, derivados, especulativos y efectivo. Cada uno con ficha: métricas, «Lectura del Oráculo», precio en vivo y **enlaces a las fuentes**. |
| **Macro y escenarios** | Inflación, Fed, bono 10 años, CAPE, prima de riesgo y 5 escenarios con probabilidad. |

### Honestidad numérica
- Retornos pasados limitados a **15 % anual** al proyectar (extrapolar el 48–59 % anual de Bitcoin daba miles de millones).
- Bono de rebalanceo del portafolio limitado a **0,5 pp**.
- Alertas visibles cuando un supuesto es poco realista, cuando usas retornos pasados o activos propios sin verificar.

## Uso local
Requisito: [Node.js](https://nodejs.org) 18 o superior. No hay dependencias que instalar.

```bash
npm start          # http://127.0.0.1:5173
npm test           # 22 pruebas del motor y la API
```

En Windows, doble clic en **`Iniciar.bat`** abre la app en una ventana propia (Edge/Chrome en modo aplicación).

## Desplegar en Vercel
El repositorio está listo para Vercel sin configuración adicional: `vercel.json` sirve `app/` como sitio estático y
`api/*.js` como funciones serverless.

1. En [vercel.com/new](https://vercel.com/new) importa este repositorio de GitHub.
2. Deja los valores por defecto (sin framework, sin comando de build) y pulsa **Deploy**.

En la nube, los datos de mercado que descarga cada visitante se guardan en su propio navegador.
El botón «Actualizar mercado» tiene un límite de una petición cada 20 segundos por IP.

## Estructura
```
app/                  interfaz (HTML + CSS + JS sin frameworks)
  js/engine.js        motor financiero puro (interés compuesto, parámetros por año, portafolio, Monte Carlo)
  js/app.js           estado, vistas, asistente, catálogo y fichas
  js/widgets.js       librería de widgets dinámicos
  js/charts.js        gráficas SVG
  data/activos.json   base de activos, macro, escenarios y correlaciones
lib/api.js            API compartida (servidor local y Vercel)
api/                  funciones serverless de Vercel
scraper.js            datos de mercado: Yahoo Finance y FRED (CLI: node scraper.js SPY BTC-USD)
server.js             servidor local
tests/                pruebas (node --test)
.claude/              agentes y skill de Claude Code con los que se construyó el proyecto
```

## Fuentes de datos
Estimaciones de retorno: J.P. Morgan LTCMA, Vanguard, BlackRock, Research Affiliates, GMO, Morningstar.
Históricos: Damodaran (NYU), MSCI, Nareit, Cambridge Associates, HFR, Jordà et al.
Mercado en vivo: Yahoo Finance (precios) y FRED de la Reserva Federal de St. Louis (inflación, tasas).
Los datos de terceros pertenecen a sus respectivos dueños y se usan con fines informativos.

## Aviso
Herramienta **educativa**. No constituye asesoría financiera, de inversión ni fiscal. Las rentabilidades pasadas no
garantizan resultados futuros y los retornos esperados son estimaciones, no promesas.
Proyecto independiente, **no afiliado** a Warren Buffett ni a Berkshire Hathaway.

## Licencia
[MIT](LICENSE) © 2026 elijahgord
