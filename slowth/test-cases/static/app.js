"use strict";
const { m, LocalizedError, localizedError } = I18n;
const applicationLabel = (value) => value === "Safari / сайт" ? m("tag_safari") : value === "Другое" ? m("tag_other") : value;

const $ = (id) => document.getElementById(id);
const form = $("case-form");
// Public deployment configuration; never read API URLs from query parameters.
const apiOrigin = window.SLOWTH_CONFIG?.apiOrigin || location.origin;
let config, file, active, running = false, selecting = false, stopped = false, paused = false, serverOffset = 0;
let queue = [], historyRows = [], historyBusy = false;
const requests = new Set();
const completed = new Map(), inFlight = new Map();
const bytes = (n) => I18n.size(n);
const now = () => Date.now() / 1000 + serverOffset;
const storageKey = () => `slowth-queue:${config.user_id}`;
const identity = (item) => item.record?.id || item.body.request_id;
const info = (item) => item.record || item.body;
const finalizing = (item) => ["completing", "finalizing", "complete"].includes(item.record?.status);

// Five API requests per browser identity across same-origin tabs. Distinct cases
// can save concurrently; a case lock serializes writes/repair for the same case.
const apiSlots = Array.from({ length: 5 }, () => Promise.resolve());
const apiDepth = Array(5).fill(0);
function api(path, options = {}) {
  const slot = apiDepth.indexOf(Math.min(...apiDepth));
  apiDepth[slot]++;
  const run = async () => {
    const request = () => requestApi(path, options);
    if (!navigator.locks || !config?.user_id) return request();
    const owner = `slowth-api:${config.user_id}`;
    const caseId = path === "/uploads/annotations" ? null : path.match(/^\/uploads\/([^/]+)/)?.[1]
      || (path === "/uploads" && options.method === "POST" ? options.body?.request_id : null);
    const caseIds = [...new Set(options.caseIds || (caseId ? [caseId] : []))].sort();
    const execute = () => navigator.locks.request(`${owner}:slot:${slot}`, request);
    // Acquire multiple case locks in stable order, before the request slot.
    const lockCase = (index) => index === caseIds.length ? execute()
      : navigator.locks.request(`${owner}:case:${caseIds[index]}`, () => lockCase(index + 1));
    const scoped = () => lockCase(0);
    return path === "/uploads" && options.method === "POST"
      ? navigator.locks.request(`${owner}:starts`, scoped) : scoped();
  };
  const result = apiSlots[slot].then(run);
  apiSlots[slot] = result.catch(() => {}).finally(() => { apiDepth[slot]--; });
  return result;
}

async function requestApi(path, { method = "GET", body, skip } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const unchanged = skip?.();
      if (unchanged) return unchanged;
      return await fetchApi(path, { method, body });
    }
    catch (error) {
      // A competing tab/client or annotation repair can briefly own the server lock.
      // Hourly and per-minute budgets are not lock contention and are not retried here.
      if (error.reason !== "user_busy" || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, error.retryAfter * 1000));
    }
  }
}

