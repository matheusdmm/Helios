import { loadLatestSnapshot, loadPublicConfig, loadSnapshot, savePublicConfig, saveSnapshot } from './offline-store.ts';
import { getLanguage, setLanguage, t, tf, translateStatic, type Language } from './i18n.ts';
import type { CalendarData, DashboardData, Device, DiscoveryData, Period, PublicConfig } from './api-types.ts';

const $ = (id: string) => document.getElementById(id)! as HTMLInputElement & SVGElement;
interface AppState {
  period: Period;
  date: string;
  calendarMonth: string;
  calendarData: CalendarData | null;
  calendarToken: number;
  config: PublicConfig | null;
  data: DashboardData | null;
  wizardOpen: boolean;
  selectedMac: string;
  returnFocus: HTMLElement | null;
  scanToken: number;
  loadToken: number;
  usingCached: boolean;
  snapshotAt: number;
}
const state: AppState = {
  period: 'day',
  date: new Date().toISOString().slice(0, 10),
  calendarMonth: '',
  calendarData: null,
  calendarToken: 0,
  config: null,
  data: null,
  wizardOpen: false,
  selectedMac: '',
  returnFocus: null,
  scanToken: 0,
  loadToken: 0,
  usingCached: false,
  snapshotAt: 0,
};
const number = (value, digits = 1) => Number.isFinite(Number(value)) ? new Intl.NumberFormat(getLanguage(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value)) : '—';
const integer = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 0 }).format(Number(value)) : '—';
const money = value => value == null ? '—' : new Intl.NumberFormat(getLanguage(), { style: 'currency', currency: 'BRL' }).format(value);

function timeLabel(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'short', timeStyle: 'short', timeZone: state.config?.timeZone || 'America/Sao_Paulo' }).format(new Date(timestamp));
}

function setText(id, value) { $(id).textContent = value; }

function setupNavigation() {
  // Keep the section order aligned with the document, including when scrolling without clicking.
  const sections = ['overview', 'analises', 'historico', 'dispositivo'] as const;
  type Section = typeof sections[number];
  const labels: Record<Section, string> = {
    overview: 'Visão geral da geração',
    analises: 'Análises',
    historico: 'Histórico',
    dispositivo: 'Equipamento',
  };
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.sidebar nav a, .mobile-nav a')];
  let active: Section = 'overview';
  const setActive = (section: Section) => {
    active = section;
    for (const link of links) {
      const selected = link.hash === `#${section}`;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    setText('breadcrumb-current', t(labels[section]));
  };
  const syncToScroll = () => {
    const marker = window.innerHeight * .38;
    let visible: Section = 'overview';
    for (const section of sections.slice(1)) {
      if ($(section).getBoundingClientRect().top <= marker) visible = section;
    }
    const atBottom = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    if (atBottom && $('dispositivo').getBoundingClientRect().top < window.innerHeight) visible = 'dispositivo';
    setActive(visible);
  };
  let scheduled = false;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; syncToScroll(); });
  };
  for (const link of links) link.addEventListener('click', () => setActive(link.hash.slice(1) as Section));
  window.addEventListener('scroll', scheduleSync, { passive: true });
  window.addEventListener('resize', scheduleSync);
  window.addEventListener('hashchange', scheduleSync);
  const hash = location.hash.slice(1);
  setActive(sections.includes(hash as Section) ? hash as Section : 'overview');
  scheduleSync();
  return { refresh: () => setActive(active), sync: scheduleSync };
}

