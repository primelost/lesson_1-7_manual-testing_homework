import { VERSION, listApplications, createApplication, setMode, resetData, getStorageProblem } from './api.js';
import { checkActivity, isRestricted, initializeSecurity, resetSecurity, reportIncident } from './security.js';

const form = document.querySelector('#application-form');
const filter = document.querySelector('#filter');
const list = document.querySelector('#application-list');
const names = { html: 'HTML и CSS', javascript: 'JavaScript и DOM', api: 'HTTP и API' };
let applications = [];
let selectedId = null;
let revision = 0;
let submissionPending = false;

function setFormStatus(text, state = 'idle') {
  const status = document.querySelector('#form-status');
  status.textContent = text;
  status.dataset.state = state;
}

function resetForm() {
  form.reset();
  const supportCode = form.querySelector('[name="supportCode"]');
  supportCode.defaultValue = '';
  supportCode.value = '';
}

function permitted(action, details = {}) {
  if (isRestricted()) return false;
  checkActivity(action, details);
  return !isRestricted();
}

function validate(values) {
  if (values.name.length < 2 || values.name.length > 60) return 'Имя должно содержать от 2 до 60 символов.';
  if (!Object.hasOwn(names, values.topic)) return 'Выберите направление из списка.';
  if (values.comment.length > 200) return 'Комментарий должен быть не длиннее 200 символов.';
  return '';
}

function renderComment(element, text) {
  element.textContent = text || 'Без комментария';
}

function renderSelection() {
  const selected = applications.find(item => item.id === selectedId);
  document.querySelector('#selection-empty').hidden = Boolean(selected);
  document.querySelector('#selection-content').hidden = !selected;
  if (!selected) return;
  document.querySelector('#selection-name').textContent = selected.name;
  document.querySelector('#selection-topic').textContent = names[selected.topic];
  renderComment(document.querySelector('#selection-comment'), selected.comment);
}

function renderApplications() {
  const visible = applications.filter(item => filter.value === 'all' || item.topic === filter.value);
  const focusedId = document.activeElement?.closest('.application-card')?.dataset.id;
  list.replaceChildren();
  document.querySelector('#application-count').textContent = String(visible.length);
  document.querySelector('#empty-state').hidden = visible.length > 0;

  for (const application of visible) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'application-card';
    card.dataset.id = application.id;
    card.setAttribute('aria-pressed', String(application.id === selectedId));

    const index = document.createElement('span');
    index.className = 'card-index';
    index.textContent = `#${application.id}`;
    const body = document.createElement('span');
    body.className = 'card-body';
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = application.name;
    const topic = document.createElement('span');
    topic.className = 'card-topic';
    topic.textContent = names[application.topic];
    const comment = document.createElement('span');
    comment.className = 'card-comment';
    renderComment(comment, application.comment);
    const arrow = document.createElement('span');
    arrow.className = 'card-arrow';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    body.append(name, topic, comment);
    card.append(index, body, arrow);
    card.addEventListener('click', () => {
      selectedId = application.id;
      renderApplications();
    });
    list.append(card);
  }
  renderSelection();
  if (focusedId) [...list.children].find(card => card.dataset.id === focusedId)?.focus({ preventScroll: true });
}

async function loadApplications() {
  const currentRevision = revision;
  try {
    const loaded = await listApplications();
    if (currentRevision !== revision) return;
    applications = loaded;
    if (!applications.some(item => item.id === selectedId)) selectedId = null;
    renderApplications();
    document.querySelector('#list-status').textContent = '';
  } catch {
    document.querySelector('#list-status').textContent = 'Не удалось обновить список.';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submissionPending || isRestricted()) return;
  const data = new FormData(form);
  const values = {
    name: String(data.get('name') || '').trim(),
    topic: String(data.get('topic') || ''),
    comment: String(data.get('comment') || ''),
  };
  if (!permitted('submit', { topic: values.topic, supportCode: String(data.get('supportCode') || '') })) return;
  const error = validate(values);
  if (error) { setFormStatus(error, 'error'); return; }
  const currentRevision = revision;
  submissionPending = true;
  document.querySelector('#submit-button').disabled = true;
  setFormStatus('Отправляем заявку…', 'pending');
  form.setAttribute('aria-busy', 'true');
  try {
    const response = await createApplication(values);
    const result = await response.json();
    if (currentRevision !== revision) return;
    if (!response.ok) throw new Error(result?.error?.message || `Не удалось отправить заявку (ошибка ${response.status}).`);
    setFormStatus('Заявка сохранена. Спасибо!', 'success');
    resetForm();
    await loadApplications();
  } catch (error) {
    if (currentRevision === revision) setFormStatus(error.message || 'Не удалось отправить заявку.', 'error');
  } finally {
    if (currentRevision === revision) {
      submissionPending = false;
      document.querySelector('#submit-button').disabled = false;
      form.setAttribute('aria-busy', 'false');
    }
  }
});

filter.addEventListener('change', () => {
  const selected = applications.find(item => item.id === selectedId);
  if (selected && filter.value !== 'all' && selected.topic !== filter.value) selectedId = null;
  renderApplications();
});

document.querySelector('#refresh-button').addEventListener('click', () => {
  if (permitted('refresh')) loadApplications();
});

document.querySelector('#reset-interface').addEventListener('click', () => {
  resetForm();
  selectedId = null;
  filter.value = 'all';
  setFormStatus('Интерфейс сброшен.');
  renderApplications();
});

document.querySelector('#service-mode').addEventListener('change', event => {
  setMode(event.target.value);
  document.querySelector('#lab-status').textContent = 'Режим изменён. Повторите отправку.';
});

document.querySelector('#test-incident').addEventListener('click', () => reportIncident('test', 'Ручная проверка журнала'));

document.querySelector('#staff-export').addEventListener('click', () => checkActivity('decoy'));

document.querySelector('#reset-lab').addEventListener('click', async () => {
  revision += 1;
  submissionPending = false;
  form.setAttribute('aria-busy', 'false');
  resetSecurity();
  resetData();
  selectedId = null;
  filter.value = 'all';
  resetForm();
  document.querySelector('#service-mode').value = 'normal';
  document.querySelector('#lab-status').textContent = getStorageProblem() || 'Исходные данные восстановлены.';
  setFormStatus('Заявка останется в этом браузере.');
  await loadApplications();
});

document.querySelector('#version').textContent = VERSION;
initializeSecurity();
await loadApplications();
document.querySelector('#lab-status').textContent = getStorageProblem();