async function fetchApi(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${apiOrigin}/api${path}`, {
      method, credentials: "include", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Requested-With": "case-saver" },
      ...(body === undefined ? {} : { body: JSON.stringify(typeof body === "function" ? body() : body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new LocalizedError(I18n.apiError(data.code));
      error.status = response.status;
      error.reason = data.reason;
      error.retryAfter = Math.min(10, Math.max(1, Number(response.headers.get("Retry-After")) || 2));
      throw error;
    }
    if (data.server_time) serverOffset = data.server_time - Date.now() / 1000;
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new LocalizedError(m("text_001"));
    if (error instanceof TypeError) throw new LocalizedError(m("text_002"));
    throw error;
  } finally { clearTimeout(timeout); }
}

function errorMessage(message) {
  I18n.bind($("form-error"), message);
  $("form-error").hidden = !I18n.render(message);
}

function saveQueue() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(queue.filter((item) => item.state !== "done").map(({ file, ...saved }) => saved)));
  } catch { /* Upload still works when local storage is unavailable. */ }
}

function state(title, detail = "") {
  $("upload-state").hidden = false;
  I18n.bind($("status-title"), title);
  I18n.bind($("status-detail"), detail);
}

function progress() {
  const total = info(active).size;
  const sent = [...completed.values(), ...inFlight.values()].reduce((sum, size) => sum + size, 0);
  const value = Math.min(100, Math.floor(sent / total * 100));
  $("progress").value = value;
  I18n.bind($("percent"), I18n.percent(value / 100));
}

function renderQueue() {
  const list = $("queue-list"); list.replaceChildren();
  for (const item of queue) {
    const row = document.createElement("div"); row.className = "queue-row";
    const text = document.createElement("div");
    const name = document.createElement("strong"); I18n.bind(name, info(item).filename);
    const status = document.createElement("span");
    I18n.bind(status, item.state === "done" ? m("text_003") : item.state === "uploading" ? m("text_004") : item.error || (!item.file && !finalizing(item) ? m("text_005") : m("text_006")));
    text.append(name, status); row.append(text);
    if (item.state !== "done") {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button queue-remove";
      I18n.bind(remove, m("text_007")); I18n.bind(remove, m("text_008", {p0: info(item).filename}), "aria-label");
      remove.disabled = running || selecting;
      remove.onclick = () => removeItem(item);
      row.append(remove);
    }
    list.append(row);
  }
  const pending = queue.filter((item) => item.state !== "done");
  const done = queue.length - pending.length;
  I18n.bind($("queue-summary"), queue.length ? m("text_009", {p0: queue.length, p1: done, p2: pending.length}) : "");
  I18n.bind($("submit"), pending.length ? m("text_010", {p0: pending.length}) : m("text_011"));
  $("submit").disabled = running || selecting || !pending.length;
  $("form-fields").disabled = running || selecting || !config?.storage_ready;
  $("pause").hidden = !running;
  $("refresh").disabled = running || selecting;
  updateHistoryControls();
}

async function fingerprint(selected) {
  // Bounded memory even for multi-GB videos. This identifies a reselected file, not a full checksum.
  const sample = 1024 * 1024;
  const blob = new Blob([String(selected.size), selected.slice(0, sample), selected.slice(-sample)]);
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function selectFiles(files) {
  if (running || selecting || !config?.storage_ready) return;
  selecting = true; errorMessage(""); $("success").hidden = true; renderQueue();
  const errors = [];
  try {
    for (const selected of files) {
      if (!config.supported_extensions.includes(selected.name.split(".").pop().toLowerCase()) || !selected.size || selected.size > config.max_file_bytes) {
        errors.push(m("text_012", {p0: selected.name, p1: bytes(config.max_file_bytes)})); continue;
      }
      const signature = await fingerprint(selected);
      if (historyRows.some((row) => row.status === "complete" && row.filename === selected.name && row.size === selected.size && row.fingerprint === signature)) continue;
      const existing = queue.find((item) => item.state !== "done" && info(item).filename === selected.name && info(item).size === selected.size && info(item).fingerprint === signature);
      if (existing) { existing.file = selected; existing.error = ""; continue; }
      const queued = queue.filter((item) => item.state !== "done" && !historyRows.some((row) => row.id === identity(item)));
      if (historyRows.length + queued.length >= config.max_user_uploads ||
          [...historyRows, ...queued.map(info)].reduce((sum, row) => sum + row.size, 0) + selected.size > config.max_user_bytes) {
        errors.push(m("text_013", {p0: selected.name})); continue;
      }
      queue.push({ file: selected, state: "ready", body: {
        request_id: crypto.randomUUID(), filename: selected.name, size: selected.size, fingerprint: signature,
      } });
    }
    saveQueue();
  } catch (error) { errors.push(localizedError(error)); }
  finally { selecting = false; $("video").value = ""; renderQueue(); errorMessage(I18n.list(errors, "\n")); }
}

function putPart(url, blob, number) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    requests.add(xhr);
    xhr.open("PUT", url);
    xhr.timeout = 300000;
    xhr.upload.onprogress = (event) => { inFlight.set(number, event.loaded); progress(); };
    const finish = (error) => {
      requests.delete(xhr); inFlight.delete(number);
      if (error) reject(error); else resolve();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        completed.set(number, blob.size); finish(); progress();
      } else finish(new LocalizedError(m("text_014", {p0: xhr.status})));
    };
    xhr.onerror = () => finish(new LocalizedError(m("text_015")));
    xhr.ontimeout = () => finish(new LocalizedError(m("text_016")));
    xhr.onabort = () => finish(new LocalizedError(m("text_017")));
    xhr.send(blob);
  });
}

async function sendPart(number, row) {
  const start = (number - 1) * row.part_size;
  const blob = file.slice(start, Math.min(start + row.part_size, file.size));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (stopped) throw new LocalizedError(m("text_017"));
    try {
      const signed = await api(`/uploads/${row.id}/parts`, { method: "POST", body: { numbers: [number] } });
      if (stopped) throw new LocalizedError(m("text_017"));
      await putPart(signed.parts[0].url, blob, number);
      return;
    } catch (error) {
      if (stopped || attempt === 2 || (error.status && error.status < 500 && error.status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

async function uploadOne(item) {
  active = item; file = item.file; stopped = false;
  item.state = "uploading"; item.error = ""; renderQueue();
  completed.clear(); inFlight.clear(); progress();
  state(m("text_018", {p0: info(item).filename}), m("text_019"));
  if (!item.record) {
    item.record = await api("/uploads", { method: "POST", body: item.body }); saveQueue();
  }
  let row = await api(`/uploads/${item.record.id}`);
  if (row.status === "creating") {
    const body = { request_id: row.id };
    for (const name of ["filename", "size", "fingerprint", "applications", "content_types"]) body[name] = row[name];
    row = await api("/uploads", { method: "POST", body }); row.parts = [];
  }
  item.record = row; saveQueue();
  if (row.status === "complete") return row;
  if (row.status === "creating") throw new LocalizedError(m("api_file_reconciling"));
  if (row.status === "deleting") throw new LocalizedError(m("text_020"));
  if (row.expires_at <= now()) throw new LocalizedError(m("text_021"));
  if (row.status === "pending") {
    if (!file) throw new LocalizedError(m("text_022"));
    const count = Math.ceil(row.size / row.part_size);
    for (const part of row.parts) {
      const expected = Math.min(row.part_size, row.size - (part.number - 1) * row.part_size);
      if (part.size === expected) completed.set(part.number, part.size);
    }
    const parts = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !completed.has(n));
    progress();
    const worker = async () => {
      while (parts.length && !stopped) {
        try { await sendPart(parts.shift(), row); }
        catch (error) { stopped = true; requests.forEach((xhr) => xhr.abort()); throw error; }
      }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(3, parts.length) }, worker));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    if (stopped || paused) throw new LocalizedError(m("text_017"));
  }
  state(m("text_023", {p0: row.filename}), m("text_024"));
  item.record.status = "completing"; saveQueue();
  return api(`/uploads/${row.id}/complete`, { method: "POST" });
}

async function upload() {
  if (running || selecting || !config?.storage_ready || !form.reportValidity()) return;
  if (!queue.some((item) => item.state !== "done")) return;
  saveQueue();
  running = true; paused = false; errorMessage(""); $("success").hidden = true; renderQueue();
  try {
    for (const item of queue) {
      if (paused) break;
      if (item.state === "done") continue;
      if (!item.file && !finalizing(item)) { item.error = m("text_022"); continue; }
      try {
        item.record = await uploadOne(item); item.state = "done"; item.file = null; item.error = "";
        historyRows = [item.record, ...historyRows.filter((row) => row.id !== item.record.id)];
        renderHistory();
      } catch (error) { item.state = "error"; item.error = localizedError(error); }
      saveQueue(); renderQueue();
    }
  } finally {
    running = false; active = null; file = null; $("upload-state").hidden = true;
    const remaining = queue.filter((item) => item.state !== "done");
    $("success").hidden = remaining.length > 0;
    if (remaining.length) errorMessage(paused ? m("text_025") : m("text_026"));
    renderQueue();
  }
}

async function removeItem(item) {
  if (running || selecting) return;
  if ((item.record || item.state === "error") && !confirm(I18n.render(m("text_027")))) return;
  selecting = true; renderQueue();
  try {
    // Initiation may have succeeded even if its response was lost.
    try { await api(`/uploads/${identity(item)}`, { method: "DELETE" }); }
    catch (error) { if (error.status !== 404) throw error; }
    queue = queue.filter((other) => other !== item); saveQueue();
    await refreshHistory();
  } catch (error) { errorMessage(localizedError(error)); }
  finally { selecting = false; renderQueue(); }
}

async function deleteCase(row) {
  if (running || selecting) return;
  if (!confirm(I18n.render(m("text_028")))) return;
  const annotation = annotationStates.get(row.id);
  if (annotation) { annotation.deleting = true; clearTimeout(annotation.timer); updateAnnotationUI(row.id); }
  selecting = true; renderQueue();
  try {
    await api(`/uploads/${row.id}`, { method: "DELETE" });
    queue = queue.filter((item) => identity(item) !== row.id); saveQueue();
    await refreshHistory();
  } catch (error) { I18n.bind($("history-error"), localizedError(error)); $("history-error").hidden = false; }
  finally {
    if (annotationStates.has(row.id) && annotation) { annotation.deleting = false; updateAnnotationUI(row.id); if (dirty(annotation)) scheduleAnnotation(row.id); }
    selecting = false; renderQueue();
  }
}

const annotationStates = new Map(), selectedVideos = new Set();
let restoredAnnotations = {};
const annotationKey = () => `slowth-annotations:${config.user_id}`;
const annotationValue = (row) => ({ applications: row.applications || (row.application ? [row.application] : []), content_types: row.content_types || [] });
const annotationFingerprint = (value) => JSON.stringify({
  applications: [...value.applications].sort(), content_types: [...value.content_types].sort(),
});
const dirty = (state) => annotationFingerprint(state.draft) !== state.savedFingerprint;

function persistAnnotations() {
  try {
    const drafts = Object.fromEntries([...annotationStates].filter(([, state]) => dirty(state)).map(([id, state]) => [id, state.draft]));
    localStorage.setItem(annotationKey(), JSON.stringify(drafts));
  } catch { /* Pending changes still remain in memory if browser storage is unavailable. */ }
}

function getAnnotation(row) {
  if (!annotationStates.has(row.id)) {
    const saved = annotationValue(row), draft = restoredAnnotations[row.id];
    const valid = draft && Array.isArray(draft.applications) && Array.isArray(draft.content_types) &&
      draft.applications.length <= config.max_application_tags && draft.applications.every(validApplication) &&
      draft.content_types.every((tag) => Object.hasOwn(config.content_types, tag));
    const restored = valid && annotationFingerprint(draft) !== annotationFingerprint(saved);
    const state = { draft: restored ? draft : saved, revision: restored ? 1 : 0, savedRevision: 0, savedFingerprint: annotationFingerprint(saved), saving: false, deleting: false, timer: null, editor: null, error: "", lastChange: Date.now() };
    annotationStates.set(row.id, state);
    if (restored) scheduleAnnotation(row.id);
  }
  return annotationStates.get(row.id);
}

function canonicalApplication(value) {
  const clean = value.trim().replace(/\s+/g, " ");
  const known = [...config.applications, ...historyRows.flatMap((row) => annotationValue(row).applications), ...[...annotationStates.values()].flatMap((state) => state.draft.applications)];
  return known.find((tag) => tag.toLowerCase() === clean.toLowerCase()) || clean;
}

function validApplication(value) {
  return typeof value === "string" && Boolean(value.trim()) && Array.from(value).length <= config.max_application_name_length && !/[\x00-\x1f\x7f<>]/.test(value);
}

function appendTag(group, name, value, text) {
  const label = document.createElement("label"); label.className = "chip";
  const input = document.createElement("input"); input.type = "checkbox"; input.name = name; input.value = value;
  input.onchange = () => group.onTagChange(input);
  label.append(input, I18n.textNode(text)); group.querySelector(".chips").append(label);
}

function ensureCustomTags(group, tags) {
  const existing = new Set([...group.querySelectorAll("input[type=checkbox]")].map((input) => input.value));
  for (const tag of tags) if (!existing.has(tag)) { appendTag(group, "applications", tag, applicationLabel(tag)); existing.add(tag); }
}

function customApplicationControl(ids) {
  const container = document.createElement("div"); container.className = "custom-application";
  const label = document.createElement("label"); I18n.bind(label, m("text_029"));
  const input = document.createElement("input"); input.type = "text"; input.className = "custom-application-input";
  input.maxLength = config.max_application_name_length; I18n.bind(input, m("text_030"), "placeholder");
  input.autocomplete = "off"; label.append(input);
  const button = document.createElement("button"); button.type = "button"; button.className = "text-button"; I18n.bind(button, m("text_031"));
  const add = () => {
    const name = canonicalApplication(input.value), selected = ids();
    let error = !validApplication(input.value) ? m("text_032", {p0: config.max_application_name_length}) : "";
    if (!error && selected.some((id) => {
      const state = annotationStates.get(id);
      return state && !state.draft.applications.includes(name) && state.draft.applications.length >= config.max_application_tags;
    })) error = m("text_033", {p0: config.max_application_tags});
    I18n.bind(input, error, "validity");
    if (error) { input.reportValidity(); return; }
    if (!selected.length) return;
    for (const id of selected) changeAnnotation(id, "applications", name, true);
    input.value = ""; input.focus();
  };
  input.oninput = () => I18n.bind(input, "", "validity");
  input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } };
  button.onclick = add; container.append(label, button); return container;
}

function tagGroup(name, title, options, onChange) {
  const fieldset = document.createElement("fieldset"); fieldset.className = "content-fieldset tag-group";
  fieldset.dataset.field = name; fieldset.onTagChange = onChange;
  const legend = document.createElement("legend"); I18n.bind(legend, title);
  const chips = document.createElement("div"); chips.className = "chips";
  fieldset.append(legend, chips);
  for (const [value, text] of options) appendTag(fieldset, name, value, text);
  return fieldset;
}

const pendingAnnotations = new Set();
let annotationFlush;
function enqueueAnnotation(id) {
  pendingAnnotations.add(id);
  clearTimeout(annotationFlush);
  annotationFlush = setTimeout(() => {
    const ids = [...pendingAnnotations]; pendingAnnotations.clear();
    saveAnnotations(ids);
  }, 50);
}

function scheduleAnnotation(id) {
  const state = annotationStates.get(id);
  clearTimeout(state.timer);
  if (dirty(state) && !state.saving && !state.deleting) {
    state.timer = setTimeout(() => enqueueAnnotation(id), Math.max(0, state.lastChange + 5000 - Date.now()));
  }
}

function changeAnnotation(id, field, value, checked) {
  const state = annotationStates.get(id);
  if (!state || state.deleting) return;
  const values = new Set(state.draft[field]);
  if (values.has(value) === checked) return;
  if (checked && field === "applications" && !values.has(value) && values.size >= config.max_application_tags) {
    state.error = m("text_034", {p0: config.max_application_tags});
    updateAnnotationUI(id); updateBulk(); return;
  }
  if (checked) values.add(value); else values.delete(value);
  const order = field === "applications" ? [...new Set([...config.applications, ...values])] : Object.keys(config.content_types);
  state.draft[field] = order.filter((tag) => values.has(tag));
  state.revision++; state.lastChange = Date.now(); state.error = "";
  persistAnnotations(); scheduleAnnotation(id); updateAnnotationUI(id); updateBulk();
}

function updateAnnotationUI(id) {
  const state = annotationStates.get(id);
  if (!state?.editor) return;
  ensureCustomTags(state.editor.querySelector('[data-field="applications"]'), state.draft.applications);
  for (const input of state.editor.querySelectorAll("input[type=checkbox]")) {
    input.checked = state.draft[input.name].includes(input.value);
    input.disabled = state.deleting;
  }
  const message = state.editor.querySelector(".annotation-message");
  I18n.bind(message, state.error ? m("text_035", {p0: state.error}) :
    state.saving ? m("text_036") : dirty(state) ? m("text_037") :
    state.savedRevision ? m("text_038") : m("text_039"));
  message.classList.toggle("error", Boolean(state.error));
  state.editor.querySelector("button[type=submit]").disabled = !dirty(state) || state.saving || state.deleting;
}

function saveAnnotation(id) { return saveAnnotations([id]); }

async function saveAnnotations(ids, attempt = 0) {
  const entries = [...new Set(ids)].map((id) => ({ id, state: annotationStates.get(id) }))
    .filter(({ state }) => state && !state.deleting && !state.saving && dirty(state));
  const groups = [];
  for (let i = 0; i < entries.length; i += 5) groups.push(entries.slice(i, i + 5));
  await Promise.all(groups.map((group) => saveAnnotationGroup(group, attempt)));
}

async function saveAnnotationGroup(entries, attempt) {
  const single = entries.length === 1;
  const retry = [];
  for (const { id, state } of entries) {
    clearTimeout(state.timer); pendingAnnotations.delete(id);
    state.saving = true; state.error = ""; updateAnnotationUI(id);
  }
  updateHistoryControls(); updateBulk();
  const body = () => {
    const items = entries.filter(({ state }) => dirty(state)).map((entry) => {
      entry.revision = entry.state.revision;
      return { upload_id: entry.id, applications: [...entry.state.draft.applications],
        content_types: [...entry.state.draft.content_types] };
    });
    if (!single) return { items };
    const { upload_id, ...annotation } = items[0];
    return annotation;
  };
  try {
    const response = await api(single ? `/uploads/${entries[0].id}/annotation` : "/uploads/annotations", {
      method: single ? "PATCH" : "POST", body, caseIds: entries.map(({ id }) => id),
      skip: () => {
        if (entries.some(({ state }) => dirty(state))) return null;
        for (const entry of entries) entry.revision = entry.state.revision;
        const results = entries.map(({ id }) => ({ id, upload: historyRows.find((row) => row.id === id) }));
        return single ? results[0].upload : { results };
      },
    });
    const results = single ? [{ id: entries[0].id, upload: response }] : response.results;
    for (const result of results) {
      const entry = entries.find(({ id }) => id === result.id);
      if (!entry) continue;
      const { state, revision } = entry;
      if (result.error) {
        state.error = I18n.apiError(result.error.code);
        if (result.error.reason === "user_busy" && attempt < 4) retry.push(entry.id);
        continue;
      }
      const saved = result.upload;
      state.savedFingerprint = annotationFingerprint(annotationValue(saved));
      state.savedRevision = revision;
      if (state.revision === revision) state.draft = annotationValue(saved);
      historyRows = historyRows.map((row) => row.id === entry.id ? saved : row);
    }
    renderHistory();
  } catch (error) {
    for (const { state } of entries) state.error = localizedError(error);
  } finally {
    for (const { id, state } of entries) {
      state.saving = false; updateAnnotationUI(id);
      if (dirty(state) && !state.error && !state.deleting) scheduleAnnotation(id);
    }
    persistAnnotations(); updateHistoryControls(); updateBulk();
  }
  if (retry.length) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await saveAnnotations(retry, attempt + 1);
  }
}

function annotationEditor(row) {
  const editor = document.createElement("form"); editor.className = "annotation annotation-form";
  const state = getAnnotation(row); state.editor = editor;
  editor.append(
    tagGroup("applications", m("text_040"), config.applications.map((name) => [name, applicationLabel(name)]), (input) => changeAnnotation(row.id, input.name, input.value, input.checked)),
    tagGroup("content_types", m("text_041"), Object.keys(config.content_types).map((key) => [key, m(`tag_${key}`)]), (input) => changeAnnotation(row.id, input.name, input.value, input.checked)),
  );
  editor.querySelector('[data-field="applications"]').append(customApplicationControl(() => [row.id]));
  const actions = document.createElement("div"); actions.className = "annotation-actions";
  const save = document.createElement("button"); save.type = "submit"; save.className = "text-button"; I18n.bind(save, m("text_042"));
  const message = document.createElement("p"); message.className = "annotation-message"; message.setAttribute("role", "status");
  actions.append(save, message); editor.append(actions);
  editor.onsubmit = (event) => { event.preventDefault(); saveAnnotation(row.id); };
  updateAnnotationUI(row.id); return editor;
}

function buildBulk() {
  const group = $("bulk-fields");
  const change = (input) => {
    const { name, value, checked } = input;
    for (const id of selectedVideos) changeAnnotation(id, name, value, checked);
  };
  group.append(
    tagGroup("applications", m("text_040"), config.applications.map((name) => [name, applicationLabel(name)]), change),
    tagGroup("content_types", m("text_041"), Object.keys(config.content_types).map((key) => [key, m(`tag_${key}`)]), change),
  );
  group.querySelector('[data-field="applications"]').append(customApplicationControl(() => [...selectedVideos]));
  $("select-all").onchange = (event) => {
    selectedVideos.clear();
    if (event.target.checked) for (const row of historyRows) if (row.status === "complete") selectedVideos.add(row.id);
    updateBulk();
  };
  $("bulk-save").onclick = () => saveAnnotations([...selectedVideos]);
}

function updateBulk() {
  const complete = historyRows.filter((row) => row.status === "complete");
  for (const id of selectedVideos) if (!complete.some((row) => row.id === id)) selectedVideos.delete(id);
  $("bulk-annotation").hidden = !complete.length;
  I18n.bind($("bulk-count"), m("text_043", {p0: selectedVideos.size, p1: complete.length}));
  $("select-all").checked = complete.length > 0 && selectedVideos.size === complete.length;
  $("select-all").indeterminate = selectedVideos.size > 0 && selectedVideos.size < complete.length;
  $("bulk-fields").disabled = selectedVideos.size === 0;
  const states = [...selectedVideos].map((id) => annotationStates.get(id)).filter(Boolean);
  ensureCustomTags($("bulk-fields").querySelector('[data-field="applications"]'), states.flatMap((state) => state.draft.applications));
  for (const input of $("bulk-fields").querySelectorAll("input[type=checkbox]")) {
    const count = states.filter((state) => state.draft[input.name].includes(input.value)).length;
    input.checked = count > 0 && count === states.length;
    input.indeterminate = count > 0 && count < states.length;
  }
  $("bulk-save").disabled = !states.some((state) => dirty(state));
  const errors = states.filter((state) => state.error).length;
  const pending = states.filter((state) => dirty(state)).length;
  I18n.bind($("bulk-status"), errors ? m("text_044", {p0: errors}) :
    pending ? m("text_045", {p0: pending}) :
    states.length ? m("text_046") : m("text_047"));
  for (const input of $("history-list").querySelectorAll(".select-video")) input.checked = selectedVideos.has(input.dataset.id);
}

function updateHistoryControls() {
  for (const article of $("history-list").querySelectorAll(".case-row")) {
    const row = historyRows.find((item) => item.id === article.dataset.id);
    if (!row) continue;
    const deadlinePassed = row.delete_until && now() >= row.delete_until;
    I18n.bind(article.querySelector(".case-status"), row.status === "complete" ? (deadlinePassed ? m("text_048") : m("text_049", {p0: Math.min(60, Math.max(1, Math.ceil((row.delete_until - now()) / 60)))})) : row.status === "deleting" ? m("text_050") : m("text_051"));
    const remove = article.querySelector(".delete-button");
    remove.hidden = Boolean(deadlinePassed && row.status !== "deleting"); remove.disabled = running || selecting || Boolean(annotationStates.get(row.id)?.saving);
    const resume = article.querySelector(".resume-button"); if (resume) resume.disabled = running || selecting;
  }
}

function renderHistory() {
  const list = $("history-list");
  list.querySelector(".empty-history")?.remove();
  for (const article of list.querySelectorAll(".case-row")) {
    const row = historyRows.find((item) => item.id === article.dataset.id);
    if (!row || article.dataset.status !== row.status) article.remove();
  }
  for (const [id, state] of annotationStates) {
    if (!historyRows.some((row) => row.id === id && row.status === "complete")) {
      clearTimeout(state.timer); annotationStates.delete(id); selectedVideos.delete(id);
    }
  }
  if (!historyRows.length) {
    updateBulk(); persistAnnotations();
    const empty = document.createElement("p"); empty.className = "empty-history";
    I18n.bind(empty, m("text_052")); list.append(empty); return;
  }
  for (const row of historyRows) {
    let article = [...list.children].find((element) => element.dataset.id === row.id);
    if (!article) {
      article = document.createElement("article"); article.className = "case-row"; article.dataset.id = row.id; article.dataset.status = row.status;
      const info = document.createElement("div"); info.className = "case-info";
      info.append(document.createElement("h3"), document.createElement("p"));
      if (row.status === "complete") {
        const label = document.createElement("label"); label.className = "case-selection";
        const select = document.createElement("input"); select.type = "checkbox"; select.className = "select-video"; select.dataset.id = row.id;
        I18n.bind(select, m("text_053", {p0: row.filename}), "aria-label");
        select.onchange = () => { if (select.checked) selectedVideos.add(row.id); else selectedVideos.delete(row.id); updateBulk(); };
        label.append(select, I18n.textNode(m("text_054"))); info.prepend(label);
      }
      const actions = document.createElement("div"); actions.className = "case-actions";
      const status = document.createElement("span"); status.className = "case-status"; actions.append(status);
      if (row.status !== "complete" && row.status !== "deleting") {
        const resume = document.createElement("button"); resume.type = "button"; resume.className = "text-button resume-button"; I18n.bind(resume, m("text_055"));
        resume.onclick = () => {
          if (!queue.some((item) => identity(item) === row.id)) queue.push({ record: row, state: "ready" });
          saveQueue(); renderQueue();
          errorMessage(finalizing({ record: row }) ? m("text_056") : m("text_057", {p0: row.filename}));
          form.scrollIntoView({ behavior: "smooth", block: "start" });
        };
        actions.append(resume);
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button delete-button";
      I18n.bind(remove, row.status === "deleting" ? m("text_058") : m("text_059")); remove.onclick = () => deleteCase(row); actions.append(remove);
      article.append(info, actions);
      if (row.status === "complete") article.append(annotationEditor(row));
      list.append(article);
    }
    const annotation = annotationStates.get(row.id);
    if (annotation && !dirty(annotation) && !annotation.saving) {
      annotation.draft = annotationValue(row);
      annotation.savedFingerprint = annotationFingerprint(annotation.draft);
      updateAnnotationUI(row.id);
    }
    I18n.bind(article.querySelector("h3"), row.filename);
    const annotated = Boolean(annotationValue(row).applications.length || row.content_types?.length);
    I18n.bind(article.querySelector(".case-info p"), I18n.list([row.content_type?.startsWith("image/") ? m("text_060") : m("text_061"), bytes(row.size), I18n.list(annotationValue(row).applications.map(applicationLabel), ", "), annotated ? m("text_062") : m("text_063")].filter(Boolean), " · "));
  }
  updateHistoryControls(); updateBulk(); persistAnnotations();
}

async function refreshHistory() {
  if (!config?.storage_ready || historyBusy || running) return;
  historyBusy = true; $("history-error").hidden = true;
  try {
    historyRows = (await api("/uploads")).uploads;
    for (const item of queue) {
      const row = historyRows.find((row) => row.id === identity(item));
      if (row) { item.record = row; if (row.status === "complete") { item.state = "done"; item.file = null; } }
    }
    saveQueue(); renderHistory(); renderQueue();
  } catch (error) { I18n.bind($("history-error"), localizedError(error)); $("history-error").hidden = false; }
  finally { historyBusy = false; }
}

async function boot() {
  try {
    config = await api("/session"); I18n.bind($("visitor-id"), config.user_id);
    I18n.bind($("deletion-visitor-id"), config.user_id);
    I18n.bind($("deletion-email"), () => "mailto:denis@malina.page?subject=" + encodeURIComponent(I18n.render(m("mail_subject"))) + "&body=" + encodeURIComponent(I18n.render(m("mail_body", {id: config.user_id}))), "href");
    try { restoredAnnotations = JSON.parse(localStorage.getItem(annotationKey()) || "{}"); } catch { restoredAnnotations = {}; }
    if (!restoredAnnotations || typeof restoredAnnotations !== "object") restoredAnnotations = {};
    buildBulk();
    I18n.bind($("file-help"), m("text_066", {p0: bytes(config.max_file_bytes)}));
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (Array.isArray(saved)) queue = saved;
      else {
        const oldKey = `slowth-case:${config.user_id}`;
        const old = JSON.parse(localStorage.getItem(oldKey) || "null");
        if (old?.record || old?.body) { queue = [old]; saveQueue(); localStorage.removeItem(oldKey); }
      }
      queue = queue.filter((item) => item?.record?.id || item?.body?.request_id).map((item) => ({ ...item, state: "ready", file: null, error: "" }));
    } catch { queue = []; }
    renderQueue();
    if (!config.storage_ready) errorMessage(m("text_067"));
    await refreshHistory();
  } catch (error) { errorMessage(localizedError(error)); }
}

form.addEventListener("submit", (event) => { event.preventDefault(); upload(); });
$("video").addEventListener("change", (event) => selectFiles([...event.target.files]));
$("drop-zone").addEventListener("dragover", (event) => { event.preventDefault(); if (!running) $("drop-zone").classList.add("dragging"); });
$("drop-zone").addEventListener("dragleave", () => $("drop-zone").classList.remove("dragging"));
$("drop-zone").addEventListener("drop", (event) => {
  event.preventDefault(); $("drop-zone").classList.remove("dragging"); selectFiles([...event.dataTransfer.files]);
});
$("pause").onclick = () => { paused = true; stopped = true; requests.forEach((xhr) => xhr.abort()); };
$("refresh").onclick = refreshHistory;
window.addEventListener("beforeunload", (event) => { if (running || selecting || [...annotationStates.values()].some((state) => dirty(state) || state.saving)) { event.preventDefault(); event.returnValue = ""; } });
setInterval(updateHistoryControls, 30000);
I18n.start().then(boot);