function todayInZone() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: state.config?.timeZone || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const day = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${day.year}-${day.month}-${day.day}`;
}

function renderNotice(data: DashboardData) {
  const notice = $('notice');
  if (data.mode === 'local' && state.config?.needsPassword) { notice.hidden = true; return; }
  notice.classList.toggle('error', Boolean(data.error));
  if (data.mode === 'demo') {
    notice.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = t('Prévia com dados de exemplo.');
    notice.append(heading, ` ${t('Use “Dispositivos” para conectar o S3-WIFI-ST. Os números exibidos nesta prévia não são do seu inversor.')}`);
    notice.hidden = false;
  } else if (data.error) {
    notice.textContent = `${t(data.error)} ${data.inverter ? t('Exibindo a última leitura válida.') : t('A reconexão automática continuará em segundo plano.')}`;
    notice.hidden = false;
  } else notice.hidden = true;
}

function closeWizard() {
  state.scanToken++;
  $('wizard-backdrop').hidden = true;
  document.body.classList.remove('modal-open');
  $('setup-password').value = '';
  state.wizardOpen = false;
  state.returnFocus?.focus?.();
}

function selectDevice(device: Pick<Device, 'ip' | 'mac'>) {
  $('setup-ip').value = device.ip;
  state.selectedMac = device.mac || '';
  setText('selected-device', `${device.ip} · MAC ${device.mac || t('indisponível')}`);
  setText('setup-message', '');
  $('wizard-discovery').hidden = true;
  $('wizard-auth').hidden = false;
  $('setup-password').focus();
}

async function scanDevices() {
  const token = ++state.scanToken;
  $('scan').disabled = true;
  $('scan-results').replaceChildren();
  setText('scan-status', t('Buscando na rede local…'));
  try {
    const response = await fetch('/api/discover', { cache: 'no-store' });
    const result = await response.json() as DiscoveryData;
    if (token !== state.scanToken) return;
    if (!response.ok) throw new Error(result.error || 'A busca falhou.');
    renderDiscovery(result);
    const solis = result.devices.filter(device => device.solis).length;
    setText('scan-status', `${solis} ${t(solis === 1 ? 'coletor Solis' : 'coletores Solis')} · ${result.devices.length} ${t(result.devices.length === 1 ? 'endereço detectado' : 'endereços detectados')}`);
  } catch (error) { if (token === state.scanToken) setText('scan-status', t(error.message)); }
  finally { if (token === state.scanToken) $('scan').disabled = false; }
}

function openWizard() {
  if (state.wizardOpen) return;
  state.returnFocus = document.activeElement as HTMLElement;
  state.wizardOpen = true;
  $('wizard-backdrop').hidden = false;
  $('wizard-discovery').hidden = false;
  $('wizard-auth').hidden = true;
  $('manual-ip').value = state.config?.ip || '';
  document.body.classList.add('modal-open');
  $('wizard-close').focus();
  void scanDevices();
}

function renderDiscovery(result: DiscoveryData) {
  const root = $('scan-results');
  root.replaceChildren();
  if (!result.devices?.length) {
    const empty = document.createElement('p');
    empty.className = 'scan-empty';
    empty.textContent = tf('Nenhum dispositivo respondeu em {network}. Você pode informar o IP manualmente.', { network: result.subnets?.join(', ') || t('uma rede local detectada') });
    root.append(empty);
    return;
  }
  for (const device of result.devices) {
    const button = document.createElement(device.solis ? 'button' : 'div');
    if (device.solis && button instanceof HTMLButtonElement) button.type = 'button';
    button.className = `scan-device${device.solis ? '' : ' other'}`;
    const info = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = device.ip;
    const details = document.createElement('small');
    const sharedMac = device.mac && result.devices.some(other => other !== device && other.mac === device.mac);
    const macNote = sharedMac ? ` · ${t('MAC compartilhado por outros IPs')}` : device.solis && device.mac && device.mac === state.config?.mac ? ` · ${t('mesmo MAC salvo')}` : '';
    details.textContent = `MAC: ${device.mac || t('indisponível')} · ${device.solis ? t('Coletor Solis') : device.status ? `HTTP ${device.status}` : t('sem interface HTTP')}${macNote}`;
    info.append(title, details);
    const action = document.createElement('span'); action.textContent = device.solis ? t('Selecionar →') : t('Não identificado');
    button.append(info, action);
    if (device.solis) button.addEventListener('click', () => selectDevice(device));
    root.append(button);
  }
}

function renderStatus(data: DashboardData) {
  const status = $('status');
  status.className = 'status';
  let text = t('Em operação');
  if (data.mode === 'demo') { status.classList.add('demo'); text = t('Dados de exemplo'); }
  else if (data.error || !data.inverter) { status.classList.add('offline'); text = t('Sem conexão'); }
  else if (data.inverter.state === 'alarm') { status.classList.add('offline'); text = t('Alerta ativo'); }
  else if (Date.now() - data.inverter.updatedAt > 180000) { status.classList.add('offline'); text = t('Leitura desatualizada'); }
  setText('status-text', text);
}

function renderMetrics(data: DashboardData) {
  const inv: NonNullable<DashboardData['inverter']> = data.inverter || {};
  setText('power', inv.powerW == null ? '—' : number(inv.powerW / 1000, 2));
  setText('today', inv.energyTodayKwh == null ? '—' : number(inv.energyTodayKwh, 1));
  setText('month', inv.energyMonthKwh == null ? '—' : number(inv.energyMonthKwh, 1));
  setText('total', inv.energyTotalKwh == null ? '—' : integer(inv.energyTotalKwh));
  const capacity = inv.capacityW && inv.powerW != null ? Math.min(100, Math.max(0, inv.powerW / inv.capacityW * 100)) : null;
  setText('capacity-percent', capacity == null ? '—' : `${Math.round(capacity)}%`);
  $('gauge-fill').style.strokeDashoffset = capacity == null ? '427.26' : String(427.26 * (1 - capacity / 100));
  setText('power-caption', data.mode === 'demo' ? t('Simulação visual · sem conexão com o inversor') : data.error ? t('Última potência registrada') : t('Leitura direta do S3-WIFI-ST'));
  setText('model', inv.model || 'Solis S6-GR1P6K');
  setText('serial', inv.sn || '—');
  setText('temperature', inv.temperatureC == null ? '—' : `${number(inv.temperatureC, 1)} °C`);
  setText('firmware', inv.firmware || '—');
  setText('last-reading', timeLabel(inv.updatedAt));
  setText('sync-label', inv.updatedAt ? tf('Atualizado {time}', { time: timeLabel(inv.updatedAt) }) : t('Aguardando leitura'));
}

function shortTime(timestamp) {
  return timestamp ? new Intl.DateTimeFormat(getLanguage(), { hour: '2-digit', minute: '2-digit', timeZone: state.config?.timeZone || 'America/Sao_Paulo' }).format(new Date(timestamp)) : '—';
}

function renderInsights(data: DashboardData) {
  const insights: NonNullable<DashboardData['insights']> = data.insights || {};
  setText('history-scope', data.mode === 'demo' ? t('Prévia') : t('Com base no histórico local'));
  setText('yesterday', insights.yesterdayKwh == null ? '—' : `${number(insights.yesterdayKwh, 1)} kWh`);
  const delta = insights.yesterdayKwh > 0 && insights.todayKwh != null
    ? (insights.todayKwh / insights.yesterdayKwh - 1) * 100 : null;
  setText('yesterday-delta', delta == null ? t('Sem histórico anterior') : tf('{delta}% · hoje ainda em andamento', { delta: `${delta >= 0 ? '+' : ''}${number(delta, 0)}` }));
  setText('average-seven', insights.average7Kwh == null ? '—' : `${number(insights.average7Kwh, 1)} kWh`);
  setText('average-coverage', insights.average7Days ? tf('Base: {days} de 7 dias anteriores', { days: insights.average7Days }) : t('Sem dias anteriores registrados'));
  setText('peak-power', insights.peakW == null ? '—' : `${number(insights.peakW / 1000, 2)} kW`);
  setText('peak-time', insights.peakAt ? tf('Às {time}', { time: shortTime(insights.peakAt) }) : t('Aguardando leituras'));
  const minutes = insights.generatingMinutes;
  setText('generation-time', minutes == null ? '—' : minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`);
}

