import { PREFIX } from './api.js';

export const CANARY_KEY = `${PREFIX}canary`;
const INCIDENTS_KEY = `${PREFIX}incidents`;
const BLOCKED_UNTIL_KEY = `${PREFIX}blockedUntil`;
const BLOCK_REASON_KEY = `${PREFIX}blockReason`;
const REFRESHES_KEY = `${PREFIX}refreshes`;
const BLOCK_DURATION = 30_000;
const REFRESH_WINDOW = 5_000;
const MAX_INCIDENTS = 30;

let incidents = [];
let blockedUntil = 0;
let blockReason = '';
let storageUnavailable = false;
let restrictionTimer = null;

function getStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    storageUnavailable = true;
    return null;
  }
}

function saveValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    storageUnavailable = true;
    updateRestrictionStatus();
    return false;
  }
}

function displayIncidents() {
  const list = document.querySelector('#incident-list');
  list.replaceChildren();
  for (const incident of [...incidents].reverse()) {
    const item = document.createElement('li');
    const timestamp = new Date(incident.time).toLocaleString();
    item.textContent = `${timestamp} — ${incident.type}: ${incident.reason}`;
    list.append(item);
  }
  document.querySelector('#incidents-empty').hidden = incidents.length > 0;
  document.querySelector('#incident-count').textContent = String(incidents.length);
}

function updateRestrictionStatus() {
  const status = document.querySelector('#security-status');
  const detail = document.querySelector('#restriction-detail');
  const restricted = blockedUntil > Date.now();
  const remaining = Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
  const statusText = restricted ? 'Действия временно ограничены' : 'Ограничений нет';
  status.textContent = storageUnavailable ? `${statusText} (хранилище недоступно)` : statusText;
  detail.hidden = !restricted;
  detail.textContent = restricted ? `Причина: ${blockReason}. Повторите через ${remaining} с.` : '';
  document.querySelector('#submit-button').disabled = restricted || document.querySelector('#application-form').getAttribute('aria-busy') === 'true';
  document.querySelector('#refresh-button').disabled = restricted;
  if (!restricted && restrictionTimer !== null) {
    clearInterval(restrictionTimer);
    restrictionTimer = null;
  }
}

function loadIncidents() {
  const raw = getStoredValue(INCIDENTS_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && Number.isFinite(item.time) && typeof item.type === 'string' && typeof item.reason === 'string')
      .slice(-MAX_INCIDENTS);
  } catch {
    return [];
  }
}

function startRestrictionTimer() {
  updateRestrictionStatus();
  if (blockedUntil > Date.now() && restrictionTimer === null) {
    restrictionTimer = setInterval(updateRestrictionStatus, 1000);
  }
}

export function reportIncident(type, reason) {
  const now = Date.now();
  incidents = [...incidents, { time: now, type, reason }].slice(-MAX_INCIDENTS);
  saveValue(INCIDENTS_KEY, JSON.stringify(incidents));
  displayIncidents();

  if (blockedUntil <= now) {
    blockedUntil = now + BLOCK_DURATION;
    blockReason = reason;
    saveValue(BLOCKED_UNTIL_KEY, String(blockedUntil));
    saveValue(BLOCK_REASON_KEY, blockReason);
  }
  startRestrictionTimer();
}

export function checkActivity(action, details = {}) {
  if (action === 'refresh') {
    const now = Date.now();
    let attempts = [];
    const raw = getStoredValue(REFRESHES_KEY);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) attempts = parsed.filter(Number.isFinite);
      } catch {
        attempts = [];
      }
    }
    attempts = attempts.filter(time => time <= now && now - time <= REFRESH_WINDOW);
    attempts.push(now);
    saveValue(REFRESHES_KEY, JSON.stringify(attempts));
    if (attempts.length >= 6) reportIncident('refresh', 'Шесть обновлений списка за пять секунд');
    return;
  }

  if (action === 'submit') {
    if (details.supportCode) reportIncident('submit', 'Заполнено скрытое поле supportCode');
    if (details.topic && !['html', 'javascript', 'api'].includes(details.topic)) {
      reportIncident('submit', 'Получено неизвестное направление');
    }
    return;
  }

  if (action === 'decoy') {
    reportIncident('decoy', 'Вызвана скрытая кнопка staff-export');
    return;
  }

  if (action === 'startup') {
    const rawCanary = getStoredValue(CANARY_KEY);
    if (rawCanary === null) {
      saveValue(CANARY_KEY, JSON.stringify({ role: 'visitor' }));
    } else {
      try {
        const canary = JSON.parse(rawCanary);
        if (canary && canary.role === 'admin') {
          saveValue(CANARY_KEY, JSON.stringify({ role: 'visitor' }));
          reportIncident('canary', 'В маркере обнаружена роль admin');
        }
      } catch {
        // Некорректный маркер не считается сигналом.
      }
    }

    const url = new URL(window.location.href);
    if (url.searchParams.getAll('staff').includes('1')) {
      url.searchParams.delete('staff');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      reportIncident('url', 'Обнаружен параметр staff=1');
    }
  }
}

export function isRestricted() {
  if (blockedUntil <= Date.now()) {
    if (blockedUntil !== 0) {
      blockedUntil = 0;
      try {
        localStorage.removeItem(BLOCKED_UNTIL_KEY);
        localStorage.removeItem(BLOCK_REASON_KEY);
      } catch {
        storageUnavailable = true;
      }
    }
    updateRestrictionStatus();
    return false;
  }
  updateRestrictionStatus();
  return true;
}

export function initializeSecurity() {
  incidents = loadIncidents();
  displayIncidents();
  const rawBlockedUntil = getStoredValue(BLOCKED_UNTIL_KEY);
  const storedBlock = rawBlockedUntil === null ? 0 : Number(rawBlockedUntil);
  blockedUntil = Number.isFinite(storedBlock) ? storedBlock : 0;
  blockReason = getStoredValue(BLOCK_REASON_KEY) || '';
  if (blockedUntil <= Date.now()) blockedUntil = 0;
  startRestrictionTimer();
  checkActivity('startup');
}

export function resetSecurity() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX) && key !== `${PREFIX}applications`) localStorage.removeItem(key);
    }
    localStorage.setItem(CANARY_KEY, JSON.stringify({ role: 'visitor' }));
  } catch {
    storageUnavailable = true;
  }
  incidents = [];
  blockedUntil = 0;
  blockReason = '';
  displayIncidents();
  if (restrictionTimer !== null) {
    clearInterval(restrictionTimer);
    restrictionTimer = null;
  }
  updateRestrictionStatus();
}
