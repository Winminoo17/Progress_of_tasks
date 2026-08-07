(() => {
  "use strict";

  const PASS_LINE = 60;

  /* ---------- Storage layer ---------- */
  /* Real JSON file on disk, served by server.js at ./stored.json.
     Shape: { startDate, currentDate, tasks: [...], history: { "YYYY-MM-DD": percentage } } */

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function blankState() {
    return { startDate: todayStr(), currentDate: todayStr(), tasks: [], history: {} };
  }

  async function fetchState() {
    try {
      const res = await fetch("/api/data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      if (!parsed.startDate) parsed.startDate = todayStr();
      if (!parsed.currentDate) parsed.currentDate = todayStr();
      if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
      if (typeof parsed.history !== "object" || parsed.history === null) parsed.history = {};
      return parsed;
    } catch (e) {
      console.error("Could not load stored.json from server, starting fresh:", e);
      return blankState();
    }
  }

  let saveInFlight = null;
  function saveState() {
    // Fire-and-forget write to disk; chained so writes don't race each other.
    const payload = JSON.stringify(state);
    saveInFlight = (saveInFlight || Promise.resolve())
      .then(() =>
        fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        })
      )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((e) => console.error("Failed to save ledger data to stored.json:", e));
  }

  let state = blankState();

  /* ---------- Daily reset ---------- */
  function rolloverIfNewDay() {
    const now = todayStr();
    if (state.currentDate === now) return;

    // Archive yesterday's result before wiping the task list.
    const pct = computePercent(state.tasks);
    if (state.tasks.length > 0) {
      state.history[state.currentDate] = pct;
    }
    state.currentDate = now;
    state.tasks = [];
    saveState();
  }

  /* ---------- Percent helpers ---------- */
  function computePercent(tasks) {
    if (!tasks.length) return 0;
    const done = tasks.filter((t) => t.done).length;
    return Math.round((done / tasks.length) * 100);
  }

  function overallPercent() {
    const values = Object.values(state.history);
    const todayPct = computePercent(state.tasks);
    if (state.tasks.length > 0) values.push(todayPct);
    if (!values.length) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  /* ---------- DOM refs ---------- */
  const el = {
    todayLabel: document.getElementById("today-label"),
    startDateLabel: document.getElementById("start-date-label"),
    openAdd: document.getElementById("open-add-task"),
    addForm: document.getElementById("add-form"),
    nameInput: document.getElementById("task-name-input"),
    minutesInput: document.getElementById("task-minutes-input"),
    cancelAdd: document.getElementById("cancel-add-task"),
    confirmAdd: document.getElementById("confirm-add-task"),
    taskList: document.getElementById("task-list"),
    taskCount: document.getElementById("task-count"),
    emptyState: document.getElementById("empty-state"),
    ringFill: document.getElementById("ring-fill"),
    ringNumber: document.getElementById("ring-number"),
    statFinished: document.getElementById("stat-finished"),
    statRemaining: document.getElementById("stat-remaining"),
    statCount: document.getElementById("stat-count"),
    rangeToggle: document.getElementById("range-toggle"),
    trendSvg: document.getElementById("trend-svg"),
    footerToday: document.getElementById("footer-today"),
    footerOverall: document.getElementById("footer-overall"),
    footerSince: document.getElementById("footer-since"),
    clearData: document.getElementById("clear-data"),
    spine: document.getElementById("spine"),
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
  let currentRange = "day";

  /* ---------- Icons ---------- */
  const ICONS = {
    check: `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    edit: `<svg viewBox="0 0 20 20" fill="none"><path d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    trash: `<svg viewBox="0 0 20 20" fill="none"><path d="M4 6H16M8 6V4.5C8 4 8.4 3.5 9 3.5H11C11.6 3.5 12 4 12 4.5V6M6 6L6.6 15.5C6.6 16 7 16.5 7.6 16.5H12.4C13 16.5 13.4 16 13.4 15.5L14 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  /* ---------- Rendering: header ---------- */
  function renderHeader() {
    const d = new Date(state.currentDate + "T00:00:00");
    el.todayLabel.textContent = d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const start = new Date(state.startDate + "T00:00:00");
    el.startDateLabel.textContent = `Tracking since ${start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
    el.footerSince.textContent = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  /* ---------- Rendering: spine ticks (signature element) ---------- */
  function renderSpine() {
    el.spine.innerHTML = "";
    const days = ["S", "M", "T", "W", "T", "F", "S"];
    const todayIdx = new Date(state.currentDate + "T00:00:00").getDay();
    days.forEach((label, i) => {
      const span = document.createElement("span");
      span.className = "tick" + (i === todayIdx ? " active" : "");
      span.textContent = label;
      el.spine.appendChild(span);
    });
  }

  /* ---------- Rendering: task list ---------- */
  function renderTasks() {
    el.taskList.innerHTML = "";
    el.taskCount.textContent = String(state.tasks.length);
    el.emptyState.hidden = state.tasks.length > 0;

    state.tasks.forEach((task) => {
      const row = document.createElement("div");
      row.className = "task-row" + (task.done ? " done" : "");
      row.dataset.id = task.id;

      row.innerHTML = `
        <button class="check ${task.done ? "checked" : ""}" data-action="toggle" aria-label="Mark done">
          ${task.done ? ICONS.check : ""}
        </button>
        <span class="task-name">${escapeHtml(task.name)}</span>
        <span class="task-time">${formatMinutes(task.minutes)}</span>
        <button class="icon-btn" data-action="edit" aria-label="Edit task">${ICONS.edit}</button>
        <button class="icon-btn danger" data-action="delete" aria-label="Delete task">${ICONS.trash}</button>
      `;
      el.taskList.appendChild(row);
    });
  }

  function formatMinutes(mins) {
    mins = Number(mins) || 0;
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------- Rendering: progress widget ---------- */
  function renderProgress() {
    const pct = computePercent(state.tasks);
    const done = state.tasks.filter((t) => t.done).length;

    const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
    el.ringFill.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    el.ringFill.style.strokeDashoffset = String(offset);
    el.ringFill.style.stroke = pct >= PASS_LINE ? "var(--good)" : "var(--bad)";

    el.ringNumber.textContent = String(pct);
    el.statFinished.textContent = `${pct}%`;
    el.statRemaining.textContent = `${100 - pct}%`;
    el.statCount.textContent = `${done} / ${state.tasks.length}`;

    el.footerToday.textContent = `${pct}%`;
    el.footerToday.style.color = pct >= PASS_LINE ? "var(--good)" : "var(--bad)";

    const overall = overallPercent();
    el.footerOverall.textContent = `${overall}%`;
    el.footerOverall.style.color = overall >= PASS_LINE ? "var(--good)" : "var(--bad)";
  }

  /* ---------- Rendering: trend graph ---------- */
  function buildSeries(range) {
    // history + today's live value
    const entries = Object.entries(state.history);
    if (state.tasks.length > 0) {
      entries.push([state.currentDate, computePercent(state.tasks)]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));

    if (range === "day") {
      return entries.slice(-14).map(([date, pct]) => ({ label: shortDate(date), pct }));
    }

    if (range === "week") {
      return bucketEntries(entries, weekKey).slice(-10);
    }

    // month
    return bucketEntries(entries, monthKey).slice(-9);
  }

  function shortDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function weekKey(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  }

  function monthKey(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }

  function bucketEntries(entries, keyFn) {
    const buckets = new Map();
    entries.forEach(([date, pct]) => {
      const key = keyFn(date);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(pct);
    });
    return Array.from(buckets.entries()).map(([label, values]) => ({
      label,
      pct: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    }));
  }

  function renderGraph() {
    const series = buildSeries(currentRange);
    const W = 640, H = 220;
    const padL = 34, padR = 16, padT = 16, padB = 30;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    el.trendSvg.innerHTML = "";
    el.trendSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const yFor = (pct) => padT + innerH - (pct / 100) * innerH;
    const xFor = (i, n) => (n <= 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);

    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");

    // gridlines at 0/25/50/60/75/100
    [0, 25, 50, 75, 100].forEach((v) => {
      const y = yFor(v);
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", padL);
      line.setAttribute("x2", W - padR);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "var(--line)");
      line.setAttribute("stroke-width", "1");
      g.appendChild(line);

      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", padL - 8);
      label.setAttribute("y", y + 3);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("font-size", "9");
      label.setAttribute("font-family", "JetBrains Mono, monospace");
      label.setAttribute("fill", "var(--text-faint)");
      label.textContent = v;
      g.appendChild(label);
    });

    // pass line (dashed) at 60
    const passY = yFor(PASS_LINE);
    const passLine = document.createElementNS(ns, "line");
    passLine.setAttribute("x1", padL);
    passLine.setAttribute("x2", W - padR);
    passLine.setAttribute("y1", passY);
    passLine.setAttribute("y2", passY);
    passLine.setAttribute("stroke", "var(--amber)");
    passLine.setAttribute("stroke-width", "1.2");
    passLine.setAttribute("stroke-dasharray", "5,4");
    passLine.setAttribute("opacity", "0.6");
    g.appendChild(passLine);

    el.trendSvg.appendChild(g);

    if (!series.length) {
      const empty = document.createElementNS(ns, "text");
      empty.setAttribute("x", W / 2);
      empty.setAttribute("y", H / 2);
      empty.setAttribute("text-anchor", "middle");
      empty.setAttribute("font-size", "12");
      empty.setAttribute("font-family", "Inter, sans-serif");
      empty.setAttribute("fill", "var(--text-faint)");
      empty.textContent = "No data yet — finish a day to start the trend.";
      el.trendSvg.appendChild(empty);
      return;
    }

    // connecting line
    const points = series.map((s, i) => [xFor(i, series.length), yFor(s.pct)]);
    const path = document.createElementNS(ns, "path");
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "var(--text-faint)");
    path.setAttribute("stroke-width", "1.5");
    el.trendSvg.appendChild(path);

    // points + x labels
    series.forEach((s, i) => {
      const [x, y] = points[i];
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", x);
      circle.setAttribute("cy", y);
      circle.setAttribute("r", "4.5");
      circle.setAttribute("fill", s.pct >= PASS_LINE ? "var(--good)" : "var(--bad)");
      circle.setAttribute("stroke", "var(--bg)");
      circle.setAttribute("stroke-width", "1.5");
      el.trendSvg.appendChild(circle);

      if (series.length <= 16 || i % Math.ceil(series.length / 8) === 0) {
        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", x);
        label.setAttribute("y", H - 10);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "9");
        label.setAttribute("font-family", "JetBrains Mono, monospace");
        label.setAttribute("fill", "var(--text-faint)");
        label.textContent = s.label;
        el.trendSvg.appendChild(label);
      }
    });
  }

  /* ---------- Full render ---------- */
  function renderAll() {
    renderHeader();
    renderSpine();
    renderTasks();
    renderProgress();
    renderGraph();
  }

  /* ---------- Event handlers ---------- */
  el.openAdd.addEventListener("click", () => {
    el.addForm.hidden = false;
    el.nameInput.focus();
  });

  el.cancelAdd.addEventListener("click", closeAddForm);

  function closeAddForm() {
    el.addForm.hidden = true;
    el.nameInput.value = "";
    el.minutesInput.value = "";
    el.confirmAdd.textContent = "Add to ledger";
    delete el.confirmAdd.dataset.editId;
  }

  el.confirmAdd.addEventListener("click", () => {
    const name = el.nameInput.value.trim();
    const minutes = Math.max(1, Math.min(999, Number(el.minutesInput.value) || 0));
    if (!name) {
      el.nameInput.focus();
      return;
    }

    const editId = el.confirmAdd.dataset.editId;
    if (editId) {
      const task = state.tasks.find((t) => t.id === editId);
      if (task) {
        task.name = name;
        if (minutes) task.minutes = minutes;
      }
    } else {
      state.tasks.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        name,
        minutes: minutes || 15,
        done: false,
      });
    }

    saveState();
    closeAddForm();
    renderAll();
  });

  el.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.confirmAdd.click();
  });
  el.minutesInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.confirmAdd.click();
  });

  el.taskList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = e.target.closest(".task-row");
    const id = row.dataset.id;
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const action = btn.dataset.action;
    if (action === "toggle") {
      task.done = !task.done;
      saveState();
      renderTasks();
      renderProgress();
      renderGraph();
    } else if (action === "delete") {
      state.tasks = state.tasks.filter((t) => t.id !== id);
      saveState();
      renderAll();
    } else if (action === "edit") {
      el.addForm.hidden = false;
      el.nameInput.value = task.name;
      el.minutesInput.value = task.minutes;
      el.confirmAdd.textContent = "Save changes";
      el.confirmAdd.dataset.editId = id;
      el.nameInput.focus();
    }
  });

  el.rangeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    currentRange = btn.dataset.range;
    [...el.rangeToggle.children].forEach((b) => b.classList.toggle("active", b === btn));
    renderGraph();
  });

  el.clearData.addEventListener("click", () => {
    if (!confirm("This clears all tasks and history in stored.json. Continue?")) return;
    state = blankState();
    saveState();
    renderAll();
  });

  window.addEventListener("resize", () => {
    // SVG uses viewBox scaling, so no redraw needed on resize.
  });

  /* ---------- Init ---------- */
  async function init() {
    state = await fetchState();
    rolloverIfNewDay();
    renderAll();
  }
  init();

  // Check for day rollover periodically in case the tab is left open past midnight.
  setInterval(() => {
    rolloverIfNewDay();
    renderAll();
  }, 60 * 1000);
})();