function renderCalendar(data: CalendarData) {
  const root = $('calendar');
  root.replaceChildren();
  const month = state.calendarMonth;
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat(getLanguage(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  setText('calendar-month', monthLabel);
  $('calendar-picker').value = month;
  $('calendar-picker').max = todayInZone().slice(0, 7);
  $('calendar-next').disabled = month >= todayInZone().slice(0, 7);
  for (const label of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) {
    const cell = document.createElement('span'); cell.className = 'calendar-weekday'; cell.textContent = t(label); root.append(cell);
  }
  for (let i = 0; i < offset; i++) {
    const spacer = document.createElement('span'); spacer.className = 'calendar-spacer'; spacer.setAttribute('aria-hidden', 'true'); root.append(spacer);
  }
  const days = new Map<string, { energyKwh: number | null; samples: number }>((data.days || []).map(day => [day.date, day]));
  const max = Math.max(1, ...[...days.values()].map(day => day.energyKwh || 0));
  for (let day = 1; day <= count; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const energy = days.get(date)?.energyKwh;
    const cell = document.createElement(date <= todayInZone() && energy != null ? 'button' : 'div');
    cell.className = 'calendar-day';
    if (cell instanceof HTMLButtonElement) { cell.type = 'button'; cell.addEventListener('click', () => {
      state.date = date;
      state.period = 'day';
      for (const button of document.querySelectorAll<HTMLElement>('.period')) button.classList.toggle('active', button.dataset.period === 'day');
      setText('calendar-selection', tf('{date} · {energy} kWh · {samples} leituras registradas', { date: new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'long' }).format(new Date(`${date}T12:00:00`)), energy: number(energy, 1), samples: days.get(date)?.samples || 0 }));
      for (const selected of root.querySelectorAll('.calendar-day.selected')) selected.classList.remove('selected');
      cell.classList.add('selected');
      void load();
      $('historico').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }); }
    if (date === state.date) cell.classList.add('selected');
    if (date > todayInZone()) cell.classList.add('future');
    else if (energy != null) cell.classList.add(`level-${Math.max(1, Math.ceil(energy / max * 4))}`);
    const numberLabel = document.createElement('span'); numberLabel.textContent = String(day);
    const energyLabel = document.createElement('strong'); energyLabel.textContent = energy == null ? '—' : number(energy, 1);
    cell.append(numberLabel, energyLabel);
    cell.setAttribute('aria-label', tf('{day} de {month}: {energy}', { day, month: monthLabel, energy: energy == null ? t('sem leitura') : `${number(energy, 1)} kWh` }));
    root.append(cell);
  }
  const best = (data.days || []).filter(day => day.energyKwh != null).sort((a, b) => b.energyKwh - a.energyKwh)[0];
  setText('calendar-note', best ? tf('Melhor dia registrado: {date} · {energy} kWh. Selecione um dia para ver a curva.', { date: getLanguage() === 'en' ? `${best.date.slice(5, 7)}/${best.date.slice(-2)}` : `${best.date.slice(-2)}/${best.date.slice(5, 7)}`, energy: number(best.energyKwh, 1) }) : t('Os dias sem leitura ficam em branco. O histórico começa quando o painel registra a primeira leitura.'));
}

