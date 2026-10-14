const ESPN = {
  base: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions"
};

const scheduleCache = new Map();
let fixtures = [];
let uclPool = [];
let selectedId = null;

const $ = (id) => document.getElementById(id);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error ${response.status} al consultar ESPN`);
  }
  return response.json();
}

function limaDate(iso) {
  return new Date(iso);
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("es-PE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Lima"
  }).format(limaDate(iso));
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Lima"
  }).format(limaDate(iso));
}

function yyyymmdd(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function calendarDay(iso) {
  return iso.slice(0, 10).replaceAll("-", "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function competitor(event, side) {
  return event.competitions[0].competitors.find((item) => item.homeAway === side);
}

function scoreValue(item) {
  const score = item?.score;
  if (score == null) return "";
  if (typeof score === "object") return String(score.displayValue ?? score.value ?? "");
  return String(score);
}

function teamInfo(item) {
  const team = item.team;
  return {
    id: team.id,
    name: team.displayName,
    short: team.abbreviation || team.shortDisplayName || team.displayName.slice(0, 3).toUpperCase(),
    color: `#${team.color || "1e293b"}`,
    alt: `#${team.alternateColor || "0f172a"}`,
    logo: team.logo || team.logos?.[0]?.href || ""
  };
}

function normalizeFixture(event) {
  const competition = event.competitions[0];
  const home = competitor(event, "home");
  const away = competitor(event, "away");
  const venue = competition.venue || {};
  const status = competition.status?.type || {};
  return {
    id: event.id,
    date: event.date,
    status: status.name,
    statusLabel: status.description || status.name,
    completed: Boolean(status.completed),
    inProgress: Boolean(status.state === "in" || /PROGRESS|HALFTIME/i.test(status.name || "")),
    round: event.seasonType?.name || event.season?.name || "Champions League",
    venue: venue.fullName || "Por confirmar",
    city: venue.address?.city || "Europa",
    home: teamInfo(home),
    away: teamInfo(away),
    homeScore: scoreValue(home),
    awayScore: scoreValue(away)
  };
}

function badgeHtml(team) {
  if (team.logo) {
    return `<img src="${escapeHtml(team.logo)}" alt="${escapeHtml(team.name)}" />`;
  }
  return escapeHtml(team.short);
}

function badgeStyle(team) {
  return `background: linear-gradient(160deg, ${team.color}, ${team.alt});`;
}

function setBusy(id, message) {
  $(id).innerHTML = `<div class="state-box">${escapeHtml(message)}</div>`;
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + amount);
  return next;
}

function uclScoreboardDays() {
  const unique = new Set();
  const now = new Date();
  for (let i = -3; i <= 2; i += 1) unique.add(yyyymmdd(addDays(now, i)));
  for (let i = -45; i <= 28; i += 1) {
    const day = addDays(now, i);
    const weekday = day.getUTCDay();
    if (weekday === 2 || weekday === 3 || weekday === 4) unique.add(yyyymmdd(day));
  }
  return [...unique].sort();
}

async function loadUpcoming() {
  const days = uclScoreboardDays();
  const boards = await Promise.all(days.map((day) => getJson(`${ESPN.base}/scoreboard?dates=${day}`)));
  const season = boards.find((board) => board.leagues?.[0]?.season)?.leagues[0].season;
  const chip = document.querySelector(".season-chip");
  if (chip && season) {
    chip.lastChild.textContent = ` ${season.displayName || "Champions League"} · ${season.type?.name || ""}`;
  }

  const unique = new Map();
  boards.forEach((board) => {
    (board.events || []).forEach((event) => unique.set(event.id, event));
  });

  uclPool = [...unique.values()];
  return uclPool
    .map(normalizeFixture)
    .sort((a, b) => limaDate(a.date) - limaDate(b.date));
}

function mergeEvents(...payloads) {
  const unique = new Map();
  payloads.forEach((payload) => {
    (payload.events || []).forEach((event) => unique.set(event.id, event));
  });
  return [...unique.values()];
}

function loadSchedule(teamId) {
  if (!scheduleCache.has(teamId)) {
    scheduleCache.set(
      teamId,
      Promise.all([
        getJson(`${ESPN.base}/teams/${teamId}/schedule?season=2026`),
        getJson(`${ESPN.base}/teams/${teamId}/schedule?season=2025`)
      ]).then(([current, previous]) => mergeEvents(current, previous))
    );
  }
  return scheduleCache.get(teamId);
}

