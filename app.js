/* Inner Match – Tennis-Adventskalender
   Inhalte: content/de.json, content/en.json
   Einträge der Nutzer bleiben nur im Browser (localStorage). */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem("im-" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("im-" + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const params = new URLSearchParams(location.search);
  if (params.has("vorschau") || params.has("preview")) store.set("preview", true);
  let lang = params.get("lang") || store.get("lang") || ((navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en");
  let soundOn = store.get("sound", true);
  const cache = {};
  let C = null;       // aktueller Inhalt
  let current = null; // offene Tür

  /* ---------- Sound (Web Audio, ohne Dateien) ---------- */
  let ac = null;
  const audio = () => { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); } if (ac && ac.state === "suspended") ac.resume(); return ac; };
  function noiseBuf(a, sec) { const b = a.createBuffer(1, a.sampleRate * sec, a.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  const sfx = {
    pop(t0 = 0, vol = .9) { // Ballkontakt
      const a = audio(); if (!a || !soundOn) return; const t = a.currentTime + t0;
      const o = a.createOscillator(), g = a.createGain(); o.type = "sine";
      o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(140, t + .09);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .12);
      const n = a.createBufferSource(); n.buffer = noiseBuf(a, .05); const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; const ng = a.createGain(); ng.gain.setValueAtTime(vol * .5, t); ng.gain.exponentialRampToValueAtTime(.001, t + .04);
      o.connect(g).connect(a.destination); n.connect(f).connect(ng).connect(a.destination);
      o.start(t); o.stop(t + .15); n.start(t);
    },
    applause(sec = 2.2, vol = .35) {
      const a = audio(); if (!a || !soundOn) return; const t = a.currentTime;
      const n = a.createBufferSource(); n.buffer = noiseBuf(a, sec); const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = .6;
      const g = a.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .25); g.gain.setValueAtTime(vol, t + sec * .6); g.gain.linearRampToValueAtTime(0, t + sec);
      const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 13; lg.gain.value = vol * .6; lfo.connect(lg).connect(g.gain);
      n.connect(f).connect(g).connect(a.destination); n.start(t); lfo.start(t); lfo.stop(t + sec);
    },
    bells(vol = .18) {
      const a = audio(); if (!a || !soundOn) return; const t = a.currentTime;
      [1568, 2093, 2637, 2093, 3136, 2637].forEach((fr, i) => {
        const o = a.createOscillator(), g = a.createGain(); o.type = "triangle"; o.frequency.value = fr;
        const s = t + i * .09; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol, s + .01); g.gain.exponentialRampToValueAtTime(.001, s + .5);
        o.connect(g).connect(a.destination); o.start(s); o.stop(s + .55);
      });
    },
    ooh(vol = .16) { // Publikum: "Ooooh"
      const a = audio(); if (!a || !soundOn) return; const t = a.currentTime;
      [0, 4, 7, -5].forEach((st, i) => {
        const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain(); o.type = "sawtooth";
        o.frequency.setValueAtTime(220 * Math.pow(2, st / 12) * (1 + i * .003), t); o.frequency.linearRampToValueAtTime(180 * Math.pow(2, st / 12), t + 1.1);
        f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(400, t + 1.1);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .2); g.gain.linearRampToValueAtTime(0, t + 1.2);
        o.connect(f).connect(g).connect(a.destination); o.start(t); o.stop(t + 1.25);
      });
    },
    fanfare(vol = .2) {
      const a = audio(); if (!a || !soundOn) return; const t = a.currentTime;
      [523, 659, 784, 1047, 784, 1047].forEach((fr, i) => {
        const o = a.createOscillator(), g = a.createGain(); o.type = "square"; o.frequency.value = fr;
        const s = t + i * .14, len = i === 5 ? .7 : .13; g.gain.setValueAtTime(vol * .5, s); g.gain.exponentialRampToValueAtTime(.001, s + len);
        o.connect(g).connect(a.destination); o.start(s); o.stop(s + len + .02);
      });
    },
    thud() { const a = audio(); if (!a || !soundOn) return; const t = a.currentTime; const o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(60, t + .15); g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .18); o.connect(g).connect(a.destination); o.start(t); o.stop(t + .2); }
  };

  /* ---------- Effekte: Schnee, Bälle, Feuerwerk ---------- */
  const fx = $("fx"), ctx = fx.getContext("2d"); let parts = [], raf = null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function sizeFx() { fx.width = innerWidth * devicePixelRatio; fx.height = innerHeight * devicePixelRatio; }
  addEventListener("resize", sizeFx); sizeFx();
  function burst(kind = "snow", count = 70) {
    if (reduced) return;
    const W = fx.width, H = fx.height, d = devicePixelRatio;
    for (let i = 0; i < count; i++) {
      if (kind === "firework") {
        const cx = W * (.2 + Math.random() * .6), cy = H * (.2 + Math.random() * .3), col = ["#D6E04A", "#E3B23C", "#E2574C", "#FFFDF9", "#7DBE88"][i % 5];
        for (let k = 0; k < 26; k++) { const ang = k / 26 * Math.PI * 2, sp = (2 + Math.random() * 3) * d; parts.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 2.2 * d, c: col, life: 70, g: .05 * d, type: "dot" }); }
        if (i > 4) break;
      } else {
        const ball = kind === "balls" || (kind === "mix" && Math.random() < .35);
        parts.push({ x: Math.random() * W, y: -20 * d - Math.random() * H * .5, vx: (Math.random() - .5) * d, vy: (1 + Math.random() * 2.2) * d, r: (ball ? 7 : 2 + Math.random() * 3) * d, c: ball ? "#D6E04A" : "#FFFFFF", life: 400, g: ball ? .06 * d : 0, type: ball ? "ball" : "snow", w: Math.random() * 6 });
      }
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    ctx.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter(p => p.life > 0 && p.y < fx.height + 40);
    for (const p of parts) {
      p.life--; p.vy += p.g; p.x += p.vx + (p.type === "snow" ? Math.sin((p.life + p.w) / 20) * .6 : 0); p.y += p.vy;
      if (p.type === "dot") { p.vx *= .97; p.vy *= .97; }
      ctx.globalAlpha = p.type === "dot" ? Math.max(0, p.life / 70) : .95;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.c; ctx.fill();
      if (p.type === "ball") { ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = p.r * .18; ctx.beginPath(); ctx.arc(p.x - p.r * .9, p.y, p.r * .8, -1, 1); ctx.stroke(); }
      if (p.type === "snow") { ctx.shadowBlur = 0; }
    }
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(tick) : null;
  }

  /* ---------- Daten ---------- */
  async function load(l) {
    if (!cache[l]) { const r = await fetch("content/" + l + ".json", { cache: "no-cache" }); cache[l] = await r.json(); }
    C = cache[l]; lang = l; store.set("lang", l);
  }
  const entries = () => store.get("entries", {});
  const entry = n => entries()[n] || {};
  function saveEntry(n, key, val) { const all = entries(); all[n] = Object.assign({}, all[n], { [key]: val }); return store.set("entries", all); }
  const filled = n => Object.values(entry(n)).some(v => (v || "").trim());
  const preview = () => store.get("preview", false);
  function isOpen(n) { if (preview()) return true; return new Date() >= new Date(C.year, 11, n); }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- Rendering ---------- */
  function applyUi() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-ui]").forEach(el => { el.textContent = C.ui[el.dataset.ui]; });
    $("tabCal").textContent = C.ui.calendar; $("tabCab").textContent = C.ui.cabinet;
    $("soundBtn").innerHTML = soundOn
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>';
    $("soundBtn").setAttribute("aria-label", C.ui.sound + " " + (soundOn ? C.ui.on : C.ui.off)); $("soundBtn").setAttribute("aria-pressed", soundOn);
    document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.lang === lang));
    $("previewWrap").hidden = !preview(); $("preview").checked = preview();
    $("teaserLink").href = C.appUrl;
  }
  function renderGrid() {
    const grid = $("grid"); grid.innerHTML = "";
    const now = new Date(); let done = 0;
    for (const d of C.days) {
      const n = d.n, open = isOpen(n), isDone = filled(n); if (isDone) done++;
      const b = document.createElement("button"); b.type = "button";
      b.className = "door " + (open ? "open" : "locked") + (n === 25 ? " bonus" : "") + (isDone ? " done" : "") + (now.getMonth() === 11 && now.getDate() === n ? " today" : "");
      b.innerHTML = `<span class="n">${n}</span><span class="t">${open ? esc(d.title) : ""}</span><span class="d">${open ? "" : n + ". " + C.ui.dec}</span>`;
      b.setAttribute("aria-label", `${C.ui.door} ${n}` + (open ? `: ${d.title}` : ` – ${C.ui.opensOn} ${n}. ${C.ui.month}`));
      b.addEventListener("click", () => open ? openDoor(n) : lockedDoor(b, n));
      grid.appendChild(b);
    }
    $("basketCount").textContent = done + " / 25";
    $("balls").innerHTML = "<i></i>".repeat(done);
  }
  function lockedDoor(btn, n) { sfx.thud(); btn.classList.remove("shake"); void btn.offsetWidth; btn.classList.add("shake"); toast(C.ui.lockedToast.replace("{d}", n)); }
  let toastT; function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

  function block(p) { return typeof p === "string" ? `<p>${esc(p)}</p>` : `<h4>${esc(p.h)}</h4><ul>${p.li.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`; }
  function fieldHtml(key, label, ph, val, tool) {
    return `<div class="field${tool ? " tool" : ""}"><label for="f-${key}">${esc(label)}</label><textarea id="f-${key}" data-key="${key}" rows="3" placeholder="${esc(ph)}">${esc(val || "")}</textarea></div>`;
  }
  function fillCard(n) {
    const d = C.days[n - 1], e = entry(n);
    $("dNum").textContent = n; $("leafNum").textContent = n;
    $("dDate").textContent = n + ". " + C.ui.month + (n === 25 ? " · " + C.ui.bonus : "");
    $("dTitle").textContent = d.title; $("dUmpire").textContent = "„" + d.umpire + "“";
    if (lang === "en") $("dUmpire").textContent = "“" + d.umpire + "”";
    $("dText").innerHTML = d.text.map(block).join("");
    $("dQuote").textContent = d.quote;
    const v = d.voice; $("dVoice").hidden = !v;
    if (v) { $("dVoiceQ").textContent = "“" + v.quote + "”"; $("dVoiceTr").textContent = v.translation ? "„" + v.translation + "“" : ""; $("dVoiceTr").hidden = !v.translation; $("dVoiceWho").textContent = "— " + v.who + " · " + v.source; }
    $("dQ").textContent = d.question; $("dJournalHint").textContent = d.journal || ""; $("dJournalHint").hidden = !d.journal;
    let f = "";
    if (n === 16) C.ui.plan16.forEach((lab, i) => { f += fieldHtml("plan" + i, lab, C.ui.phAnswer, e["plan" + i], true); });
    else f += fieldHtml("answer", d.tool || C.ui.answer, C.ui.phAnswer, e.answer, !!d.tool);
    f += fieldHtml("experience", C.ui.experience, C.ui.phExperience, e.experience);
    f += fieldHtml("learning", C.ui.learning, C.ui.phLearning, e.learning);
    $("fields").innerHTML = f; $("dSaved").textContent = "";
    $("dPlace").textContent = d.place;
    $("dTeaser").hidden = !d.teaser;
    if (d.teaser) { $("dTeaserHead").textContent = d.teaser.title; $("dTeaserText").textContent = d.teaser.text; }
  }
  function openDoor(n) {
    current = n; fillCard(n);
    const stage = $("stage"), anim = $("doorAnim"), card = $("card");
    stage.hidden = false; stage.scrollTop = 0; document.body.style.overflow = "hidden";
    card.classList.remove("in"); anim.classList.remove("go"); anim.hidden = reduced; void anim.offsetWidth;
    if (!reduced) {
      anim.classList.add("go");
      sfx.pop(.38); sfx.pop(.6, .6); sfx.pop(.8, .4);
      setTimeout(() => { sfx.bells(); burst(n === 25 ? "balls" : "mix", 80); }, 750);
      setTimeout(() => { anim.hidden = true; card.classList.add("in"); }, 1150);
    } else card.classList.add("in");
    if (n === 24) setTimeout(() => { sfx.fanfare(); sfx.applause(3); burst("firework"); }, 1300);
    if (n === 25) setTimeout(() => { sfx.applause(2.5); burst("firework"); }, 1300);
    if (n === 4) setTimeout(() => sfx.ooh(), 1400);
    setTimeout(() => $("closeBtn").focus({ preventScroll: true }), 1200);
  }
  function closeDoor() { $("stage").hidden = true; document.body.style.overflow = ""; current = null; renderGrid(); }

  let saveT;
  $("fields").addEventListener("input", ev => {
    const ta = ev.target; if (!ta.dataset.key) return;
    const before = filled(current);
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const ok = saveEntry(current, ta.dataset.key, ta.value);
      $("dSaved").textContent = ok ? C.ui.saved : C.ui.noSave;
      if (ok && !before && filled(current)) { sfx.applause(1.6); burst("balls", 18); toast(C.ui.trophyNew); }
    }, 500);
  });

  function renderCabinet() {
    const tro = $("trophies"); tro.innerHTML = "";
    const cup = `<svg class="cup" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path fill="#E3B23C" d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3V3zm0 4H5v1a2 2 0 0 0 1.2 1.8A5 5 0 0 1 6 9V7zm12 0v2c0 .3 0 .5-.1.8A2 2 0 0 0 19 8V7h-1z"/></svg>`;
    for (const d of C.days) {
      if (!d.tool || d.n === 16) continue;
      const val = (entry(d.n).answer || "").trim();
      const div = document.createElement("div"); div.className = "trophy" + (val ? " won" : "");
      div.innerHTML = `${cup}<h4>${esc(d.tool)} · ${C.ui.door} ${d.n}</h4>` + (val ? `<p>${esc(val)}</p>` : `<span class="empty">${esc(C.ui.empty.replace("{d}", d.n))}</span>`);
      tro.appendChild(div);
    }
    const e16 = entry(16);
    $("tourday").innerHTML = C.ui.plan16.map((lab, i) => `<div><h4>${esc(lab)}</h4><p>${esc((e16["plan" + i] || "").trim() || "–")}</p></div>`).join("");
    const lis = C.days.filter(d => (entry(d.n).learning || "").trim()).map(d => `<li><b>${d.n}</b><div><p>${esc(entry(d.n).learning)}</p><small>${esc(d.title)}</small></div></li>`);
    $("learnings").innerHTML = lis.length ? lis.join("") : `<li><b>–</b><p class="note">${esc(C.ui.empty.replace("{d}", 1))}</p></li>`;
  }

  function showView(v) {
    $("viewCal").hidden = v !== "cal"; $("viewCab").hidden = v !== "cab";
    $("tabCal").setAttribute("aria-selected", v === "cal"); $("tabCab").setAttribute("aria-selected", v === "cab");
    if (v === "cab") renderCabinet(); else renderGrid();
    scrollTo({ top: 0 });
  }

  /* ---------- Events ---------- */
  $("closeBtn").addEventListener("click", closeDoor);
  $("stage").addEventListener("click", e => { if (e.target.id === "stage") closeDoor(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !$("stage").hidden) closeDoor(); });
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => { sfx.pop(0, .4); showView(b.dataset.view); }));
  $("soundBtn").addEventListener("click", () => { soundOn = !soundOn; store.set("sound", soundOn); applyUi(); if (soundOn) sfx.pop(); });
  document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", async () => { await load(b.dataset.lang); applyUi(); if (current) fillCard(current); showView($("viewCab").hidden ? "cal" : "cab"); }));
  $("preview").addEventListener("change", e => { store.set("preview", e.target.checked); renderGrid(); });
  $("pdfBtn").addEventListener("click", () => { renderCabinet(); print(); });

  // Installieren
  let deferred = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
  $("installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("installBtn").hidden = true; });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  /* ---------- Start ---------- */
  (async () => {
    await load(lang); applyUi(); showView("cal");
    $("iosHint").hidden = !ios;
    if (!reduced && !store.get("welcomed", false)) { setTimeout(() => burst("snow", 90), 400); store.set("welcomed", true); }
    else if (!reduced) setTimeout(() => burst("snow", 40), 400);
  })();
})();