function renderForecast(data: CalendarData) {
  const forecast = data.forecast;
  const weather = data.weather?.status === 'ready' ? data.weather : null;
  const days: ReadonlyArray<{ date: string; energyKwh: number | null; cloudPct?: number | null; minC?: number; maxC?: number }> = weather?.days ?? forecast?.days ?? [];
  const total = weather ? weather.totalKwh : forecast?.totalKwh;
  const count = weather ? weather.estimatedDays : days.length;
  setText('forecast-horizon', weather ? t('PRÓXIMOS DIAS') : t('PRÓXIMOS 7 DIAS'));
  setText('forecast-source', weather ? 'OpenWeather' : t('Estimativa pelo histórico'));
  setText('forecast-total', total == null ? '—' : number(total, 1));
  setText('forecast-total-unit', count === 0 ? 'kWh' : count === 1 ? t('kWh em 1 dia') : tf('kWh em {days} dias', { days: count }));
  setText('forecast-average', total == null ? '—' : number(weather ? weather.averageKwh : total / count, 1));
  $('forecast-history-range').hidden = Boolean(weather);
  setText('forecast-range', forecast?.lowTotalKwh == null ? '—' : `${number(forecast.lowTotalKwh, 1)}–${number(forecast.highTotalKwh, 1)}`);
  const root = $('forecast-days');
  root.replaceChildren();
  root.classList.toggle('weather-days', Boolean(weather));
  for (const day of days) {
    const item = document.createElement('div'); item.className = 'forecast-day'; item.setAttribute('role', 'listitem');
    const label = document.createElement('span'); label.textContent = new Intl.DateTimeFormat(getLanguage(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day.date}T12:00:00`));
    const value = document.createElement('strong'); value.textContent = day.energyKwh == null ? '—' : `${number(day.energyKwh, 1)} kWh`;
    item.append(label, value);
    if (weather) {
      const conditions = document.createElement('small');
      const temperatures = `${number(day.minC, 0)}–${number(day.maxC, 0)} °C`;
      conditions.textContent = day.cloudPct == null ? temperatures : `${temperatures} · ${tf('{clouds}% de nuvens', { clouds: number(day.cloudPct, 0) })}`;
      item.append(conditions);
    }
    root.append(item);
  }
  const historyNote = data.mode === 'demo' ? t('Conecte o coletor para calcular uma previsão com seus dados.')
    : tf('São necessários 5 dias registrados nos últimos 30 para estimar a geração. Disponíveis: {days}.', { days: forecast?.daysUsed || 0 });
  let note = historyNote;
  if (weather && forecast?.days.length) {
    note = tf('A nebulosidade diurna ajusta a geração entre os percentis 20 e 80 de {days} dias registrados nos últimos 30. Estimativa aproximada.', { days: forecast.daysUsed });
  } else if (!weather && days.length) {
    note = tf('Base: {days} dias registrados nos últimos 30. Mediana e faixa de 20% a 80%. Leituras incompletas podem reduzir a estimativa.', { days: forecast.daysUsed });
  }
  if (data.weather?.status === 'invalid-location') note = `${t('Confira as coordenadas da OpenWeather no arquivo .env.')} ${note}`;
  if (data.weather?.status === 'unauthorized') note = `${t('A OpenWeather recusou o acesso. Confira a chave no arquivo .env.')} ${note}`;
  if (data.weather?.status === 'unavailable') note = `${t('Previsão da OpenWeather indisponível no momento.')} ${note}`;
  setText('forecast-note', note);
  $('forecast-credit').hidden = !weather;
}

async function loadCalendar() {
  const token = ++state.calendarToken;
  const month = state.calendarMonth;
  try {
    const response = await fetch(`/api/calendar?month=${month}`, { cache: 'no-store', signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error('Calendar unavailable');
    const data = await response.json() as CalendarData;
    if (token !== state.calendarToken) return;
    state.calendarData = data;
    if (data.mode === 'local') {
      try { localStorage.setItem(`helios-calendar-${month}`, JSON.stringify({ ...data, weather: undefined })); }
      catch { /* O calendário continua disponível nesta sessão. */ }
    }
    renderCalendar(data); renderForecast(data);
  } catch {
    if (token !== state.calendarToken) return;
    let cached: CalendarData | null = null;
    try { cached = JSON.parse(localStorage.getItem(`helios-calendar-${month}`) || 'null'); } catch { /* cache inválido */ }
    state.calendarData = cached || { mode: 'local', month, days: [], forecast: null };
    renderCalendar(state.calendarData); renderForecast(state.calendarData);
    if (!cached) setText('calendar-note', t('Não foi possível carregar este mês sem conexão.'));
  }
}

function renderTemperature(data: DashboardData) {
  const points = data.insights?.temperature || [];
  const root = $('temperature-chart');
  root.replaceChildren();
  $('temperature-empty').hidden = points.length > 0;
  root.hidden = !points.length;
  if (!points.length) { setText('temperature-range', t('Sem leituras hoje')); return; }
  const temps = points.map(point => point.celsius);
  const min = Math.floor(Math.min(...temps) - 2);
  const max = Math.ceil(Math.max(...temps) + 2);
  setText('temperature-range', `${number(Math.min(...temps), 1)}–${number(Math.max(...temps), 1)} °C`);
  const width = 920, height = 230, left = 43, right = 44, top = 18, bottom = 31;
  const plotW = width - left - right, plotH = height - top - bottom;
  const first = points[0].at, last = points.at(-1).at;
  const x = at => left + (last === first ? .5 : (at - first) / (last - first)) * plotW;
  const yTemp = value => top + (max - value) / (max - min) * plotH;
  const yPower = value => top + (1 - Math.min(6000, Math.max(0, value || 0)) / 6000) * plotH;
  const line = mapper => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(1)} ${mapper(point).toFixed(1)}`).join(' ');
  const grids = [0, .5, 1].map(frac => {
    const y = top + frac * plotH;
    return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-axis" x="${left - 7}" y="${y + 4}" text-anchor="end">${number(max - frac * (max - min), 0)}°</text><text class="chart-axis" x="${width - right + 8}" y="${y + 4}">${number((1 - frac) * 6, 0)}</text>`;
  }).join('');
  const dots = points.length === 1 ? `<circle cx="${x(first)}" cy="${yTemp(temps[0])}" r="4" fill="#d1a341"/>` : '';
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grids}<path class="temperature-power-line" d="${line(point => yPower(point.powerW))}"/><path class="temperature-line" d="${line(point => yTemp(point.celsius))}"/>${dots}<text class="chart-axis" x="${left}" y="${height - 4}">${shortTime(first)}</text><text class="chart-axis" x="${width - right}" y="${height - 4}" text-anchor="end">${shortTime(last)}</text></svg>`;
  root.setAttribute('aria-label', tf('{count} leituras hoje. Temperatura entre {min} e {max} graus Celsius; potência na escala de zero a seis quilowatts.', { count: points.length, min: number(Math.min(...temps), 1), max: number(Math.max(...temps), 1) }));
}

function renderHealth(data: DashboardData) {
  const health: Partial<NonNullable<DashboardData['insights']>['connection']> = data.insights?.connection || {};
  setText('health-last', timeLabel(health.lastSuccessAt));
  setText('health-gap', health.minutesSinceSuccess == null ? '—' : health.minutesSinceSuccess < 1 ? t('Menos de 1 min') : `${health.minutesSinceSuccess} min`);
  setText('health-rate', health.successRate24h == null ? '—' : `${health.successRate24h}% (${health.successes24h}/${health.attempts24h})`);
  setText('health-failures', health.failures24h == null ? '—' : String(health.failures24h));
  const stale = health.minutesSinceSuccess != null && health.minutesSinceSuccess >= 3;
  $('health-note').classList.toggle('health-alert', stale || Boolean(data.error));
  setText('health-note', stale ? t('A última leitura tem mais de 3 minutos. Confira o coletor e a rede.') : data.error ? t('A última tentativa de leitura falhou. Confira o estado do coletor.') : t('A taxa considera somente as tentativas feitas enquanto o painel estava ligado.'));
}

function renderValue(data: DashboardData) {
  setText('value-today', money(data.insights?.estimatedTodayBrl));
  setText('value-month', money(data.insights?.estimatedMonthBrl));
  setText('value-note', t('Valor bruto estimado pela energia produzida. A economia real depende do consumo e da compensação na rede.'));
}

function renderEvents(data: DashboardData) {
  const root = $('event-content');
  root.replaceChildren();
  const symbol = document.createElement('span');
  symbol.className = 'event-symbol';
  const body = document.createElement('div');
  const title = document.createElement('strong');
  const caption = document.createElement('p');
  if (data.alarms?.length) {
    root.classList.add('alert'); symbol.textContent = '!';
    title.textContent = t('Alerta informado pelo coletor');
    caption.textContent = t(data.alarms[0].message);
  } else if (data.error) {
    root.classList.add('alert'); symbol.textContent = '!';
    title.textContent = t('Sem leitura atual'); caption.textContent = t(data.error);
  } else if (data.insights?.connection?.minutesSinceSuccess >= 3) {
    root.classList.add('alert'); symbol.textContent = '!';
    title.textContent = t('Leitura atrasada'); caption.textContent = tf('A última leitura válida ocorreu há {minutes} minutos.', { minutes: data.insights.connection.minutesSinceSuccess });
  } else {
    root.classList.remove('alert'); symbol.textContent = '✓';
    title.textContent = t('Nenhum alerta ativo');
    caption.textContent = data.mode === 'demo' ? t('Estado de exemplo.') : t('O coletor não informou falhas.');
  }
  body.append(title, caption); root.append(symbol, body);
}

function escapeXml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'); }

function renderChart(data: DashboardData) {
  const series = (data.series || []).filter(point => Number.isFinite(Number(point.value)));
  const isDay = data.period === 'day';
  const unit = isDay ? 'kW' : 'kWh';
  setText('chart-unit', isDay ? t('Potência · kW') : t('Energia · kWh'));
  const dateText = new Intl.DateTimeFormat(getLanguage(), data.period === 'day' ? { day: 'numeric', month: 'long', year: 'numeric' } : data.period === 'month' ? { month: 'long', year: 'numeric' } : { year: 'numeric' }).format(new Date(`${data.date}T12:00:00`));
  setText('chart-date', dateText.charAt(0).toUpperCase() + dateText.slice(1));
  $('chart-empty').hidden = series.length > 0;
  $('chart').parentElement.hidden = series.length === 0;
  if (!series.length) { $('chart').replaceChildren(); $('chart').setAttribute('aria-label', t('Ainda não há histórico para este período.')); return; }
  const width = 920, height = 260, left = 44, right = 15, top = 18, bottom = 28;
  const plotW = width - left - right, plotH = height - top - bottom;
  const values = series.map(point => isDay ? Number(point.value) / 1000 : Number(point.value));
  const max = Math.max(1, ...values) * 1.12;
  const grid = [0, .25, .5, .75, 1].map(frac => {
    const y = top + plotH * (1 - frac);
    return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-axis" x="${left - 9}" y="${y + 4}" text-anchor="end">${number(max * frac, max > 20 ? 0 : 1)}</text>`;
  }).join('');
  let marks;
  let labels;
  if (isDay) {
    const coordinates = values.map((value, i) => [left + i / Math.max(1, values.length - 1) * plotW, top + plotH * (1 - value / max)]);
    const line = coordinates.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${coordinates.at(-1)[0].toFixed(1)} ${top + plotH} L${coordinates[0][0].toFixed(1)} ${top + plotH} Z`;
    marks = `<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>` + (values.length === 1 ? `<circle class="chart-dot" cx="${coordinates[0][0]}" cy="${coordinates[0][1]}" r="5"/>` : '');
    labels = series.filter((_, i) => i === 0 || i === series.length - 1 || i % Math.max(1, Math.ceil(series.length / 6)) === 0).map(point => {
      const i = series.indexOf(point), x = left + i / Math.max(1, values.length - 1) * plotW;
      return `<text class="chart-axis" x="${x}" y="${height - 4}" text-anchor="middle">${escapeXml(point.label.slice(0, 5))}</text>`;
    }).join('');
  } else {
    const slot = plotW / values.length, barW = Math.max(4, Math.min(35, slot * .66));
    marks = values.map((value, i) => {
      const h = Math.max(1, value / max * plotH), x = left + slot * i + (slot - barW) / 2, y = top + plotH - h;
      return `<rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeXml(series[i].label)} · ${number(value, 1)} ${unit}</title></rect>`;
    }).join('');
    labels = series.filter((_, i) => values.length <= 12 || i % 5 === 0 || i === values.length - 1).map(point => {
      const i = series.indexOf(point), x = left + slot * (i + .5);
      const label = data.period === 'year' ? point.label.slice(5) : point.label.slice(-2);
      return `<text class="chart-axis" x="${x}" y="${height - 4}" text-anchor="middle">${escapeXml(label)}</text>`;
    }).join('');
  }
  $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grid}${marks}${labels}</svg>`;
  $('chart').setAttribute('aria-label', tf('{count} leituras de {measure} em {date}.', { count: series.length, measure: t(isDay ? 'potência' : 'energia'), date: dateText }));
}