function eventTeams(event) {
  return event.competitions[0].competitors.map((item) => ({
    ...teamInfo(item),
    homeAway: item.homeAway,
    score: scoreValue(item),
    winner: item.winner
  }));
}

function lastFive(events, teamId, excludeId) {
  const merged = mergeEvents({ events: uclPool }, { events });
  return merged
    .filter((event) => event.id !== excludeId)
    .filter((event) => event.competitions[0].status?.type?.completed)
    .filter((event) => eventTeams(event).some((team) => team.id === teamId))
    .sort((a, b) => limaDate(b.date) - limaDate(a.date))
    .slice(0, 5)
    .map((event) => {
      const teams = eventTeams(event);
      const self = teams.find((team) => team.id === teamId);
      const opp = teams.find((team) => team.id !== teamId);
      let result = "D";
      if (self.winner === true) result = "W";
      if (self.winner === false || opp.winner === true) result = "L";
      if (self.winner == null && opp.winner == null) result = "D";
      return {
        date: event.date,
        opponent: opp.name,
        ha: self.homeAway === "home" ? "Local" : "Visita",
        score: `${self.score || "0"}-${opp.score || "0"}`,
        result,
        golesAFavor: Number(self.score || 0),
        golesEnContra: Number(opp.score || 0)
      };
    });
}

function headToHead(homeEvents, awayEvents, homeId, awayId, excludeId) {
  const merged = mergeEvents({ events: uclPool }, { events: homeEvents }, { events: awayEvents });
  return merged
    .filter((event) => event.id !== excludeId)
    .filter((event) => event.competitions[0].status?.type?.completed)
    .filter((event) => {
      const ids = eventTeams(event).map((team) => team.id);
      return ids.includes(homeId) && ids.includes(awayId);
    })
    .sort((a, b) => limaDate(b.date) - limaDate(a.date))
    .slice(0, 10)
    .map((event) => {
      const teams = eventTeams(event);
      const home = teams.find((team) => team.homeAway === "home");
      const away = teams.find((team) => team.homeAway === "away");
      let winner = "Empate";
      if (home.winner === true) winner = home.name;
      if (away.winner === true) winner = away.name;
      return {
        date: event.date,
        home: home.name,
        away: away.name,
        score: `${home.score || "0"}-${away.score || "0"}`,
        winner,
        golesLocal: Number(home.score || 0),
        golesVisitante: Number(away.score || 0)
      };
    });
}

function renderFixtures() {
  if (!fixtures.length) {
    setBusy("fixtures", "No hay partidos pendientes en las próximas fechas.");
    return;
  }

  $("fixtures").innerHTML = fixtures.map((fix) => {
    const active = fix.id === selectedId ? "active" : "";
    const finished = fix.completed ? "finished" : "";
    const score = fix.completed ? `<em>Final ${escapeHtml(fix.homeScore)}-${escapeHtml(fix.awayScore)}</em>` : "";
    return `
      <button class="fixture-chip ${active} ${finished}" data-id="${escapeHtml(fix.id)}" type="button">
        <small>${escapeHtml(formatDate(fix.date))} · ${escapeHtml(formatTime(fix.date))}</small>
        <strong>${escapeHtml(fix.home.short)} vs ${escapeHtml(fix.away.short)}</strong>
        ${score}
      </button>
    `;
  }).join("");
}

function resultadoReal(fix) {
  const local = Number(fix.homeScore);
  const visita = Number(fix.awayScore);
  if (!Number.isFinite(local) || !Number.isFinite(visita)) return "Empate";
  if (local > visita) return "Local";
  if (visita > local) return "Visitante";
  return "Empate";
}

function prediccionEloFavorita(unoXDos) {
  const mapa = [
    ["Local", unoXDos.victoriaLocal],
    ["Empate", unoXDos.empate],
    ["Visitante", unoXDos.victoriaVisitante]
  ];
  return mapa.sort((a, b) => b[1] - a[1])[0];
}

