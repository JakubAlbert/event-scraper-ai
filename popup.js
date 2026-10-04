// The popup owns the editable form; background.js owns extraction and network work.
(() => {
  'use strict';

  const DEFAULT_EMAIL = 'email@example.com';
  const FIELD_IDS = {
    title: 'event-title', dateFrom: 'event-date-from', dateTo: 'event-date-to',
    venue: 'event-venue', street: 'event-street', number: 'event-number', city: 'event-city',
    email: 'event-email', url: 'event-web'
  };
  const fields = Object.fromEntries(Object.entries(FIELD_IDS).map(([key, id]) => [key, document.getElementById(id)]));
  const status = document.getElementById('extraction-status');
  const selector = document.getElementById('event-selector');
  const listContainer = document.getElementById('list-container');
  const singleButton = document.getElementById('extract-single-btn');
  const listButton = document.getElementById('extract-list-btn');
  const saveButton = document.getElementById('save-btn');
  const state = {
    request: 0, selection: 0, selectedIndex: -1, mode: 'single', busy: '',
    events: [], addressAttempts: new Set(), addressEdits: 0, pageUrl: '',
    resultMessage: '', warnings: [], savedForm: null, saveError: ''
  };

  function callChrome(invoke) {
    return new Promise((resolve, reject) => {
      try {
        invoke(result => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function showResult(extraWarnings = []) {
    const warnings = [...new Set([...state.warnings, ...extraWarnings].filter(value => typeof value === 'string' && value.trim()))];
    setStatus([state.resultMessage, ...warnings].join(' '), warnings.length ? 'warning' : 'success');
  }

  function isFormSaved() {
    const current = readForm();
    return state.savedForm !== null && Object.keys(fields).every(key =>
      !fields[key].validity.badInput && current[key] === state.savedForm[key]
    );
  }

  function updateSaveButton() {
    const saved = isFormSaved();
    saveButton.textContent = state.busy === 'save' ? 'Ukladám…'
      : state.saveError || (saved ? 'Uložené' : 'Uložiť');
    saveButton.dataset.state = state.busy === 'save' ? 'saving' : state.saveError ? 'error' : saved ? 'saved' : 'idle';
    saveButton.disabled = Boolean(state.busy) || state.selectedIndex < 0;
  }

  function setBusy(busy) {
    state.busy = busy;
    singleButton.disabled = Boolean(busy);
    listButton.disabled = Boolean(busy);
    selector.disabled = Boolean(busy) || !state.events.length;
    updateSaveButton();
    // Address lookup can run while the user corrects the form.
    Object.values(fields).forEach(field => { field.disabled = busy === 'extract' || busy === 'save'; });
    status.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function readForm() {
    return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim()]));
  }

  function populateForm(event) {
    state.saveError = '';
    Object.entries(fields).forEach(([key, field]) => {
      field.value = event[key] || (key === 'email' ? DEFAULT_EMAIL : '');
    });
    updateSaveButton();
  }

  function makeOption(value, label) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    return option;
  }

  function resetSelector(label) {
    selector.replaceChildren(makeOption('', label));
  }

  function rememberEdits() {
    if (state.selectedIndex >= 0) state.events[state.selectedIndex] = readForm();
  }

  async function selectEvent(index, request = state.request) {
    if (!state.events[index] || request !== state.request) return;
    rememberEdits();
    const selection = ++state.selection;
    state.selectedIndex = index;
    selector.value = String(index);
    const event = state.events[index];
    populateForm(event);
    setBusy('');
    showResult();

    const incomplete = !event.street || !event.number || !event.city;
    if (state.mode !== 'bulk' || !incomplete || !(event.venue || event.street) || state.addressAttempts.has(index)) return;

    state.addressAttempts.add(index);
    const addressEdits = state.addressEdits;
    setBusy('address');
    setStatus('Podujatie načítané. Dopĺňam adresu…');
    try {
      const result = await callChrome(done => chrome.runtime.sendMessage({ action: 'enhance_event_address', event }, done));
      if (request !== state.request || selection !== state.selection) return;
      if (!result?.ok || !result.event) throw new Error(result?.error || 'Adresu sa nepodarilo doplniť.');
      // Never repopulate the entire form after a lookup: the user may already be editing it.
      if (addressEdits === state.addressEdits) {
        for (const key of ['street', 'number', 'city']) {
          if (!fields[key].value.trim() && result.event[key]) fields[key].value = result.event[key];
        }
      }
      rememberEdits();
      showResult(Array.isArray(result.warnings) ? result.warnings : []);
    } catch (error) {
      if (request === state.request && selection === state.selection) {
        state.addressAttempts.delete(index);
        showResult([error.message]);
      }
    } finally {
      if (request === state.request && selection === state.selection) setBusy('');
    }
  }

  async function extract(mode, force = false) {
    const request = ++state.request;
    ++state.selection;
    state.mode = mode;
    state.events = [];
    state.selectedIndex = -1;
    state.addressAttempts.clear();
    state.warnings = [];
    state.pageUrl = '';
    populateForm({});
    listContainer.style.display = mode === 'bulk' ? 'block' : 'none';
    resetSelector('Načítavam podujatia…');
    setBusy('extract');
    setStatus(mode === 'bulk' ? 'Načítavam zoznam podujatí…' : 'Načítavam podujatie…');

    try {
      const tabs = await callChrome(done => chrome.tabs.query({ active: true, currentWindow: true }, done));
      if (request !== state.request) return;
      const tab = tabs?.[0];
      if (!tab || !Number.isInteger(tab.id)) throw new Error('Nenašla sa otvorená karta. Otvorte stránku podujatia a skúste to znova.');
      if (!/^https?:\/\//i.test(tab.url || '') || /^https:\/\/(?:chromewebstore\.google\.com(?:\/|$)|chrome\.google\.com\/webstore(?:\/|$))/i.test(tab.url)) {
        throw new Error('Na tejto stránke rozšírenie nemôže čítať obsah. Otvorte webovú stránku podujatia.');
      }

      let snapshot;
      try {
        snapshot = await callChrome(done => chrome.tabs.sendMessage(tab.id, { action: 'get_event_data', mode }, done));
      } catch {
        throw new Error('Stránku sa nepodarilo načítať. Obnovte ju klávesom F5 a otvorte rozšírenie znova.');
      }
      if (request !== state.request) return;
      if (!snapshot || snapshot.ok === false) throw new Error(snapshot?.error || 'Stránka neposkytla údaje. Obnovte ju klávesom F5 a skúste to znova.');
      state.pageUrl = snapshot.url || tab.url;
      const result = await callChrome(done => chrome.runtime.sendMessage({ action: 'extract_event', snapshot, mode, force }, done));
      if (request !== state.request) return;
      if (!result?.ok || !Array.isArray(result.events)) throw new Error(result?.error || 'Spracovanie sa prerušilo. Skúste podujatie načítať znova.');

      state.events = result.events.map(event => ({
        ...EventData.normalizeEvent(event), email: DEFAULT_EMAIL, url: event.url || state.pageUrl
      }));
      state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
      state.resultMessage = result.cached ? 'Údaje načítané z pamäte.'
        : result.source === 'partial' ? 'Údaje načítané. Skontrolujte a doplňte chýbajúce polia.'
          : mode === 'bulk' ? `Načítané podujatia: ${state.events.length}.` : 'Podujatie načítané.';

      if (!state.events.length) {
        resetSelector('Nenašli sa žiadne aktuálne podujatia.');
        setBusy('');
        setStatus('Nenašli sa žiadne aktuálne podujatia.', 'warning');
        return;
      }
      selector.replaceChildren(...state.events.map((event, index) =>
        makeOption(index, `${EventData.formatSlovakDate(event.dateFrom) || '?'} | ${event.title || 'Bez názvu'}`)
      ));
      await selectEvent(0, request);
    } catch (error) {
      if (request !== state.request) return;
      state.events = [];
      state.selectedIndex = -1;
      populateForm({});
      resetSelector('Podujatia sa nepodarilo načítať.');
      setBusy('');
      setStatus(error.message || 'Podujatie sa nepodarilo načítať.', 'error');
    }
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(EventData.formatSlovakDate(value));
  }

  async function save() {
    if (state.busy || state.selectedIndex < 0) return;
    // Repeated clicks and delayed input/change events must not erase confirmation.
    if (isFormSaved()) return;
    state.saveError = '';
    const event = readForm();
    if (!event.title) {
      state.saveError = 'Doplňte názov';
      updateSaveButton();
      setStatus('Pred uložením doplňte názov podujatia.', 'error');
      fields.title.focus();
      return;
    }
    for (const key of ['dateFrom', 'dateTo']) {
      if (fields[key].validity.badInput || (event[key] && !validDate(event[key])) || (key === 'dateFrom' && !event[key])) {
        state.saveError = 'Doplňte platný dátum';
        updateSaveButton();
        setStatus('Pred uložením doplňte platný dátum podujatia.', 'error');
        fields[key].focus();
        return;
      }
    }
    event.dateTo = event.dateTo || event.dateFrom;
    if (event.dateTo < event.dateFrom) {
      state.saveError = 'Opravte dátumy';
      updateSaveButton();
      setStatus('Dátum konca nemôže byť pred dátumom začiatku.', 'error');
      fields.dateTo.focus();
      return;
    }

    const request = state.request;
    setBusy('save');
    const cachedEvent = {
      ...event,
      dateFrom: EventData.formatSlovakDate(event.dateFrom),
      dateTo: EventData.formatSlovakDate(event.dateTo)
    };
    try {
      await callChrome(done => chrome.storage.local.set({ cachedEvent }, done));
      if (request !== state.request) return;
      fields.dateTo.value = event.dateTo;
      rememberEdits();
      state.savedForm = { ...event };
      setStatus('Údaje uložené. Do kompatibilného formulára ich vložíte klávesmi Alt+X.', 'success');
    } catch (error) {
      if (request === state.request) {
        state.saveError = 'Uloženie zlyhalo – skúsiť znova';
        setStatus(`Údaje sa nepodarilo uložiť: ${error.message}`, 'error');
      }
    } finally {
      if (request === state.request) setBusy('');
    }
  }

  for (const field of Object.values(fields)) {
    const refreshSaveState = () => {
      state.saveError = '';
      updateSaveButton();
    };
    field.addEventListener('input', refreshSaveState);
    field.addEventListener('change', refreshSaveState);
  }
  for (const key of ['venue', 'street', 'number', 'city']) {
    fields[key].addEventListener('input', () => { ++state.addressEdits; });
  }
  singleButton.addEventListener('click', () => extract('single', true));
  listButton.addEventListener('click', () => extract('bulk'));
  selector.addEventListener('change', () => {
    const index = Number(selector.value);
    if (selector.value !== '' && Number.isInteger(index)) void selectEvent(index);
  });
  saveButton.addEventListener('click', save);
  void extract('single');
})();