function render(data: DashboardData) {
  state.data = data;
  renderNotice(data); renderStatus(data); renderMetrics(data); renderInsights(data); renderEvents(data);
  renderChart(data); renderTemperature(data); renderHealth(data); renderValue(data);
  const banner = $('offline-banner');
  banner.hidden = !state.usingCached;
  if (state.usingCached) {
    banner.textContent = tf('Sem acesso ao painel local. Exibindo a cópia salva em {time}. Os valores não são em tempo real.', { time: timeLabel(state.snapshotAt) });
    $('status').classList.add('offline');
    setText('status-text', t('Cópia offline'));
    setText('sync-label', tf('Offline · salvo {time}', { time: timeLabel(state.snapshotAt) }));
  }
}

async function load(force = false) {
  const token = ++state.loadToken;
  const requestedDate = state.date;
  let serverData: DashboardData | null = null;
  $('refresh').disabled = true;
  try {
    const url = `/api/dashboard?period=${state.period}&date=${requestedDate}${force ? '&refresh=1' : ''}`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(force ? 25000 : 4500) });
    const data = await response.json() as DashboardData;
    if (!response.ok) { serverData = data; throw new Error(data.error || 'Painel indisponível.'); }
    if (token !== state.loadToken) return;
    state.usingCached = false;
    state.snapshotAt = data.fetchedAt || Date.now();
    render(data);
    if (data.mode === 'local') saveSnapshot(localStorage, state.period, state.date, data, state.snapshotAt);
  } catch {
    if (token !== state.loadToken) return;
    const snapshot = loadSnapshot<DashboardData>(localStorage, state.period, requestedDate) || (requestedDate === todayInZone() ? loadLatestSnapshot<DashboardData>(localStorage, state.period) : null);
    state.usingCached = Boolean(snapshot);
    state.snapshotAt = snapshot?.savedAt || 0;
    render(snapshot?.data || serverData || { mode: 'local', period: state.period, date: state.date, inverter: null, series: [], alarms: [], error: 'Não foi possível conectar ao painel local. Conecte-se à rede Wi-Fi da instalação para atualizar.' });
  } finally { if (token === state.loadToken) $('refresh').disabled = false; }
}

