// ==UserScript==
// @name         Esfer@ MagicTools – Inserció massiva de notes per DNI
// @namespace    https://bfgh.aplicacions.ensenyament.gencat.cat/
// @version      1.2.0
// @description  Emplenat massiu de notes + bulk + desfer + confirmacions
// @author       Joan Ramon López Gillué  <jrlgillue@gmail.com>
// @match        https://bfgh.aplicacions.ensenyament.gencat.cat/bfgh/avaluacio/finalAvaluacioGrupMateria/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/jrlgillue/Esfera-PowerToy-Avaluacio-massiva-per-DNI/blob/main/esfera-avaluacio-dni.user.js
// @updateURL    https://raw.githubusercontent.com/jrlgillue/Esfera-PowerToy-Avaluacio-massiva-per-DNI/blob/main/esfera-avaluacio-dni.user.js

// ==/UserScript==

(() => {
  'use strict';

  /* =======================
     ESTILS
     ======================= */

  const COLORS = {
    PASS: '#d4edda',
    FAIL: '#f8d7da',
    PENDENT: '#d1ecf1',
    PROCES: '#fff3cd'
  };

  function injectStyles() {
    if (document.getElementById('dni-powertoy-styles')) return;
    const style = document.createElement('style');
    style.id = 'dni-powertoy-styles';
    style.textContent = `
      .powertoy-pass { background:${COLORS.PASS} !important; }
      .powertoy-fail { background:${COLORS.FAIL} !important; }
      .powertoy-pendent { background:${COLORS.PENDENT} !important; }
      .powertoy-proces { background:${COLORS.PROCES} !important; }

      .powertoy-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .powertoy-toolbar-right button {
        margin-left: 5px;
      }
    `;
    document.head.appendChild(style);
  }

  /* =======================
     ESTAT (per DESFER)
     ======================= */

  let lastSnapshot = null;

  function saveSnapshot() {
    lastSnapshot = [];
    document.querySelectorAll('tr[data-ng-repeat]').forEach(tr => {
      const select = tr.querySelector('select');
      if (!select || select.disabled) return;
      lastSnapshot.push({
        tr,
        value: select.value || ''
      });
    });
    document.getElementById('btnDesfer').disabled = lastSnapshot.length === 0;
  }

  function undoLastBulk() {
    if (!lastSnapshot) return;

    lastSnapshot.forEach(({ tr, value }) => {
      const select = tr.querySelector('select');
      if (!select || select.disabled) return;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      const clean = value.replace('string:', '');
      pintaFila(tr, clean || null);
    });

    lastSnapshot = null;
    document.getElementById('btnDesfer').disabled = true;
    setResult('↩️ Canvis desfets');
  }

  /* =======================
     UTILITATS
     ======================= */

  function tradueixNota(v) {
    if (!v) return null;
    v = v.toString().trim().replace(',', '.').toUpperCase();

    if (['PENDENT', 'PDT'].includes(v)) return 'PDT';
    if (v === 'EP') return 'EP';
    if (v === 'PQ') return 'PQ';
    if (v === 'NA') return 'NA';

    const n = parseFloat(v);
    if (isNaN(n)) return null;

    if (n >= 9.5) return 'A10';
    if (n >= 8.5) return 'A9';
    if (n >= 7.5) return 'A8';
    if (n >= 6.5) return 'A7';
    if (n >= 5.5) return 'A6';
    if (n >= 5) return 'A5';
    return 'NA';
  }

  function pintaFila(tr, valor) {
    tr.classList.remove(
      'powertoy-pass',
      'powertoy-fail',
      'powertoy-pendent',
      'powertoy-proces'
    );

    if (!valor) return;
    if (valor === 'NA') tr.classList.add('powertoy-fail');
    else if (['PDT', 'PQ'].includes(valor)) tr.classList.add('powertoy-pendent');
    else if (valor === 'EP') tr.classList.add('powertoy-proces');
    else if (/A(10|[5-9])/.test(valor)) tr.classList.add('powertoy-pass');
  }

  function setResult(msg) {
    document.getElementById('resultatNotes').textContent = msg;
  }

  /* =======================
     ACCIONS MASSIVES
     ======================= */

  function bulkSet(valor, force = false) {
    saveSnapshot();
    let count = 0;

    document.querySelectorAll('tr[data-ng-repeat]').forEach(tr => {
      const select = tr.querySelector('select');
      if (!select || select.disabled) return;
      if (!force && select.value) return;

      if (valor === null) {
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        pintaFila(tr, null);
        count++;
        return;
      }

      const internal = 'string:' + valor;
      if (![...select.options].some(o => o.value === internal)) return;

      select.value = internal;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      pintaFila(tr, valor);
      count++;
    });

    setResult(`✔ ${count} files modificades`);
  }

  /* =======================
     DNI + NOTA
     ======================= */

  function aplicaPerDNI() {
    const text = document.getElementById('dniNotesInput').value;
    let count = 0;

    const map = new Map();
    text.split('\n').forEach(line => {
      const p = line.trim().split(/\s+/);
      if (p.length < 2) return;
      const nota = tradueixNota(p[1]);
      if (nota) map.set(p[0].toUpperCase(), nota);
    });

    document.querySelectorAll('tr[data-ng-repeat]').forEach(tr => {
      const dniTd = tr.querySelector('td:nth-child(5)');
      const select = tr.querySelector('select');
      if (!dniTd || !select || select.disabled) return;

      const dni = dniTd.textContent.trim().toUpperCase();
      if (!map.has(dni)) return;

      const nota = map.get(dni);
      const internal = 'string:' + nota;
      if (![...select.options].some(o => o.value === internal)) return;

      select.value = internal;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      pintaFila(tr, nota);
      count++;
    });

    setResult(`✔ ${count} notes aplicades per DNI`);
  }

  /* =======================
     UI
     ======================= */

  function injectUI(anchor) {
    if (document.getElementById('dni-notes-tool')) return;

    injectStyles();

    const div = document.createElement('div');
    div.id = 'dni-notes-tool';
    div.style = 'border:1px solid #ccc;padding:10px;margin-bottom:15px;background:#f9f9f9';

    div.innerHTML = `
      <strong>PowerToy · Avaluació massiva</strong><br>
      <textarea id="dniNotesInput" style="width:100%;height:90px;"></textarea><br><br>

      <div class="powertoy-toolbar">
        <div>
          <button id="aplicaNotes" class="btn btn-primary">Aplica DNI + nota</button>
        </div>
        <div class="powertoy-toolbar-right">
          <button id="btnDesfer" class="btn btn-secondary" disabled>Desfer</button>
          <button id="netejaTot" class="btn btn-default">Neteja tot</button>
          <button id="posaPendent" class="btn btn-info">Pendent</button>
          <button id="posaProces" class="btn btn-warning">En procés</button>
          <button id="posaPQ" class="btn btn-secondary">Pendent Qualificar</button>
        </div>
      </div>

      <div id="resultatNotes" style="margin-top:6px;"></div>
    `;

    anchor.parentElement.insertBefore(div, anchor);

    document.getElementById('aplicaNotes').onclick = aplicaPerDNI;
    document.getElementById('btnDesfer').onclick = undoLastBulk;

    document.getElementById('netejaTot').onclick = () => {
      if (!confirm('Vols esborrar TOTES les qualificacions visibles?')) return;
      bulkSet(null, true);
    };
    document.getElementById('posaPendent').onclick = () => bulkSet('PDT');
    document.getElementById('posaProces').onclick = () => bulkSet('EP');
    document.getElementById('posaPQ').onclick = () => bulkSet('PQ');
  }

  /* =======================
     INIT (Angular-safe)
     ======================= */

  function initWhenReady() {
    let observer;

    function start() {
      if (observer) observer.disconnect();
      observer = new MutationObserver(() => {
        const row = document.querySelector('tr[data-ng-repeat]');
        if (row) {
          observer.disconnect();
          injectUI(row);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    start();
    window.addEventListener('hashchange', () => {
      document.getElementById('dni-notes-tool')?.remove();
      setTimeout(start, 50);
    });
  }

  initWhenReady();
})();