function renderResultadoFinal(fix, unoXDos, poisson, dixon) {
  const panel = $("result-panel");
  if (!fix.completed) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const real = resultadoReal(fix);
  const [favorita, pct] = prediccionEloFavorita(unoXDos);
  const acierto1x2 = real === favorita;
  const ambos2 = Number(fix.homeScore) >= 2 && Number(fix.awayScore) >= 2;
  const aciertoPoisson = ambos2 === poisson.esAprobado;
  const [favoritaDc, pctDc] = prediccionEloFavorita(dixon);
  const aciertoDc = real === favoritaDc;
  const marcadorReal = `${fix.homeScore}-${fix.awayScore}`;
  const topDc = dixon.marcadores[0]?.marcador || "—";
  const aciertoMarcador = topDc === marcadorReal;

  panel.hidden = false;
  panel.innerHTML = `
    <div class="result-meta">
      <span class="pill red">Partido finalizado</span>
      <span class="pill">${escapeHtml(fix.round)}</span>
    </div>
    <div class="result-score">
      <strong>${escapeHtml(fix.home.short)}</strong>
      <b>${escapeHtml(fix.homeScore)} - ${escapeHtml(fix.awayScore)}</b>
      <strong>${escapeHtml(fix.away.short)}</strong>
    </div>
    <p class="result-winner">Resultado real: <b>${escapeHtml(real)}</b></p>
    <div class="result-compare">
      <article>
        <label>Dixon-Coles 1X2</label>
        <strong>${escapeHtml(favoritaDc)} (${pctDc}%) · ${escapeHtml(topDc)}</strong>
        <span class="sello ${aciertoDc ? "aprobado" : "rechazado"}">${aciertoDc ? "Acertó 1X2" : "No acertó 1X2"}${aciertoMarcador ? " · marcador exacto" : ""}</span>
      </article>
      <article>
        <label>Predicción ELO</label>
        <strong>${escapeHtml(favorita)} (${pct}%)</strong>
        <span class="sello ${acierto1x2 ? "aprobado" : "rechazado"}">${acierto1x2 ? "Acertó" : "No acertó"}</span>
      </article>
      <article>
        <label>Predicción Poisson 2+</label>
        <strong>${poisson.esAprobado ? "Sí" : "No"} (${poisson.probabilidad}%)</strong>
        <span class="sello ${aciertoPoisson ? "aprobado" : "rechazado"}">${ambos2 ? "Hubo 2+ ambos" : "No hubo 2+ ambos"} · ${aciertoPoisson ? "Acertó" : "No acertó"}</span>
      </article>
    </div>
  `;
}

function renderNextMatch(fix) {
  $("next-match").classList.toggle("is-finished", Boolean(fix.completed));
  const estado = fix.completed ? "Partido finalizado" : fix.inProgress ? "En vivo" : "Próximo partido";
  $("next-match").innerHTML = `
    <div class="next-meta">
      <span class="pill ${fix.completed ? "red" : "gold"}">${estado}</span>
      <span class="pill">${escapeHtml(fix.round)}</span>
    </div>
    <div class="matchup">
      <article class="team">
        <div class="badge" style="${badgeStyle(fix.home)}">${badgeHtml(fix.home)}</div>
        <h3>${escapeHtml(fix.home.name)}</h3>
        <span>Equipo local</span>
      </article>
      <div class="vs-block">
        <div class="vs">VS</div>
        <small>UCL</small>
      </div>
      <article class="team">
        <div class="badge" style="${badgeStyle(fix.away)}">${badgeHtml(fix.away)}</div>
        <h3>${escapeHtml(fix.away.name)}</h3>
        <span>Equipo visitante</span>
      </article>
    </div>
    <div class="venue-row">
      <div class="venue-box">
        <label>Fecha</label>
        <strong>${escapeHtml(formatDate(fix.date))}</strong>
      </div>
      <div class="venue-box">
        <label>Hora</label>
        <strong>${escapeHtml(formatTime(fix.date))} (hora local)</strong>
      </div>
      <div class="venue-box">
        <label>Estadio</label>
        <strong>${escapeHtml(fix.venue)}, ${escapeHtml(fix.city)}</strong>
      </div>
    </div>
  `;
}

function renderFormColumn(team, matches, role) {
  if (!matches.length) {
    return `
      <section class="form-card">
        <h3>${escapeHtml(team.name)}</h3>
        <p class="muted">Sin partidos finalizados recientes en ESPN.</p>
      </section>
    `;
  }

  const pills = matches.map((match) => `<span class="result ${match.result}">${match.result}</span>`).join("");
  const rows = matches.map((match) => `
    <article class="form-item">
      <span class="result ${match.result}">${match.result}</span>
      <div class="opp">
        <strong>vs ${escapeHtml(match.opponent)}</strong>
        <small>${escapeHtml(formatDate(match.date))} · ${escapeHtml(match.ha)}</small>
      </div>
      <strong class="score">${escapeHtml(match.score)}</strong>
    </article>
  `).join("");

  return `
    <section class="form-card">
      <div class="form-head">
        <div>
          <h3>${escapeHtml(team.name)}</h3>
          <small style="color:var(--muted)">${role}</small>
        </div>
        <div class="form-pills" aria-label="Forma reciente">${pills}</div>
      </div>
      <div class="form-list">${rows}</div>
    </section>
  `;
}

