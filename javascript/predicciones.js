/**
 * Modelos predictivos de fútbol — UEFA Champions League
 * Sin librerías externas. Entrada esperada:
 *
 * equipo = {
 *   nombre: "Cusco FC",
 *   ultimos5: [
 *     { result: "W"|"D"|"L", golesAFavor: 2, golesEnContra: 1 }
 *   ]
 * }
 *
 * h2h = [
 *   { home: "Alianza Lima", away: "Cusco FC", golesLocal: 8, golesVisitante: 0, winner: "Alianza Lima" }
 * ]
 *
 * equipoA = local · equipoB = visitante
 */

const PESO_FORMA = 0.6;
const PESO_H2H = 0.4;
const PUNTOS_FORMA = { W: 3, D: 1, L: 0 };
const UMBRAL_AMBOS_2_GOLES = 35;
const VENTAJA_LOCAL = 1.12;

function puntosForma(equipo) {
  const partidos = equipo?.ultimos5 || [];
  return partidos.reduce((total, partido) => {
    return total + (PUNTOS_FORMA[partido.result] ?? 0);
  }, 0);
}

function tasaEmpatesForma(equipoA, equipoB) {
  const partidos = [...(equipoA?.ultimos5 || []), ...(equipoB?.ultimos5 || [])];
  if (!partidos.length) return 0.26;
  const empates = partidos.filter((partido) => partido.result === "D").length;
  const tasa = (empates + 1) / (partidos.length + 3);
  return Math.min(0.38, Math.max(0.18, tasa));
}

function conteoH2H(equipoA, equipoB, h2h) {
  const nombreA = equipoA.nombre;
  const nombreB = equipoB.nombre;
  let victoriasA = 0;
  let victoriasB = 0;
  let empates = 0;

  (h2h || []).forEach((partido) => {
    if (partido.winner === "Empate") {
      empates += 1;
      return;
    }
    if (partido.winner === nombreA) {
      victoriasA += 1;
      return;
    }
    if (partido.winner === nombreB) {
      victoriasB += 1;
    }
  });

  return { victoriasA, victoriasB, empates, total: victoriasA + victoriasB + empates };
}

function normalizarA100(local, empate, visitante) {
  const bruto = [local, empate, visitante].map((valor) => Math.max(valor, 0));
  const suma = bruto.reduce((acc, valor) => acc + valor, 0) || 1;
  const porcentajes = bruto.map((valor) => (valor / suma) * 100);
  const redondeados = porcentajes.map((valor) => Math.round(valor * 10) / 10);
  const deriva = Math.round((100 - redondeados.reduce((acc, valor) => acc + valor, 0)) * 10) / 10;
  const indiceMayor = redondeados.indexOf(Math.max(...redondeados));
  redondeados[indiceMayor] = Math.round((redondeados[indiceMayor] + deriva) * 10) / 10;

  return {
    victoriaLocal: redondeados[0],
    empate: redondeados[1],
    victoriaVisitante: redondeados[2]
  };
}

/**
 * Algoritmo 1 — Modelo de calificación ELO ponderado por forma reciente.
 *
 * Paso 1: puntos de forma (W=3, D=1, L=0) en los últimos 5.
 * Paso 2: convierte esa fuerza en 1X2, con ventaja local y tasa de empate observada.
 * Paso 3: obtiene 1X2 histórico del H2H (Laplace +1 para no quebrar series cortas).
 * Paso 4: mezcla 60% forma + 40% H2H y fuerza suma = 100%.
 */
function calcularProbabilidadVictoria(equipoA, equipoB, h2h) {
  // 1) Fortaleza de forma: 0 a 15 puntos, con suavizado y ventaja local.
  const ptsA = puntosForma(equipoA) + 1;
  const ptsB = puntosForma(equipoB) + 1;
  const fuerzaA = ptsA * VENTAJA_LOCAL;
  const fuerzaB = ptsB;

  // 2) El empate de forma crece si ambos empatan seguido y si están parejos.
  const pEmpateForma = tasaEmpatesForma(equipoA, equipoB);
  const masaVictoriaForma = 1 - pEmpateForma;
  const pLocalForma = masaVictoriaForma * (fuerzaA / (fuerzaA + fuerzaB));
  const pVisitaForma = masaVictoriaForma * (fuerzaB / (fuerzaA + fuerzaB));

  // 3) 1X2 histórico con suavizado de Laplace (+1 a cada resultado).
  const { victoriasA, victoriasB, empates, total } = conteoH2H(equipoA, equipoB, h2h);
  const denom = total + 3;
  const pLocalH2H = (victoriasA + 1) / denom;
  const pEmpateH2H = (empates + 1) / denom;
  const pVisitaH2H = (victoriasB + 1) / denom;

  // 4) Mezcla 60/40 y normalización exacta a 100%.
  const pLocal = PESO_FORMA * pLocalForma + PESO_H2H * pLocalH2H;
  const pEmpate = PESO_FORMA * pEmpateForma + PESO_H2H * pEmpateH2H;
  const pVisita = PESO_FORMA * pVisitaForma + PESO_H2H * pVisitaH2H;

  return normalizarA100(pLocal, pEmpate, pVisita);
}

