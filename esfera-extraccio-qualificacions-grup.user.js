// ==UserScript==
// @name         Esfer@-MagicTools - Captura qualificacions FP i exportar a CSV 
// @namespace    https://bfgh.aplicacions.ensenyament.gencat.cat/
// @version      1.2.2
// @description  Acumula qualificacions alumne a alumne i exporta CSV. 
// @author       Joan Ramon López Gillué  <jrlgillue@gmail.com>
// @match        https://bfgh.aplicacions.ensenyament.gencat.cat/bfgh/avaluacio/finalAvaluacioGrupAlumne/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEYS = {
    CAPTURED_IDS: "bfgh_captured_idalus_v2",
    ROWS: "bfgh_rows_v2"
  };

  const UI_ID = "tm-bfgh-qual-toolbar";

  // --- Utils DOM ---
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));


    function getIdaluFromHeaderLine() {
        // Busca un <li class="ng-scope"> que contingui "digits - nom"
        const candidates = Array.from(document.querySelectorAll("li.ng-scope, li[class*='ng-scope']"));

        // Ens quedem amb els visibles (Angular sovint deixa nodes amagats)
        const visibles = candidates.filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });

        // Regex: IDALU (6+ dígits) + guionet + nom
        const re = /(\d{6,})\s*-\s*(.+)/;

        for (const el of visibles) {
            const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
            const m = txt.match(re);
            if (m) {
                return m[1]; // IDALU
            }
        }

        // Fallback: a vegades no és un <li>, sinó un span/div "ng-binding"
        const more = Array.from(document.querySelectorAll(".ng-binding, .ng-scope"));
        for (const el of more) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
            const m = txt.match(re);
            if (m) return m[1];
        }

        return "";
    }

    function getIdaluCurrent() {
        // 1) IDALU real del DOM (capçalera “IDALU - Nom”)
        const idDom = getIdaluFromHeaderLine();
        if (idDom) return idDom;

        // 2) Fallback (per si un dia el DOM no hi és encara)
        const h = location.hash || "";
        const m = h.match(/newFinalAvaluacioGrupAlumneEntradaDades\/(\d+)\//);
        return m ? m[1] : "";
    }




  function isQualificacionsPage() {
    return location.hash.includes("newFinalAvaluacioGrupAlumneEntradaDades/");
  }

  function getIdaluFromHash() {
    const h = location.hash || "";
    const m = h.match(/newFinalAvaluacioGrupAlumneEntradaDades\/(\d+)\//);
    return m ? m[1] : "";
  }

  function getCapturedSet() {
    const arr = GM_getValue(STORE_KEYS.CAPTURED_IDS, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }
  function setCapturedSet(setObj) {
    GM_setValue(STORE_KEYS.CAPTURED_IDS, Array.from(setObj));
  }
  function getAllRows() {
    const rows = GM_getValue(STORE_KEYS.ROWS, []);
    return Array.isArray(rows) ? rows : [];
  }
  function setAllRows(rows) {
    GM_setValue(STORE_KEYS.ROWS, rows);
  }

  function textClean(s) {
    return (s || "").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
  }

  function inferTypeFromCode(code) {
    const c = (code || "").trim();
    // RA típics: ..._01RA, ..._2RA, ..._12RA
    return /_\d+RA$/i.test(c) ? "RA" : "MO";
  }

  function getSelectedValue(selectEl) {
    if (!selectEl) return "";
    const v = (selectEl.value || "").trim();
    if (v) return v;
    const opt = selectEl.selectedOptions && selectEl.selectedOptions[0];
    return opt ? textClean(opt.textContent) : "";
  }

  // --- Detecta la taula correcta (sense confiar en un selector concret) ---
  function findGradesTbody() {
    const tbodies = $all("table tbody");
    if (!tbodies.length) return null;

    // Heurística: la taula de notes té files amb com a mínim 4-5 td
    // i conté inputs type number o selects dins alguna fila.
    for (const tb of tbodies) {
      const trs = Array.from(tb.querySelectorAll("tr"));
      if (trs.length < 3) continue;

      let score = 0;
      for (const tr of trs.slice(0, Math.min(trs.length, 20))) {
        const tds = tr.querySelectorAll("td");
        if (tds.length >= 4) score++;
        if (tr.querySelector('input[type="number"]')) score += 2;
        if (tr.querySelector("select")) score += 2;
      }
      if (score >= 10) return tb;
    }
    return null;
  }

  function extractFromTbody(tbody) {
    const trs = Array.from(tbody.querySelectorAll("tr"));
    // const idalu = getIdaluFromHash();
      const idalu = getIdaluCurrent();
    const out = [];

    for (const tr of trs) {
      const tds = tr.querySelectorAll("td");
      if (!tds || tds.length < 4) continue;

      const codi = textClean(tds[0].textContent);
      const titol = textClean(tds[1].textContent);
      if (!codi || !titol) continue;

      const tipus = inferTypeFromCode(codi);

      const convocatoria = textClean(tds[2]?.textContent || "");

      const provInput = tds[3]?.querySelector('input[type="number"]');
      const qualProv = provInput ? textClean(provInput.value) : "";

      // Columna "definitiva + estat" (sol ser tds[4], però no sempre)
      // Cerquem dins la fila: un select i un input (si n’hi ha)
      let qualDef = "";
      let estat = "";

      // 1) Agafa primer select de la fila (si existeix)
      const sel = tr.querySelector("select");
      const selVal = getSelectedValue(sel);

      // 2) Inputs numèrics: el primer sol ser provisional, el segon (si existeix) definitiva
      const nums = Array.from(tr.querySelectorAll('input[type="number"]'));
      const numVals = nums.map(i => textClean(i.value)).filter(v => v !== "");
      const defVal = (numVals.length >= 2) ? numVals[1] : (numVals.length === 1 ? numVals[0] : "");

      if (tipus === "MO") {
        // MO: provisional = input de la col. provisional (ja capturat), definitiva = segon input (si n’hi ha),
        // estat = select
        qualDef = defVal || "";
        estat = selVal || "";
      } else {
        // RA: la “qualificació” sol estar al select
        qualDef = selVal || defVal || "";
        estat = "";
      }

      out.push({
        IDALU: idalu,
        tipus,
        codi,
        titol,
        convocatoria: (tipus === "MO" ? convocatoria : ""),
        qualificacio_provisional: (tipus === "MO" ? qualProv : ""),
        qualificacio_definitiva: qualDef || "",
        estat: (tipus === "MO" ? estat : "")
      });
    }

    return out;
  }

  // --- Estabilitat: “signatura” del contingut de la taula ---
  function tbodySignature(tbody) {
    // Signatura barata: nº files + concatenació de codis + valors de selects/inputs visibles
    const trs = Array.from(tbody.querySelectorAll("tr"));
    const codes = [];
    let selCount = 0;
    let numCount = 0;

    for (const tr of trs.slice(0, 200)) {
      const tds = tr.querySelectorAll("td");
      if (!tds.length) continue;
      const code = textClean(tds[0].textContent);
      if (code) codes.push(code);
      if (tr.querySelector("select")) selCount++;
      if (tr.querySelector('input[type="number"]')) numCount++;
    }

    return `${trs.length}|${selCount}|${numCount}|${codes.join(";")}`;
  }

  function isCaptureValid(extracted) {
    const rows = extracted.filter(r => r && r.codi && r.titol);
    if (rows.length < 5) return false;

    const mo = rows.filter(r => r.tipus === "MO").length;
    const ra = rows.filter(r => r.tipus === "RA").length;

    // Normalment hi ha MO i RA. Si el grup/centre tingués algun cas rar sense RA, acceptem per volum.
    if (mo >= 1 && ra >= 1) return true;
    if (rows.length >= 20 && mo >= 1) return true; // fallback
    return false;
  }

  // --- CSV ---
  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toCsv(rows) {
    const header = [
      "IDALU",
      "tipus",
      "codi",
      "titol",
      "convocatoria",
      "qualificacio_provisional",
      "qualificacio_definitiva",
      "estat"
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        csvEscape(r.IDALU),
        csvEscape(r.tipus),
        csvEscape(r.codi),
        csvEscape(r.titol),
        csvEscape(r.convocatoria),
        csvEscape(r.qualificacio_provisional),
        csvEscape(r.qualificacio_definitiva),
        csvEscape(r.estat)
      ].join(","));
    }
    return lines.join("\n");
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // --- UI ---
/*
  function updateCounter() {
    const el = $("#tm-bfgh-captured-counter");
    if (!el) return;
    el.textContent = `Alumnes capturats: ${getCapturedSet().size}`;
  }
*/

    function updateCounter() {
        const el = document.querySelector("#tm-bfgh-captured-counter");
        if (!el) return;
        const id = getIdaluCurrent() || "?";
        el.textContent = `Alumnes capturats: ${getCapturedSet().size} (IDALU actual: ${id})`;
    }


  function removeToolbarIfPresent() {
    const old = document.getElementById(UI_ID);
    if (old) old.remove();
  }

  function ensureToolbar() {
    if (!isQualificacionsPage()) { removeToolbarIfPresent(); return; }
    if (document.getElementById(UI_ID)) { updateCounter(); return; }

    // Host: mantenim "a l'esquerra" però fora de problemes de cursor
    // Si span.accions existeix, hi anem; si no, posem-ho al body a dalt a l'esquerra.
    const host = $("span.accions") || document.body;

    const wrap = document.createElement("div");
    wrap.id = UI_ID;
    wrap.style.display = "flex";
    wrap.style.flexDirection = "row";
    wrap.style.gap = "10px";
    wrap.style.alignItems = "center";
    wrap.style.marginTop = "6px";
    wrap.style.pointerEvents = "auto";
    wrap.style.position = (host === document.body) ? "fixed" : "relative";
    wrap.style.left = (host === document.body) ? "12px" : "";
    wrap.style.top = (host === document.body) ? "110px" : "";
    wrap.style.zIndex = "999999";
    wrap.style.cursor = "default"; // evita “prohibició” heretada

    function mkLinkButton(label, cls) {
      const a = document.createElement("a");
      a.href = "#";
      a.setAttribute("role", "button");
      a.className = cls;
      a.textContent = label;
      a.style.pointerEvents = "auto";
      a.style.cursor = "pointer";
      return a;
    }

    const btnExport = mkLinkButton("Exportar qualificacions", "btn btn-primary btn-sm");
    const btnReset = mkLinkButton("Reinicialitzar captura", "btn btn-default btn-sm");
    const btnCaptureNow = mkLinkButton("Capturar ara", "btn btn-default btn-sm");

    const counter = document.createElement("span");
    counter.id = "tm-bfgh-captured-counter";
    counter.style.fontWeight = "bold";
    counter.style.pointerEvents = "auto";
    counter.style.cursor = "default";
    counter.textContent = "Alumnes capturats: 0";

    btnExport.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const rows = getAllRows();
      const ts = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
      downloadText(`qualificacions_${ts}.csv`, toCsv(rows));
    }, true);

    btnReset.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      GM_setValue(STORE_KEYS.CAPTURED_IDS, []);
      GM_setValue(STORE_KEYS.ROWS, []);
      updateCounter();
      alert("Captura reinicialitzada.");
    }, true);

    btnCaptureNow.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      scheduleCapture({ reason: "manual" });
    }, true);

    wrap.appendChild(btnExport);
    wrap.appendChild(btnReset);
    wrap.appendChild(btnCaptureNow);
    wrap.appendChild(counter);

    host.appendChild(wrap);
    updateCounter();
  }

  // --- Captura robusta: estabilitat + reintents ---
  let captureInProgress = false;
  let captureTimer = null;
  let lastCaptureIdalu = "";
  let lastSeenSignature = "";
  let stableSince = 0;

  async function tryCaptureOnce() {
    if (!isQualificacionsPage()) return false;
    // const idalu = getIdaluFromHash();
      const idalu = getIdaluCurrent();
    if (!idalu) return false;

    const captured = getCapturedSet();
    if (captured.has(idalu)) { updateCounter(); return true; }

    const tbody = findGradesTbody();
    if (!tbody) return false;

    const sig = tbodySignature(tbody);
    const now = Date.now();

    if (sig !== lastSeenSignature) {
      lastSeenSignature = sig;
      stableSince = now;
      return false; // encara no estable
    }

    // Ha estat estable prou temps?
    if (now - stableSince < 700) return false;

    const extracted = extractFromTbody(tbody);
    if (!isCaptureValid(extracted)) return false;

    // Desa i marca com capturat
    const all = getAllRows();
    all.push(...extracted);
    setAllRows(all);

    captured.add(idalu);
    setCapturedSet(captured);
    updateCounter();

    console.log("[TM BFGH] Capturat IDALU:", idalu, "files:", extracted.length);
    return true;
  }

  async function captureWithRetries() {
    if (captureInProgress) return;
    if (!isQualificacionsPage()) return;

    // const idalu = getIdaluFromHash();
      const idalu = getIdaluCurrent();
    if (!idalu) return;

    // Si hem canviat d’alumne, reinicia estabilitat
    if (idalu !== lastCaptureIdalu) {
      lastCaptureIdalu = idalu;
      lastSeenSignature = "";
      stableSince = 0;
    }

    captureInProgress = true;
    try {
      // Reintents durant ~12s (40 * 300ms)
      for (let i = 0; i < 40; i++) {
        const ok = await tryCaptureOnce();
        if (ok) return;
        await sleep(300);
      }
      console.warn("[TM BFGH] No s'ha pogut capturar (temps esgotat) per IDALU:", idalu);
    } finally {
      captureInProgress = false;
    }
  }

  function scheduleCapture({ reason = "unknown" } = {}) {
    if (!isQualificacionsPage()) return;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureWithRetries().catch(() => {});
    }, 250);
    // (debug curt)
    // console.log("[TM BFGH] scheduleCapture:", reason);
  }

  // --- SPA: ruta canviada ---
  let lastHash = "";
  function onRouteMaybeChanged() {
    if (location.hash === lastHash) return;
    lastHash = location.hash;

    ensureToolbar();

    // En canvi d’alumne, programa captura
    scheduleCapture({ reason: "hashchange" });
  }

  // --- Intercepta xarxa (fetch + XHR) per saber quan Angular rep dades ---
  function installNetworkHooksOnce() {
    if (window.__tm_bfgh_net_hooks_installed) return;
    window.__tm_bfgh_net_hooks_installed = true;

    // fetch
    const origFetch = window.fetch;
    window.fetch = function (...args) {
      return origFetch.apply(this, args).then((resp) => {
        try {
          if (isQualificacionsPage()) scheduleCapture({ reason: "fetch" });
        } catch (_) {}
        return resp;
      });
    };

    // XHR
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__tm_url = url;
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("loadend", () => {
        try {
          if (isQualificacionsPage()) scheduleCapture({ reason: "xhr" });
        } catch (_) {}
      });
      return origSend.apply(this, args);
    };
  }

  // --- Observa DOM (per quan Angular repinta elements clau) ---
  function installDomObserver() {
    const mo = new MutationObserver(() => {
      // Toolbar desaparegut? Torna’l a posar.
      if (isQualificacionsPage() && !document.getElementById(UI_ID)) ensureToolbar();

      // Qualsevol repintat: programa captura (debounced)
      if (isQualificacionsPage()) scheduleCapture({ reason: "dom" });
      else removeToolbarIfPresent();
    });

    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // --- Start ---
  function boot() {
    installNetworkHooksOnce();
    installDomObserver();

    lastHash = location.hash;
    ensureToolbar();

    window.addEventListener("hashchange", onRouteMaybeChanged, false);

    // Primer intent
    if (isQualificacionsPage()) scheduleCapture({ reason: "boot" });
  }

  boot();
})();