function barras1X2(fix, unoXDos) {
  return `
    <div class="pred-bars">
      <div>
        <span>Local ${escapeHtml(fix.home.short)}</span>
        <strong>${unoXDos.victoriaLocal}%</strong>
        <i style="width:${unoXDos.victoriaLocal}%"></i>
      </div>
      <div>
        <span>Empate</span>
        <strong>${unoXDos.empate}%</strong>
        <i class="draw" style="width:${unoXDos.empate}%"></i>
      </div>
      <div>
        <span>Visita ${escapeHtml(fix.away.short)}</span>
        <strong>${unoXDos.victoriaVisitante}%</strong>
        <i class="away" style="width:${unoXDos.victoriaVisitante}%"></i>
      </div>
    </div>
  `;
}

function renderPredicciones(fix, formaLocal, formaVisita, historial) {
  const equipoA = { nombre: fix.home.name, ultimos5: formaLocal };
  const equipoB = { nombre: fix.away.name, ultimos5: formaVisita };
  const unoXDos = calcularProbabilidadVictoria(equipoA, equipoB, historial);
  const poisson = calcularProbabilidadAmbosAnotan2Goles(equipoA, equipoB, historial);
  const dixon = calcularDixonColes(equipoA, equipoB, historial);
  const sello = poisson.esAprobado ? "aprobado" : "rechazado";
  const scores = dixon.marcadores.map((item, index) => `
    <li>
      <b>${index + 1}.</b>
      <strong>${escapeHtml(item.marcador)}</strong>
      <span>${item.probabilidad}%</span>
    </li>
  `).join("");

  $("predictions").innerHTML = `
    <article class="pred-card featured">
      <h3>Dixon-Coles · matriz de goles</h3>
      <p>Poisson modificado · ρ ${dixon.rho} · λ ${dixon.lambdaLocal} / ${dixon.lambdaVisita}</p>
      ${barras1X2(fix, dixon)}
      <div class="dc-meta">
        <span>Over 2.5 <b>${dixon.over25}%</b></span>
        <span>Ambos marcan <b>${dixon.btts}%</b></span>
      </div>
      <ol class="score-list">${scores}</ol>
    </article>
    <article class="pred-card">
      <h3>Modelo ELO ponderado</h3>
      <p>60% forma reciente · 40% historial directo</p>
      ${barras1X2(fix, unoXDos)}
    </article>
    <article class="pred-card">
      <h3>Poisson · ambos anotan 2+</h3>
      <p>λ local ${poisson.lambdaA} · λ visita ${poisson.lambdaB}</p>
      <div class="poisson-box">
        <b>${poisson.probabilidad}%</b>
        <span class="sello ${sello}">${poisson.esAprobado ? "Aprobado" : "No aprobado"}</span>
        <small>P(A≥2)=${poisson.pA_ge2}% · P(B≥2)=${poisson.pB_ge2}% · umbral 35%</small>
      </div>
    </article>
  `;
}

function winnerClass(winner, homeName, awayName) {
  if (winner === "Empate") return "draw";
  if (winner === homeName) return "home";
  if (winner === awayName) return "away";
  return "draw";
}