function promedio(valores, fallback = 1.1) {
  const validos = valores.filter((valor) => Number.isFinite(valor));
  if (!validos.length) return fallback;
  return validos.reduce((acc, valor) => acc + valor, 0) / validos.length;
}

function ofensivaReciente(equipo) {
  return promedio((equipo?.ultimos5 || []).map((partido) => Number(partido.golesAFavor)));
}

function defensivaReciente(equipo) {
  return promedio((equipo?.ultimos5 || []).map((partido) => Number(partido.golesEnContra)));
}

function golesRecibidosEnH2H(nombreEquipo, h2h) {
  return (h2h || []).map((partido) => {
    if (partido.home === nombreEquipo) return Number(partido.golesVisitante);
    if (partido.away === nombreEquipo) return Number(partido.golesLocal);
    return NaN;
  });
}

function poissonAlMenos2(lambda) {
  // P(X >= 2) = 1 - P(0) - P(1) = 1 - e^{-λ}(1 + λ)
  const l = Math.max(lambda, 0.05);
  return 1 - Math.exp(-l) * (1 + l);
}

/**
 * Algoritmo 2 — Poisson de goles independientes.
 *
 * Paso 1: λ ofensiva = goles a favor / 5.
 * Paso 2: λ defensiva rival = goles que el rival recibe en el H2H.
 * Paso 3: cruza ambas señales (60/40) para obtener lambda_A y lambda_B.
 * Paso 4: P(X>=2) = 1 - e^{-λ}(1+λ). Con independencia: P(A∩B) = P(A)*P(B).
 * Paso 5: aprueba si la conjunta supera 35%.
 */
function calcularProbabilidadAmbosAnotan2Goles(equipoA, equipoB, h2h) {
  const offA = ofensivaReciente(equipoA);
  const offB = ofensivaReciente(equipoB);

  const defH2H_B = promedio(golesRecibidosEnH2H(equipoB.nombre, h2h), defensivaReciente(equipoB));
  const defH2H_A = promedio(golesRecibidosEnH2H(equipoA.nombre, h2h), defensivaReciente(equipoA));

  // Cruce ofensiva propia × defensiva del rival (misma ponderación 60/40).
  const lambdaA = Math.max(PESO_FORMA * offA + PESO_H2H * defH2H_B, 0.15);
  const lambdaB = Math.max(PESO_FORMA * offB + PESO_H2H * defH2H_A, 0.15);

  const pA = poissonAlMenos2(lambdaA);
  const pB = poissonAlMenos2(lambdaB);
  const conjunta = pA * pB;
  const probabilidad = Math.round(conjunta * 1000) / 10;

  return {
    probabilidad,
    esAprobado: probabilidad > UMBRAL_AMBOS_2_GOLES,
    lambdaA: Math.round(lambdaA * 100) / 100,
    lambdaB: Math.round(lambdaB * 100) / 100,
    pA_ge2: Math.round(pA * 1000) / 10,
    pB_ge2: Math.round(pB * 1000) / 10
  };
}

const DC_RHO = -0.13;
const DC_VENTAJA_LOCAL = 1.18;
const DC_MAX_GOLES = 6;
const DC_PESO_FORMA = 0.65;
const DC_PESO_H2H = 0.35;
const DC_MU_LIGA = 1.4;

function golesAnotadosEnH2H(nombreEquipo, h2h) {
  return (h2h || []).map((partido) => {
    if (partido.home === nombreEquipo) return Number(partido.golesLocal);
    if (partido.away === nombreEquipo) return Number(partido.golesVisitante);
    return NaN;
  });
}

function mediaGolesLiga(equipoA, equipoB) {
  const goles = [
    ...(equipoA?.ultimos5 || []).flatMap((partido) => [partido.golesAFavor, partido.golesEnContra]),
    ...(equipoB?.ultimos5 || []).flatMap((partido) => [partido.golesAFavor, partido.golesEnContra])
  ].map(Number).filter(Number.isFinite);
  const n = goles.length;
  const crudo = n ? goles.reduce((acc, valor) => acc + valor, 0) / n : DC_MU_LIGA;
  const suavizado = (crudo * n + DC_MU_LIGA * 10) / (n + 10);
  return Math.min(1.65, Math.max(1.2, suavizado));
}

function promedioSuavizado(valores, prior, priorN = 4) {
  const validos = (valores || []).map(Number).filter(Number.isFinite);
  const suma = validos.reduce((acc, valor) => acc + valor, 0);
  return (suma + priorN * prior) / (validos.length + priorN);
}

function listaGoles(equipo, campo) {
  return (equipo?.ultimos5 || []).map((partido) => Number(partido[campo]));
}

function poissonPmf(k, lambda) {
  const l = Math.max(lambda, 0.05);
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i += 1) p *= l / i;
  return p;
}

