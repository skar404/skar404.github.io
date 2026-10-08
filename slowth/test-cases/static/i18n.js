"use strict";

// All messages, including errors, remain descriptors until rendered. Locale changes
// only touch bound text nodes/attributes: no upload, form, draft or timer is reset.
const I18n = (() => {
  const assetBase = new URL("./", document.currentScript.src);
  const locales = {"ar": "العربية", "ar-EG": "العربية (مصر)", "be": "Беларуская", "bn": "বাংলা", "cs": "Čeština", "da": "Dansk", "de": "Deutsch", "en": "English", "es": "Español", "fil": "Filipino", "fr": "Français", "ha": "Hausa", "he": "עברית", "hi": "हिन्दी", "hu": "Magyar", "hy": "Հայերեն", "id": "Bahasa Indonesia", "it": "Italiano", "ja": "日本語", "ka": "ქართული", "kk": "Қазақша", "ko": "한국어", "ky": "Кыргызча", "lt": "Lietuvių", "mr": "मराठी", "ne": "नेपाली", "nl": "Nederlands", "pa-Arab": "پنجابی (شاہ مکھی)", "pcm": "Naijá", "pl": "Polski", "pt-BR": "Português (Brasil)", "pt-PT": "Português (Portugal)", "ro": "Română", "ru": "Русский", "sv": "Svenska", "sw": "Kiswahili", "ta": "தமிழ்", "te": "తెలుగు", "th": "ไทย", "tr": "Türkçe", "uk": "Українська", "ur": "اردو", "vi": "Tiếng Việt", "yue": "粵語", "zh-CN": "简体中文", "zh-TW": "繁體中文"};
  const english = Object.freeze(window.SLOWTH_EN);
  const rtl = new Set(["ar", "ar-EG", "he", "pa-Arab", "ur"]);
  const cache = new Map([["en", english]]);
  const bindings = new Map();
  let language = "en", dictionary = english, generation = 0, prunePending = false;
  const m = (key, params = {}) => ({ key, params });
  const list = (items, separator) => ({ items, separator });
  const size = (value) => ({ size: value });
  const percent = (value) => ({ percent: value });
  const normalize = (value) => Object.keys(locales).find((key) => key.toLowerCase() === String(value ?? "").replaceAll("_", "-").toLowerCase()) || "en";
  const numberLocale = () => ({ pcm: "en-NG", yue: "zh-HK", "pa-Arab": "pa-Arab-PK" }[language] || language);
  const format = (value, options = {}) => new Intl.NumberFormat(numberLocale(), options).format(value);
  function render(value) {
    if (typeof value === "function") return render(value());
    if (typeof value === "number") return format(value);
    if (value == null) return "";
    if (typeof value !== "object") return String(value);
    if (Object.hasOwn(value, "size")) {
      const giga = value.size >= 1024 ** 3;
      return format(value.size / 1024 ** (giga ? 3 : 2), { style: "unit", unit: giga ? "gigabyte" : "megabyte", unitDisplay: "short", maximumFractionDigits: 1 });
    }
    if (Object.hasOwn(value, "percent")) return format(value.percent, { style: "percent", maximumFractionDigits: 0 });
    if (Array.isArray(value.items)) return value.items.map(render).filter(Boolean).join(value.separator);
    const template = dictionary[value.key] ?? english[value.key] ?? dictionary.api_request_failed;
    return template.replace(/\{(\w+)\}/g, (_, name) => render(value.params?.[name]));
  }
  class LocalizedError extends Error {
    constructor(message) { super(render(message)); this.localized = message; }
  }
  const localizedError = (error) => error?.localized || m("api_request_failed");
  const apiError = (code) => m(typeof code === "string" && Object.hasOwn(english, `api_${code}`) ? `api_${code}` : "api_request_failed");

  function bind(node, value, attribute = "text") {
    let slots = bindings.get(node);
    if (!slots) { slots = new Map(); bindings.set(node, slots); }
    let slot = slots.get(attribute);
    if (!slot) {
      if (attribute === "text") {
        const text = node.nodeType === Node.TEXT_NODE ? node : document.createTextNode("");
        if (text !== node) node.replaceChildren(text);
        slot = { apply: (textValue) => { text.data = textValue; } };
      } else if (attribute === "validity") {
        slot = { apply: (textValue) => node.setCustomValidity(textValue) };
      } else {
        slot = { apply: (textValue) => node.setAttribute(attribute, textValue) };
      }
      slots.set(attribute, slot);
    }
    slot.value = value;
    slot.apply(render(value));
    // Builders append nodes synchronously. Prune discarded queue/history rows
    // afterwards so repeated progress updates cannot retain detached forms.
    if (!prunePending) {
      prunePending = true;
      queueMicrotask(() => {
        for (const target of bindings.keys()) if (!target.isConnected) bindings.delete(target);
        prunePending = false;
      });
    }
    return node;
  }
  const textNode = (value) => bind(document.createTextNode(""), value);
  const placeholders = (value) => (value.match(/\{\w+\}/g) || []).sort().join(",");
  function validDictionary(candidate) {
    return candidate && typeof candidate === "object" && Object.keys(candidate).length === Object.keys(english).length &&
      Object.entries(english).every(([key, text]) => typeof candidate[key] === "string" && candidate[key].trim() && placeholders(text) === placeholders(candidate[key]));
  }
  async function load(locale) {
    if (cache.has(locale)) return cache.get(locale);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(new URL(`locales/${locale}.json`, assetBase), { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok) throw new Error("Dictionary unavailable");
      const candidate = await response.json();
      if (!validDictionary(candidate)) throw new Error("Invalid dictionary");
      cache.set(locale, candidate);
      return candidate;
    } finally { clearTimeout(timeout); }
  }
  async function setLanguage(value, updateURL = true) {
    const request = ++generation;
    let next = normalize(value), nextDictionary, fallback = false;
    try { nextDictionary = await load(next); }
    catch { next = "en"; nextDictionary = english; fallback = true; }
    if (request !== generation) return;
    language = next; dictionary = nextDictionary;
    document.documentElement.lang = next;
    document.documentElement.dir = rtl.has(next) ? "rtl" : "ltr";
    document.getElementById("language").value = next;
    for (const [node, slots] of bindings) {
      if (!node.isConnected) { bindings.delete(node); continue; }
      for (const slot of slots.values()) slot.apply(render(slot.value));
    }
    if (updateURL || fallback) {
      const url = new URL(location.href);
      url.searchParams.set("lang", next);
      history.replaceState(history.state, "", url);
    }
    document.dispatchEvent(new CustomEvent("languagechange", { detail: { language } }));
  }
  async function start() {
    for (const node of document.querySelectorAll("[data-i18n]")) bind(node, m(node.dataset.i18n));
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) bind(node, m(node.getAttribute(`data-i18n-${attribute}`)), attribute);
    }
    bind(document.querySelector("title"), m("text_068"));
    const select = document.getElementById("language");
    bind(select, m("language"), "aria-label");
    for (const [code, name] of Object.entries(locales)) {
      const option = document.createElement("option");
      option.value = code; option.textContent = name; option.lang = code; option.dir = rtl.has(code) ? "rtl" : "ltr";
      select.append(option);
    }
    select.value = "en";
    select.addEventListener("change", () => setLanguage(select.value));
    window.addEventListener("popstate", () => setLanguage(new URL(location.href).searchParams.get("lang"), false));
    await setLanguage(new URL(location.href).searchParams.get("lang"), false);
  }
  return { m, render, bind, textNode, list, size, percent, apiError, LocalizedError, localizedError, start, setLanguage, normalize, validDictionary, locales, get language() { return language; } };
})();