function renderH2H(fix, rows) {
  const homeWins = rows.filter((row) => row.winner === fix.home.name).length;
  const awayWins = rows.filter((row) => row.winner === fix.away.name).length;
  const draws = rows.filter((row) => row.winner === "Empate").length;
  const total = rows.length || 1;

  $("h2h-caption").textContent = `${fix.home.name} vs ${fix.away.name} · ${rows.length} enfrentamientos`;
  if (!rows.length) {
    setBusy("h2h", "ESPN no devolvió historial directo para este cruce.");
    return;
  }

  $("h2h").innerHTML = `
    <div class="h2h-summary">
      <div class="stat-box">
        <b>${homeWins}</b>
        <span>Victorias ${escapeHtml(fix.home.name)}</span>
      </div>
      <div class="stat-box">
        <b>${draws}</b>
        <span>Empates</span>
      </div>
      <div class="stat-box">
        <b>${awayWins}</b>
        <span>Victorias ${escapeHtml(fix.away.name)}</span>
      </div>
    </div>
    <div class="balance" aria-hidden="true">
      <i class="home" style="width:${(homeWins / total) * 100}%"></i>
      <i class="draw" style="width:${(draws / total) * 100}%"></i>
      <i class="away" style="width:${(awayWins / total) * 100}%"></i>
    </div>
    <div class="table-wrap" style="margin-top:18px">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Partido</th>
            <th>Marcador</th>
            <th>Ganador</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(formatDate(row.date))}</td>
              <td>${escapeHtml(row.home)} vs ${escapeHtml(row.away)}</td>
              <td><strong>${escapeHtml(row.score)}</strong></td>
              <td><span class="winner ${winnerClass(row.winner, row.home, row.away)}">${escapeHtml(row.winner)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function showFixture(id) {
  const fix = fixtures.find((item) => item.id === id);
  if (!fix) return;
  selectedId = id;
  renderFixtures();
  renderNextMatch(fix);
  $("result-panel").hidden = true;
  setBusy("form", "Consultando últimos 5 partidos en ESPN...");
  setBusy("h2h", "Consultando historial directo en ESPN...");
  setBusy("predictions", "Calculando Dixon-Coles, ELO y Poisson...");

  const [homeEvents, awayEvents] = await Promise.all([
    loadSchedule(fix.home.id),
    loadSchedule(fix.away.id)
  ]);

  const formaLocal = lastFive(homeEvents, fix.home.id);
  const formaVisita = lastFive(awayEvents, fix.away.id);
  const historial = headToHead(homeEvents, awayEvents, fix.home.id, fix.away.id);
  const formaLocalPred = lastFive(homeEvents, fix.home.id, fix.id);
  const formaVisitaPred = lastFive(awayEvents, fix.away.id, fix.id);
  const historialPred = headToHead(homeEvents, awayEvents, fix.home.id, fix.away.id, fix.id);

  $("form").innerHTML =
    renderFormColumn(fix.home, formaLocal, "Equipo local") +
    renderFormColumn(fix.away, formaVisita, "Equipo visitante");
  renderH2H(fix, historial);
  renderPredicciones(fix, formaLocalPred, formaVisitaPred, historialPred);

  const equipoA = { nombre: fix.home.name, ultimos5: formaLocalPred };
  const equipoB = { nombre: fix.away.name, ultimos5: formaVisitaPred };
  renderResultadoFinal(
    fix,
    calcularProbabilidadVictoria(equipoA, equipoB, historialPred),
    calcularProbabilidadAmbosAnotan2Goles(equipoA, equipoB, historialPred),
    calcularDixonColes(equipoA, equipoB, historialPred)
  );
}

async function init() {
  setBusy("fixtures", "Cargando próximos partidos desde ESPN...");
  setBusy("next-match", "Conectando con la API de Champions League...");
  setBusy("form", "Esperando cruce seleccionado...");
  setBusy("h2h", "Esperando cruce seleccionado...");
  setBusy("predictions", "Esperando cruce seleccionado...");

  try {
    fixtures = await loadUpcoming();
    if (!fixtures.length) {
      setBusy("next-match", "No hay partidos de Champions League en este periodo.");
      renderFixtures();
      return;
    }
    const inicial = fixtures.find((fix) => !fix.completed) || fixtures[0];
    await showFixture(inicial.id);
    window.setInterval(actualizarEstados, 45000);
  } catch (error) {
    setBusy("fixtures", "No se pudo leer la API de ESPN. Revisa tu conexión y recarga.");
    setBusy("next-match", String(error.message || error));
  }
}

document.addEventListener("click", (event) => {
  const chip = event.target.closest(".fixture-chip");
  if (!chip) return;
  showFixture(chip.dataset.id).catch((error) => {
    setBusy("form", String(error.message || error));
    setBusy("h2h", "No se pudo completar el análisis de este cruce.");
    setBusy("predictions", "No se pudieron calcular las predicciones.");
  });
});

async function actualizarEstados() {
  try {
    const actualizados = await loadUpcoming();
    const antes = fixtures.find((fix) => fix.id === selectedId);
    fixtures = actualizados;
    renderFixtures();
    const ahora = fixtures.find((fix) => fix.id === selectedId);
    if (ahora?.completed && !antes?.completed) {
      await showFixture(selectedId);
    }
  } catch (_error) {
    /* silencioso: el siguiente ciclo reintenta */
  }
}

document.addEventListener("DOMContentLoaded", init);