function dixonColesTau(golesLocal, golesVisita, lambdaLocal, lambdaVisita, rho) {
  if (golesLocal === 0 && golesVisita === 0) return 1 - lambdaLocal * lambdaVisita * rho;
  if (golesLocal === 0 && golesVisita === 1) return 1 + lambdaLocal * rho;
  if (golesLocal === 1 && golesVisita === 0) return 1 + lambdaVisita * rho;
  if (golesLocal === 1 && golesVisita === 1) return 1 - rho;
  return 1;
}

function ratingRelativo(goles, mu) {
  return Math.min(2.4, Math.max(0.45, goles / mu));
}

/**
 * Algoritmo 3 — Dixon-Coles (Poisson modificado).
 *
 * Estima ataque/defensa con los últimos 5 y cruza con goles del H2H.
 * Construye la matriz 0-6, corrige 0-0 / 1-0 / 0-1 / 1-1 con ρ
 * y suma celdas para 1X2, Over 2.5, BTTS y top 3 marcadores.
 */
function calcularDixonColes(equipoA, equipoB, h2h) {
  const mu = mediaGolesLiga(equipoA, equipoB);
  const attLocal = ratingRelativo(promedioSuavizado(listaGoles(equipoA, "golesAFavor"), mu), mu);
  const defLocal = ratingRelativo(promedioSuavizado(listaGoles(equipoA, "golesEnContra"), mu), mu);
  const attVisita = ratingRelativo(promedioSuavizado(listaGoles(equipoB, "golesAFavor"), mu), mu);
  const defVisita = ratingRelativo(promedioSuavizado(listaGoles(equipoB, "golesEnContra"), mu), mu);

  let lambdaLocal = attLocal * defVisita * DC_VENTAJA_LOCAL * mu;
  let lambdaVisita = attVisita * defLocal * mu;

  const ofensivaH2HLocal = promedio(golesAnotadosEnH2H(equipoA.nombre, h2h), NaN);
  const ofensivaH2HVisita = promedio(golesAnotadosEnH2H(equipoB.nombre, h2h), NaN);
  const nH2H = (h2h || []).length;
  if (nH2H >= 2 && Number.isFinite(ofensivaH2HLocal) && Number.isFinite(ofensivaH2HVisita)) {
    const pesoH2H = Math.min(DC_PESO_H2H, 0.12 * nH2H);
    const pesoForma = 1 - pesoH2H;
    lambdaLocal = pesoForma * lambdaLocal + pesoH2H * ofensivaH2HLocal;
    lambdaVisita = pesoForma * lambdaVisita + pesoH2H * ofensivaH2HVisita;
  }

  lambdaLocal = Math.min(3.6, Math.max(0.35, lambdaLocal));
  lambdaVisita = Math.min(3.6, Math.max(0.35, lambdaVisita));

  let pLocal = 0;
  let pEmpate = 0;
  let pVisita = 0;
  let pOver25 = 0;
  let pBtts = 0;
  const celdas = [];

  for (let local = 0; local <= DC_MAX_GOLES; local += 1) {
    for (let visita = 0; visita <= DC_MAX_GOLES; visita += 1) {
      const tau = dixonColesTau(local, visita, lambdaLocal, lambdaVisita, DC_RHO);
      const p = Math.max(
        0,
        tau * poissonPmf(local, lambdaLocal) * poissonPmf(visita, lambdaVisita)
      );
      celdas.push({ local, visita, p });
      if (local > visita) pLocal += p;
      else if (local === visita) pEmpate += p;
      else pVisita += p;
      if (local + visita >= 3) pOver25 += p;
      if (local >= 1 && visita >= 1) pBtts += p;
    }
  }

  const masa = pLocal + pEmpate + pVisita || 1;
  const unoXDos = normalizarA100(pLocal / masa, pEmpate / masa, pVisita / masa);
  const marcadores = celdas
    .map((celda) => ({
      marcador: `${celda.local}-${celda.visita}`,
      probabilidad: Math.round((celda.p / masa) * 1000) / 10
    }))
    .sort((a, b) => b.probabilidad - a.probabilidad)
    .slice(0, 3);

  return {
    ...unoXDos,
    lambdaLocal: Math.round(lambdaLocal * 100) / 100,
    lambdaVisita: Math.round(lambdaVisita * 100) / 100,
    rho: DC_RHO,
    over25: Math.round((pOver25 / masa) * 1000) / 10,
    btts: Math.round((pBtts / masa) * 1000) / 10,
    marcadores
  };
}

if (typeof window !== "undefined") {
  window.calcularProbabilidadVictoria = calcularProbabilidadVictoria;
  window.calcularProbabilidadAmbosAnotan2Goles = calcularProbabilidadAmbosAnotan2Goles;
  window.calcularDixonColes = calcularDixonColes;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calcularProbabilidadVictoria,
    calcularProbabilidadAmbosAnotan2Goles,
    calcularDixonColes
  };
}