async function primeSnapshots() {
  if (state.usingCached || state.data?.mode !== 'local') return;
  const date = todayInZone();
  await Promise.allSettled(['day', 'month', 'year'].filter(period => period !== state.period).map(async period => {
    const response = await fetch(`/api/dashboard?period=${period}&date=${date}`, { cache: 'no-store', signal: AbortSignal.timeout(4500) });
    if (!response.ok) return;
    const data = await response.json() as DashboardData;
    if (data.mode === 'local') saveSnapshot(localStorage, period, date, data, data.fetchedAt || Date.now());
  }));
}

async function start() {
  const savedLanguage = localStorage.getItem('helios-language');
  const initialLanguage: Language = savedLanguage === 'en' || savedLanguage === 'pt-BR'
    ? savedLanguage : navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  setLanguage(initialLanguage);
  (document.querySelector('link[rel="manifest"]') as HTMLLinkElement).href = initialLanguage === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest';
  translateStatic();
  const navigation = setupNavigation();
  $('language').value = initialLanguage;
  $('language').addEventListener('change', () => {
    const next = $('language').value === 'en' ? 'en' : 'pt-BR';
    setLanguage(next);
    (document.querySelector('link[rel="manifest"]') as HTMLLinkElement).href = next === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest';
    localStorage.setItem('helios-language', next);
    translateStatic();
    navigation.refresh();
    if (state.data) render(state.data);
    if (state.calendarData) { renderCalendar(state.calendarData); renderForecast(state.calendarData); }
    if (state.wizardOpen && !$('wizard-auth').hidden) setText('selected-device', `${$('setup-ip').value} · MAC ${state.selectedMac || t('indisponível')}`);
    if (state.config?.tariffBrlPerKwh > 0) $('tariff').value = number(state.config.tariffBrlPerKwh, 2);
    for (const id of ['setup-message', 'import-message', 'tariff-message']) setText(id, '');
    if (state.wizardOpen && !$('wizard-discovery').hidden) void scanDevices();
  });
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error(t('Configuração indisponível.'));
    state.config = await response.json() as PublicConfig;
    savePublicConfig(localStorage, state.config);
  } catch {
    const cachedConfig = loadPublicConfig(localStorage) as PublicConfig | null;
    state.config = cachedConfig || { timeZone: 'America/Sao_Paulo', canManage: false };
  }
  $('settings-toggle').hidden = !state.config.canManage;
  $('data-section').hidden = !state.config.canManage;
  $('tariff-form').hidden = !state.config.canManage;
  $('setup-ip').value = state.config.ip || '';
  state.selectedMac = state.config.mac || '';
  $('tariff').value = state.config.tariffBrlPerKwh > 0 ? number(state.config.tariffBrlPerKwh, 2) : '';
  state.date = todayInZone();
  state.calendarMonth = state.date.slice(0, 7);
  const changeMonth = (month: string) => {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || month > todayInZone().slice(0, 7)) return;
    state.calendarMonth = month;
    setText('calendar-selection', '');
    void loadCalendar();
  };
  $('calendar-prev').addEventListener('click', () => {
    const [year, month] = state.calendarMonth.split('-').map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 1));
    changeMonth(previous.toISOString().slice(0, 7));
  });
  $('calendar-next').addEventListener('click', () => {
    const [year, month] = state.calendarMonth.split('-').map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    changeMonth(next.toISOString().slice(0, 7));
  });
  $('calendar-today').addEventListener('click', () => {
    state.date = todayInZone();
    state.period = 'day';
    for (const button of document.querySelectorAll<HTMLElement>('.period')) button.classList.toggle('active', button.dataset.period === 'day');
    changeMonth(state.date.slice(0, 7));
    void load();
  });
  $('calendar-picker').addEventListener('change', () => changeMonth($('calendar-picker').value));
  for (const button of document.querySelectorAll<HTMLElement>('.period')) button.addEventListener('click', () => {
    const period = button.dataset.period;
    if (period !== 'day' && period !== 'month' && period !== 'year') return;
    state.period = period;
    if (state.period === 'day') state.date = todayInZone();
    for (const candidate of document.querySelectorAll<HTMLElement>('.period')) candidate.classList.toggle('active', candidate === button);
    void load();
  });
  $('refresh').addEventListener('click', () => { void load(true).then(loadCalendar); });
  $('import-form').addEventListener('submit', async event => {
    event.preventDefault();
    const file = $('import-file').files?.[0];
    if (!file) { setText('import-message', t('Selecione um arquivo CSV.')); return; }
    if (file.size > 100 * 1024 * 1024) { setText('import-message', t('O CSV deve ter até 100 MB.')); return; }
    const button = $('import-form').querySelector('button');
    button.disabled = true;
    setText('import-message', t('Validando e importando leituras…'));
    try {
      const response = await fetch('/api/import.csv', {
        method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-Local-Setup': '1' }, body: await file.text(),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('Não foi possível importar o CSV.'));
      await load();
      await loadCalendar();
      setText('import-message', `${result.imported} ${t(result.imported === 1 ? 'leitura importada' : 'leituras importadas')}; ${result.duplicates} ${t(result.duplicates === 1 ? 'duplicata ignorada' : 'duplicatas ignoradas')}.`);
    } catch (error) { setText('import-message', t(error.message)); }
    finally { button.disabled = false; }
  });
  $('tariff-form').addEventListener('submit', async event => {
    event.preventDefault();
    const raw = $('tariff').value.trim().replace(',', '.');
    const tariffBrlPerKwh = Number(raw);
    if (!raw || !Number.isFinite(tariffBrlPerKwh) || tariffBrlPerKwh <= 0 || tariffBrlPerKwh > 100) {
      setText('tariff-message', t('Informe uma tarifa válida maior que zero.'));
      return;
    }
    const button = $('tariff-form').querySelector('button');
    button.disabled = true;
    setText('tariff-message', t('Salvando…'));
    try {
      const response = await fetch('/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Setup': '1' }, body: JSON.stringify({ tariffBrlPerKwh }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('Não foi possível salvar a tarifa.'));
      state.config.tariffBrlPerKwh = result.tariffBrlPerKwh;
      await load();
      setText('tariff-message', t('Tarifa salva neste computador.'));
    } catch (error) { setText('tariff-message', t(error.message)); }
    finally { button.disabled = false; }
  });
  $('settings-toggle').addEventListener('click', openWizard);
  $('wizard-close').addEventListener('click', closeWizard);
  $('wizard-back').addEventListener('click', () => {
    $('wizard-auth').hidden = true;
    $('wizard-discovery').hidden = false;
    $('scan').focus();
  });
  $('wizard-backdrop').addEventListener('click', event => { if (event.target === $('wizard-backdrop')) closeWizard(); });
  document.addEventListener('keydown', event => {
    if (!state.wizardOpen) return;
    if (event.key === 'Escape') { closeWizard(); return; }
    if (event.key === 'Tab') {
      const focusable = [...$('setup').querySelectorAll<HTMLElement>('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden])')]
        .filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $('scan').addEventListener('click', () => void scanDevices());
  $('manual-next').addEventListener('click', () => {
    const ip = $('manual-ip').value.trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) { setText('scan-status', t('Informe um endereço IPv4 válido.')); return; }
    selectDevice({ ip, mac: ip === state.config?.ip ? state.config?.mac : '' });
  });
  $('setup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('setup-password').value;
    const ip = $('setup-ip').value.trim();
    const button = $('setup-form').querySelector('button');
    button.disabled = true;
    setText('setup-message', t('Conectando ao coletor…'));
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Local-Setup': '1' },
        body: JSON.stringify({ ip, password, mac: state.selectedMac }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('Não foi possível salvar a senha.'));
      state.config.needsPassword = false;
      state.config.configured = true;
      state.config.ip = ip;
      state.config.mac = state.selectedMac;
      $('setup-password').value = '';
      await load();
      if (result.connected) closeWizard();
      else setText('setup-message', t(result.error || 'Não foi possível ler o coletor.'));
    } catch (error) { setText('setup-message', t(error.message)); }
    finally { button.disabled = false; }
  });
  await load();
  navigation.sync();
  void loadCalendar();
  void primeSnapshots();
  if (state.config.canManage && !state.usingCached && ((!state.config.configured && !state.config.hasPassword) || state.config.needsPassword)) openWizard();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); }
    catch (error) { console.warn('Cache offline indisponível:', error); }
  }
  window.addEventListener('online', () => { void load().then(primeSnapshots); void loadCalendar(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
  setInterval(() => {
    if (document.hidden) return;
    void load();
    if (state.calendarMonth === todayInZone().slice(0, 7)) void loadCalendar();
  }, 60000);
}
void start();
