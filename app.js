/* ============================================================
   My research space — a draggable whiteboard of sticky notes
   ============================================================ */

"use strict";

const STORAGE_KEY = "research-wall-v1";
const TAGS_KEY = "research-wall-tags-v1";
const THEME_KEY = "research-wall-theme";
const SYNC_CODE_KEY = "research-wall-sync-code";
const SYNC_UPDATED_KEY = "research-wall-sync-updatedAt";
const TRASH_DAYS = 30; // keep trashed notes at least this many days
const DAY_MS = 86400000;

const DEFAULT_TAGS = [
  { id: "research", label: "research", color: "#dad2c1" },
  { id: "dissertation", label: "dissertation", color: "#e0a990" },
  { id: "projects", label: "projects", color: "#c2d4b5" },
  { id: "ideas", label: "ideas", color: "#f5e6a3" },
  { id: "blogs", label: "blogs", color: "#b8cde5" },
  { id: "reading", label: "reading", color: "#d1c4e0" },
];

// palette new tags cycle through as you create them
const TAG_PALETTE = [
  "#dad2c1", "#e0a990", "#c2d4b5", "#f5e6a3", "#b8cde5", "#d1c4e0",
  "#e8c9d5", "#bfe0d4", "#e6d9b8", "#c9c3e0", "#f0c6a8", "#c8d6c4",
];

const PROGRESS = [
  { id: "todo", label: "to-do", color: "#8a7d6a" },
  { id: "doing", label: "in progress", color: "#c08a2d" },
  { id: "done", label: "done", color: "#5d8f52" },
];

const PAPER_COLORS = [
  { id: "cream", label: "cream", color: "#ece0c8" },
  { id: "yellow", label: "yellow", color: "#f5e6a3" },
  { id: "peach", label: "peach", color: "#e5ac90" },
  { id: "green", label: "green", color: "#c6d6b6" },
  { id: "blue", label: "blue", color: "#b8cde5" },
  { id: "purple", label: "purple", color: "#d1c4e0" },
];

const PAPER_STYLES = [
  { id: "blank", label: "Blank" },
  { id: "grid", label: "Grid" },
  { id: "lined", label: "Lined" },
];

const NOTE_MAX_CHARS = { normal: 150, large: 300 };
const MAX_TAGS = 2;

// matrix quadrants (declared early: loadNotes() migration below reads it)
const MATRIX_QUADS = ["qw", "it", "ot", "ut"];

// board layout constants (used for initial placement + "arrange" sorts)
const BOARD_PAD = 20;
const GAP = 20;
const NOTE_W = 232;
const NOTE_H = 250;
const NOTE_W_LARGE = 484; // 2 * NOTE_W + GAP
const NOTE_H_LARGE = 520; // 2 * NOTE_H + GAP

const SEED_NOTES = [
  { text: "define the research question in one sentence before touching the data.", tags: ["research"], progress: "done", source: "", views: 24, date: 15 },
  { text: "send your advisor a draft two weeks before you think it's ready.", tags: ["dissertation"], progress: "doing", source: "", views: 31, date: 14 },
  { text: "break the project into a 3-step pipeline you can run end to end.", tags: ["projects"], progress: "todo", source: "", views: 19, date: 13 },
  { text: "a monthly note of open research problems worth stealing.", tags: ["ideas"], progress: "todo", source: "", views: 27, date: 12 },
  { text: "write about the paper you just read, not the one you plan to write.", tags: ["blogs"], progress: "doing", source: "", views: 18, date: 11 },
  { text: "read the discussion section first — that's where the real argument lives.", tags: ["reading"], progress: "done", source: "", views: 22, date: 10 },
  { text: "keep a running file of rejected hypotheses so you don't re-test them.", tags: ["research"], progress: "doing", source: "", views: 26, date: 9 },
  { text: "map every dissertation chapter to the one paper it will become.", tags: ["dissertation"], progress: "todo", source: "", views: 14, date: 8 },
  { text: "name your project after the outcome, not the tool you're building.", tags: ["projects"], progress: "doing", source: "", views: 12, date: 7 },
  { text: "write the abstract first, then grow the paper around it.", tags: ["blogs"], progress: "todo", source: "", views: 21, date: 6 },
  { text: "if a paper is paywalled, email the author — they always send it.", tags: ["reading"], progress: "done", source: "", views: 35, date: 5 },
  { text: "turn every dead end into a footnote about what you ruled out.", tags: ["research"], progress: "todo", source: "", views: 16, date: 4 },
];

const NOTE_PROMPTS = [
  "a question worth chasing...",
  "a gap you noticed in the literature...",
  "an idea to try before you forget...",
  "a to-do for the dissertation...",
];

/* ---------- state ---------- */

let syncCode = "";
let syncState = "setup"; // setup | checking | syncing | synced | offline
let syncPushTimer = null;
let syncInFlight = false;

let sortMode = "custom";
let tags = loadTags();
let notes = loadNotes();
let activeTag = "all";          // tag id or "all"
let progressFilter = "all";     // "all" | "todo" | "doing" | "done"
let searchQuery = "";
let selectedTags = [];          // tag ids chosen in the modal
let selectedProgress = "todo";
let selectedColor = "cream";
let selectedStyle = "blank";


let openNoteId = null;
let editingNoteId = null;
let viewMode = "wall"; // "wall" | "trash"

/* ---------- elements ---------- */

const $ = (sel) => document.querySelector(sel);

const wallEl = $("#wall");
const addModal = $("#add-modal");
const notePopup = $("#note-popup");
const noteInput = $("#note-input");
const sourceInput = $("#source-input");
const charCount = $("#char-count");

/* ---------- helpers ---------- */

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function findNote(id) {
  return notes.find((n) => n.id === id) || null;
}

function isTrashed(note) {
  return !!note.trashedAt;
}

function daysLeft(note) {
  if (!note.trashedAt) return TRASH_DAYS;
  const remain = Math.ceil(TRASH_DAYS - (Date.now() - note.trashedAt) / DAY_MS);
  return Math.max(0, remain);
}

function tagById(id) {
  return tags.find((t) => t.id === id) || null;
}

function noteTags(note) {
  return (note.tags || []).map(tagById).filter(Boolean);
}

function setPaper(el, colorId, styleId) {
  const c = PAPER_COLORS.find((c) => c.id === colorId);
  const hex = c ? c.color : colorId; // accept a paper id or a raw hex (tag colors)
  const style = PAPER_STYLES.some((s) => s.id === styleId) ? styleId : "blank";
  el.style.setProperty("--paper", hex);
  el.classList.remove("paper-blank", "paper-grid", "paper-lined");
  el.classList.add("paper-" + style);
}

// paper background for a note: its own paper color, or its single tag's color when
// it has exactly one tag (so a one-tag note reads as "belonging" to that tag)
function paperColorFor(note) {
  const t = noteTags(note);
  if (t.length === 1) return t[0].color;
  return (PAPER_COLORS.find((c) => c.id === note.color) || PAPER_COLORS[0]).color;
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function nearestPaperId(hex) {
  const rgb = hexToRgb(hex);
  let best = PAPER_COLORS[0].id;
  let bestDist = Infinity;
  PAPER_COLORS.forEach((c) => {
    const cr = hexToRgb(c.color);
    const d = (rgb[0] - cr[0]) ** 2 + (rgb[1] - cr[1]) ** 2 + (rgb[2] - cr[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c.id;
    }
  });
  return best;
}

function progressById(id) {
  return PROGRESS.find((p) => p.id === id) || PROGRESS[0];
}

function isLarge(note) {
  return !!note && note.size === "large";
}

function noteWidth(note) {
  return isLarge(note) ? NOTE_W_LARGE : NOTE_W;
}

function matrixQuadrant(note) {
  return MATRIX_QUADS.includes(note.matrixQuadrant) ? note.matrixQuadrant : "ot";
}

let toastTimer = null;

function showToast(msg) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

function pointInRect(x, y, r) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/* ---------- board layout ---------- */

function sortList(list) {
  if (sortMode === "newest") {
    list.sort((a, b) => (b.date || 0) - (a.date || 0));
  } else if (sortMode === "used") {
    list.sort((a, b) => (b.views || 0) - (a.views || 0));
  } else if (sortMode === "az") {
    list.sort((a, b) => a.text.localeCompare(b.text));
  }
  // "custom", "clean", "bytag", and "random" keep the current order — positions are what matter
  return list;
}

// arrange notes into tag blocks: notes sharing a tag stay together in one block
function layoutByTag(list) {
  const board = document.querySelector("#wall");
  const maxRight = Math.max(760, (board ? board.clientWidth : window.innerWidth)) - BOARD_PAD;
  const cols = Math.max(2, Math.floor((maxRight - BOARD_PAD + GAP) / (NOTE_W + GAP)));
  const occupied = {};
  const place = (row, col, w, h) => {
    for (let r = row; r < row + h; r++) {
      if (!occupied[r]) occupied[r] = {};
      for (let c = col; c < col + w; c++) occupied[r][c] = true;
    }
  };
  const canPlace = (row, col, w, h) => {
    for (let r = row; r < row + h; r++) {
      if (occupied[r]) {
        for (let c = col; c < col + w; c++) if (occupied[r][c]) return false;
      }
    }
    return true;
  };
  const blockRow = (row) => {
    if (!occupied[row]) occupied[row] = {};
    for (let c = 0; c < cols; c++) occupied[row][c] = true;
  };

  // groups in tag-tab order; untagged notes last
  const order = tags.map((t) => t.id);
  const groups = Array.from({ length: order.length + 1 }, () => []);
  list.forEach((n) => {
    // find the first of this note's tags that exists in the tag order, then use its
    // position IN the order as the group index (not its index within n.tags)
    let gi = order.length;
    for (const id of n.tags || []) {
      const idx = order.indexOf(id);
      if (idx >= 0) {
        gi = idx;
        break;
      }
    }
    groups[gi].push(n);
  });

  let startRow = 0;
  groups.forEach((grp) => {
    if (!grp.length) return;
    if (startRow > 0) {
      blockRow(startRow); // blank row between tag blocks
      startRow += 1;
    }
    let lastRow = startRow;
    grp.sort((a, b) => (b.date || 0) - (a.date || 0));
    grp.forEach((n) => {
      const w = isLarge(n) ? 2 : 1;
      const h = isLarge(n) ? 2 : 1;
      outer: for (let row = startRow; row < 2000; row++) {
        for (let col = 0; col + w <= cols; col++) {
          if (canPlace(row, col, w, h)) {
            n.x = BOARD_PAD + col * (NOTE_W + GAP);
            n.y = BOARD_PAD + row * (NOTE_H + GAP);
            place(row, col, w, h);
            lastRow = Math.max(lastRow, row + h - 1);
            break outer;
          }
        }
      }
    });
    startRow = lastRow + 1;
  });
}

// snap notes into a solid block: every cell filled, large notes take an exact 2x2 slot
function layoutNotes(list) {
  const board = document.querySelector("#wall");
  const maxRight = Math.max(760, (board ? board.clientWidth : window.innerWidth)) - BOARD_PAD;
  const cols = Math.max(2, Math.floor((maxRight - BOARD_PAD + GAP) / (NOTE_W + GAP)));
  const occupied = {};
  const place = (row, col, w, h) => {
    for (let r = row; r < row + h; r++) {
      if (!occupied[r]) occupied[r] = {};
      for (let c = col; c < col + w; c++) occupied[r][c] = true;
    }
  };
  const canPlace = (row, col, w, h) => {
    for (let r = row; r < row + h; r++) {
      if (occupied[r]) {
        for (let c = col; c < col + w; c++) {
          if (occupied[r][c]) return false;
        }
      }
    }
    return true;
  };

  list.forEach((n) => {
    const w = isLarge(n) ? 2 : 1;
    const h = isLarge(n) ? 2 : 1;
    for (let row = 0; row < 500; row++) {
      for (let col = 0; col + w <= cols; col++) {
        if (canPlace(row, col, w, h)) {
          n.x = BOARD_PAD + col * (NOTE_W + GAP);
          n.y = BOARD_PAD + row * (NOTE_H + GAP);
          place(row, col, w, h);
          return;
        }
      }
    }
  });
}

// scatter notes into a casual, non-grid arrangement
function scatterNotes(list) {
  const board = document.querySelector("#wall");
  const boardW = Math.max(700, (board ? board.clientWidth : window.innerWidth) - 16);
  const highest = list.length ? Math.max(...list.map((n) => n.y || 0)) : 0;
  const height = Math.max(900, highest + 760);
  list.forEach((n) => {
    const h = isLarge(n) ? NOTE_H_LARGE : NOTE_H;
    n.x = Math.round(16 + Math.random() * Math.max(0, boardW - noteWidth(n) - 16));
    n.y = Math.round(16 + Math.random() * Math.max(0, height - h - 16));
  });
}

// put notes back where I last dragged them (the "custom" layout)
function restoreCustom(list) {
  list.forEach((n) => {
    if (typeof n.cx === "number") {
      n.x = n.cx;
      n.y = n.cy;
    }
  });
}

// render notes inside the Eisenhower / Action Priority matrix
// each quadrant is an open graph area; notes float freely inside it
function layoutMatrix(list) {
  const grid = document.getElementById("matrix-view");
  if (!grid) return;

  let needsSave = false;

  MATRIX_QUADS.forEach((q) => {
    const cell = document.getElementById("mq-" + q);
    if (!cell) return;
    const notesWrap = cell.querySelector(".mq-notes");
    notesWrap.innerHTML = "";

    list.filter((n) => matrixQuadrant(n) === q).forEach((note, i) => {
      const card = document.createElement("div");
      card.className = "matrix-note";
      if (note.size === "large") card.classList.add("size-large");
      card.setAttribute("data-note-id", note.id);
      setPaper(card, paperColorFor(note), note.style);

      // tags
      const tagsRow = document.createElement("div");
      tagsRow.className = "note-tags";
      noteTags(note).forEach((t) => tagsRow.appendChild(makeTagChip(t)));

      // text
      const txt = document.createElement("p");
      txt.className = "note-text";
      txt.textContent = note.text;

      // progress badge
      const badge = makeProgressBadge(note.progress);

      card.append(tagsRow, txt, badge);
      notesWrap.appendChild(card);

      // first time: scatter it in the quadrant (stable two-column flow)
      if (typeof note.mqX !== "number" || typeof note.mqY !== "number") {
        const col = i % 2;
        const row = Math.floor(i / 2);
        note.mqX = 4 + col * 46 + ((i * 7) % 5);
        note.mqY = 5 + row * 27 + ((i * 11) % 6);
        needsSave = true;
      }

      // place relative to the room the note can actually use
      const cw = notesWrap.clientWidth || cell.clientWidth;
      const ch = notesWrap.clientHeight || cell.clientHeight;
      const nw = card.offsetWidth;
      const nh = card.offsetHeight;
      const maxX = Math.max(0, cw - nw);
      const maxY = Math.max(0, ch - nh);
      card.style.left = Math.round((note.mqX / 100) * maxX) + "px";
      card.style.top = Math.round((note.mqY / 100) * maxY) + "px";

      // drag freely inside the quadrant, drop into another to move it
      enableMatrixDrag(card, note);
    });
  });

  if (needsSave) saveNotes();
}

function enableMatrixDrag(el, note) {
  let startX = 0, startY = 0, moved = false, dragging = false;
  let startLeft = 0, startTop = 0;
  let startCell = null, hoverCell = null;

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    startCell = el.closest(".matrix-cell");
    const crect = startCell ? startCell.getBoundingClientRect() : null;
    const er = el.getBoundingClientRect();
    startLeft = crect ? er.left - crect.left : 0;
    startTop = crect ? er.top - crect.top : 0;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add("dragging");
    document.body.classList.add("is-dragging");
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (!moved) return;

    document.querySelectorAll(".matrix-cell").forEach((c) => c.classList.remove("mq-drop-active"));
    const cell = cellAtPoint(e.clientX, e.clientY);
    if (cell) {
      cell.classList.add("mq-drop-active");
      hoverCell = cell;
      // move the note into the hovered quadrant so it floats over it
      if (cell !== startCell) cell.querySelector(".mq-notes").appendChild(el);
    }

    const target = cell || startCell;
    if (!target) return;
    const crect = target.getBoundingClientRect();
    const nx = clamp(e.clientX - crect.left - el.offsetWidth / 2, 4, Math.max(4, crect.width - el.offsetWidth - 4));
    const ny = clamp(e.clientY - crect.top - 12, 4, Math.max(4, crect.height - el.offsetHeight - 4));
    el.style.left = nx + "px";
    el.style.top = ny + "px";
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    document.body.classList.remove("is-dragging");
    try { el.releasePointerCapture(e.pointerId); } catch {}
    document.querySelectorAll(".matrix-cell").forEach((c) => c.classList.remove("mq-drop-active"));

    // a plain click opens the note
    if (!moved) {
      openNote(note.id);
      hoverCell = null;
      return;
    }

    const cell = hoverCell || startCell;
    if (cell) {
      const crect = cell.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const maxX = Math.max(0, crect.width - er.width);
      const maxY = Math.max(0, crect.height - er.height);
      note.mqX = maxX > 0 ? Math.round(((er.left - crect.left) / maxX) * 100) : 0;
      note.mqY = maxY > 0 ? Math.round(((er.top - crect.top) / maxY) * 100) : 0;

      if (hoverCell && hoverCell !== startCell) {
        const newQ = hoverCell.dataset.quadrant;
        if (newQ && newQ !== matrixQuadrant(note)) {
          note.matrixQuadrant = newQ;
          note.touchedAt = Date.now();
          showToast("moved to " + QUAD_LABELS[newQ]);
        }
      }
      saveNotes();
    }
    hoverCell = null;
  };

  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("dragstart", (e) => e.preventDefault());
}

const QUAD_LABELS = {
  qw: "Quick Wins",
  it: "Important Tasks",
  ot: "Other Tasks",
  ut: "Ungrateful Tasks",
};

function cellAtPoint(x, y) {
  for (const c of document.querySelectorAll(".matrix-cell")) {
    const r = c.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
  }
  return null;
}

function defaultNotePosition(size) {
  const seq = notes.filter((n) => !isTrashed(n)).length;
  const jitter = (seq % 5) * 14;
  const w = size === "large" ? NOTE_W_LARGE : NOTE_W;
  const maxX = Math.max(0, (wallEl ? wallEl.clientWidth : window.innerWidth) - w);
  return {
    x: clamp(Math.round(window.innerWidth / 2 - w / 2 + jitter), 0, maxX),
    y: Math.round(window.scrollY + 150 + jitter),
  };
}

function updateBoardSize() {
  let h = 900;
  notes.forEach((n) => {
    if (typeof n.y === "number") h = Math.max(h, n.y + (isLarge(n) ? NOTE_H_LARGE : NOTE_H) + 60);
  });
  wallEl.style.minHeight = h + "px";
}

/* ---------- persistence + purge ---------- */

function loadTags() {
  let list;
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    list = raw ? JSON.parse(raw) : null;
  } catch {
    list = null;
  }
  if (!Array.isArray(list) || list.length === 0) list = DEFAULT_TAGS.map((t) => ({ ...t }));
  list.forEach((t) => {
    if (!t.id) t.id = makeId();
    if (!t.color) t.color = "";
  });
  // give every tag its own color: fill missing ones, and break ties so no two tags share a color
  const used = new Set();
  list.forEach((t) => {
    if (used.has(t.color)) t.color = ""; // duplicate -> needs a fresh color
    if (!t.color) {
      const free = TAG_PALETTE.find((c) => !used.has(c));
      t.color = free || TAG_PALETTE[Math.floor(Math.random() * TAG_PALETTE.length)];
    }
    used.add(t.color);
  });
  return list;
}

// pick a palette color no current tag is using (falls back to cycling once all are taken)
function nextTagColor() {
  const used = new Set(tags.map((t) => t.color));
  return TAG_PALETTE.find((c) => !used.has(c)) || TAG_PALETTE[tags.length % TAG_PALETTE.length];
}

function saveTags() {
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {
    /* ignore */
  }
  scheduleSync();
}

function ensureTagByLabel(label) {
  const existing = tags.find((t) => t.label.toLowerCase() === label.toLowerCase());
  if (existing) return existing;
  const tag = { id: makeId(), label, color: nextTagColor() };
  tags.push(tag);
  saveTags();
  return tag;
}

function loadNotes() {
  let list;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    list = raw ? JSON.parse(raw) : null;
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) list = SEED_NOTES.map((n) => ({ ...n }));

  // migrate older saved notes (category -> tags, drop tape, add progress/paper)
  list.forEach((n) => {
    if (!n.id) n.id = makeId();
    if (!Array.isArray(n.tags) || n.tags.length === 0) {
      const label = n.category || "";
      const tag = label ? ensureTagByLabel(label) : null;
      n.tags = tag ? [tag.id] : [];
    }
    delete n.category;
    delete n.tape;
    if (!PROGRESS.some((p) => p.id === n.progress)) n.progress = "todo";
    if (!PAPER_COLORS.some((c) => c.id === n.color)) {
      const oldColor = (noteTags(n)[0] || {}).color || "";
      n.color = oldColor ? nearestPaperId(oldColor) : "cream";
    }
    if (!PAPER_STYLES.some((s) => s.id === n.style)) n.style = "blank";
    if (!MATRIX_QUADS.includes(n.matrixQuadrant)) n.matrixQuadrant = "ot";
    

    if (typeof n.views !== "number") n.views = n.likes || 0;
    delete n.likes;
    delete n.likedByMe;
  });

  // purge anything trashed longer than the grace period
  const cutoff = Date.now() - TRASH_DAYS * DAY_MS;
  list = list.filter((n) => !n.trashedAt || n.trashedAt >= cutoff);

  // first time on the board: scatter casually
  if (list.some((n) => typeof n.x !== "number" || typeof n.y !== "number")) {
    scatterNotes(list);
  }

  // remember each note's hand-arranged position, then restore it on load
  list.forEach((n) => {
    if (typeof n.cx !== "number") n.cx = n.x;
    if (typeof n.cy !== "number") n.cy = n.y;
    n.x = n.cx;
    n.y = n.cy;
  });

  return list;
}

function saveNotes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* ignore */
  }
  scheduleSync();
}

/* ---------- cross-device sync (Firebase Realtime DB REST) ---------- */

function syncConfigured() {
  const cfg = window.SYNC_CONFIG || {};
  const url = (cfg.databaseURL || "").trim();
  return url.startsWith("https://") && !/YOUR_/i.test(url) && !/example/i.test(url);
}

function syncBaseUrl() {
  return ((window.SYNC_CONFIG && window.SYNC_CONFIG.databaseURL) || "").replace(/\/+$/, "");
}

function syncWallUrl() {
  return syncBaseUrl() + "/walls/" + encodeURIComponent(syncCode) + ".json";
}

function syncUpdatedAt() {
  try { return Number(localStorage.getItem(SYNC_UPDATED_KEY)) || 0; } catch { return 0; }
}

function setSyncUpdatedAt(t) {
  try { localStorage.setItem(SYNC_UPDATED_KEY, String(t)); } catch {}
}

function setSyncState(state) {
  syncState = state;
  const btn = $("#sync-btn");
  if (!btn) return;
  btn.dataset.state = state;
  const labels = {
    setup: "\u2601 sync",
    checking: "\u2601 syncing\u2026",
    syncing: "\u2601 syncing\u2026",
    synced: "\u2601 synced",
    offline: "\u2601 offline",
  };
  btn.textContent = labels[state] || labels.setup;
  const status = $("#sync-status");
  if (status) {
    const msgs = {
      setup: syncConfigured()
        ? "Not connected. Enter a code to sync this wall across your devices."
        : "Sync isn't set up yet. Paste your database URL into firebase-config.js first.",
      checking: "Checking for your notes\u2026",
      syncing: "Saving to the cloud\u2026",
      synced: "Synced \u2713 \u2014 use the same code on your other devices.",
      offline: "Couldn't reach the server. Notes are saved on this device only.",
    };
    status.textContent = msgs[state] || "";
    status.classList.toggle("is-error", state === "offline");
  }
  const disc = $("#sync-disconnect");
  if (disc) disc.hidden = !syncCode;
}

function syncPayload() {
  return { notes: notes, tags: tags, updatedAt: syncUpdatedAt() };
}

async function syncPush() {
  const res = await fetch(syncWallUrl(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(syncPayload()),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

async function syncPull() {
  const res = await fetch(syncWallUrl());
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return data && typeof data === "object" && Array.isArray(data.notes) ? data : null;
}

function scheduleSync() {
  if (!syncConfigured() || !syncCode) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(pushNow, 900);
}

async function pushNow() {
  if (syncInFlight) return;
  syncInFlight = true;
  setSyncState("syncing");
  setSyncUpdatedAt(Date.now());
  try {
    await syncPush();
    setSyncState("synced");
  } catch (err) {
    setSyncState("offline");
  } finally {
    syncInFlight = false;
  }
}

async function initSync() {
  try { syncCode = localStorage.getItem(SYNC_CODE_KEY) || ""; } catch { syncCode = ""; }
  if (!syncCode) { setSyncState("setup"); return; }
  if (!syncConfigured()) { setSyncState("setup"); return; }

  setSyncState("checking");
  let remote = null;
  try { remote = await syncPull(); } catch { remote = null; }

  if (!remote) {
    await pushNow();
    return;
  }

  const remoteTs = Number(remote.updatedAt) || 0;
  const localTs = syncUpdatedAt();

  if (remoteTs > localTs && Array.isArray(remote.notes)) {
    notes = remote.notes;
    tags = Array.isArray(remote.tags) && remote.tags.length ? remote.tags : tags;
    setSyncUpdatedAt(remoteTs);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch {}
    try { localStorage.setItem(TAGS_KEY, JSON.stringify(tags)); } catch {}
    activeTag = "all";
    buildTagTabs();
    render();
    setSyncState("synced");
  } else {
    await pushNow();
  }
}

function connectSync(code) {
  const clean = (code || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
  if (!clean) return;
  syncCode = clean;
  try { localStorage.setItem(SYNC_CODE_KEY, syncCode); } catch {}
  const input = $("#sync-code-input");
  if (input) input.value = syncCode;
  initSync();
}

function disconnectSync() {
  syncCode = "";
  try { localStorage.removeItem(SYNC_CODE_KEY); } catch {}
  const input = $("#sync-code-input");
  if (input) input.value = "";
  setSyncState("setup");
}

function generateSyncCode() {
  const words = ["oak","river","amber","falcon","cedar","ember","maple","harbor","quartz","lumen","nimbus","petal","spruce","tide","willow","canyon","meadow","aspen","summit","briar"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return pick() + "-" + pick() + "-" + Math.floor(10 + Math.random() * 90);
}

/* ---------- rendering ---------- */

function visibleNotes() {
  let list = notes.filter((n) => !isTrashed(n));

  if (activeTag !== "all") {
    list = list.filter((n) => (n.tags || []).includes(activeTag));
  }

  if (progressFilter !== "all") {
    list = list.filter((n) => (n.progress || "todo") === progressFilter);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter(
      (n) =>
        n.text.toLowerCase().includes(q) ||
        (n.source || "").toLowerCase().includes(q) ||
        noteTags(n).some((t) => t.label.toLowerCase().includes(q)) ||
        progressById(n.progress).label.toLowerCase().includes(q)
    );
  }

  return sortList(list);
}

function makeProgressBadge(progressId) {
  const p = progressById(progressId);
  const b = document.createElement("span");
  b.className = "note-progress progress-" + p.id;
  b.style.setProperty("--pcolor", p.color);
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = p.label;
  b.append(dot, label);
  return b;
}

function makeTagChip(tag) {
  const chip = document.createElement("span");
  chip.className = "note-tag";
  chip.style.setProperty("--tag-color", tag.color);
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = tag.label;
  chip.append(dot, label);
  return chip;
}

function buildNoteBody(el, note) {
  const tagRow = document.createElement("div");
  tagRow.className = "note-tags";
  noteTags(note).forEach((t) => tagRow.appendChild(makeTagChip(t)));

  const text = document.createElement("p");
  text.className = "note-text";
  text.textContent = note.text;

  const source = document.createElement("a");
  source.className = "note-source";
  source.textContent = note.source || "";
  if (note.source && /^https?:\/\//i.test(note.source)) {
    source.href = note.source;
    source.target = "_blank";
    source.rel = "noopener";
  }

  el.append(tagRow, text, source, makeProgressBadge(note.progress));
}

function enableDrag(el, note) {
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  let moved = false;
  let dragging = false;
  let hoverKey = null;

  const dropTargetAt = (cx, cy) => {
    if (viewMode === "trash") return null;
    const trash = document.getElementById("trash-btn");
    if (trash && pointInRect(cx, cy, trash.getBoundingClientRect())) return { type: "trash" };
    for (const t of document.querySelectorAll(".tag-tab[data-tag]")) {
      const id = t.dataset.tag;
      if (id === "all") continue;
      if (pointInRect(cx, cy, t.getBoundingClientRect())) return { type: "tag", id };
    }
    return null;
  };

  const keyFor = (t) => (t ? t.type + ":" + (t.id || "") : null);

  const applyHover = (key) => {
    document.querySelectorAll(".drop-hover").forEach((x) => x.classList.remove("drop-hover"));
    if (!key) return;
    if (key.startsWith("tag:")) {
      const t = document.querySelector('.tag-tab[data-tag="' + key.slice(4) + '"]');
      if (t) t.classList.add("drop-hover");
    } else if (key === "trash:") {
      const t = document.getElementById("trash-btn");
      if (t) t.classList.add("drop-hover");
    }
  };

  el.addEventListener("pointerdown", (e) => {
    if (viewMode === "trash") return;
    if (e.target.closest("a, button")) return; // let links/buttons behave natively
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    hoverKey = null;
    startX = e.clientX;
    startY = e.clientY;
    origX = note.x || 0;
    origY = note.y || 0;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    el.classList.add("dragging");
    document.body.classList.add("is-dragging");
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (!moved) return;

    const maxX = Math.max(0, wallEl.clientWidth - el.offsetWidth);
    note.x = clamp(origX + dx, 0, maxX);
    note.y = Math.max(0, origY + dy);
    el.style.left = note.x + "px";
    el.style.top = note.y + "px";

    const key = keyFor(dropTargetAt(e.clientX, e.clientY));
    if (key !== hoverKey) {
      hoverKey = key;
      applyHover(key);
    }
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    document.body.classList.remove("is-dragging");
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    applyHover(null);
    hoverKey = null;

    const target = dropTargetAt(e.clientX, e.clientY);

    if (moved && target) {
      // snap the note back to its spot, then apply the drop action
      note.x = origX;
      note.y = origY;
      el.style.left = origX + "px";
      el.style.top = origY + "px";
      if (target.type === "trash") {
        trashNote(note.id);
        showToast("moved to trash");
      } else if (target.type === "tag") {
        const added = addTagToNote(note.id, target.id);
        saveNotes();
        render();
        if (added) showToast("tag added");
      }
    } else if (moved) {
      note.cx = note.x;
      note.cy = note.y;
      saveNotes();
      updateBoardSize();
    } else {
      openNote(note.id);
    }
  };

  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("dragstart", (e) => e.preventDefault());
}

function noteElement(note) {
  const el = document.createElement("div");
  el.className = "note";
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", note.text);
  setPaper(el, paperColorFor(note), note.style);
  if (note.size === "large") el.classList.add("size-large");
  el.style.left = (note.x || 0) + "px";
  el.style.top = (note.y || 0) + "px";

  buildNoteBody(el, note);
  enableDrag(el, note);

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openNote(note.id);
    }
  });
  return el;
}

function trashNoteElement(note) {
  const el = noteElement(note);
  el.classList.add("trashed");
  el.setAttribute("aria-label", note.text + " (in trash)");

  const meta = document.createElement("p");
  meta.className = "trash-meta" + (daysLeft(note) <= 2 ? " due" : "");
  meta.textContent =
    daysLeft(note) <= 0
      ? "will be deleted next refresh"
      : "auto-deleted in " + daysLeft(note) + " day" + (daysLeft(note) === 1 ? "" : "s");

  const actions = document.createElement("div");
  actions.className = "note-actions";

  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "note-action";
  restore.textContent = "restore";
  restore.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreNote(note.id);
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "note-action danger";
  del.textContent = "delete forever";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteForever(note.id);
  });

  actions.append(restore, del);
  el.append(meta, actions);
  return el;
}

function render() {
  wallEl.innerHTML = "";
  $("#note-count").textContent = notes.filter((n) => !isTrashed(n)).length;

  const isTrash = viewMode === "trash";
  const isMatrix = sortMode === "matrix" && !isTrash;

  $("#trash-banner").hidden = !isTrash;
  $("#tag-tabs").style.display = isTrash ? "none" : "";
  $("#progress-tabs").style.display = isTrash ? "none" : "";
  $(".sort-row").style.display = isTrash ? "none" : "";
  $("#search-input").style.display = isTrash ? "none" : "";

  wallEl.style.display = isMatrix ? "none" : "";
  $("#matrix-view").hidden = !isMatrix;
  $("#empty-state").hidden = true;
  $("#trash-empty-state").hidden = true;

  if (isTrash) {
    const trashed = notes.filter(isTrashed).sort((a, b) => a.trashedAt - b.trashedAt);
    trashed.forEach((note) => wallEl.appendChild(trashNoteElement(note)));
    $("#trash-empty-state").hidden = trashed.length > 0;
  } else if (isMatrix) {
    const list = visibleNotes();
    layoutMatrix(list);
  } else {
    const list = visibleNotes();
    list.forEach((note) => wallEl.appendChild(noteElement(note)));
    $("#empty-state").hidden = list.length > 0;
  }

  $("#trash-count").textContent = notes.filter(isTrashed).length;
  $("#trash-btn").classList.toggle("active", isTrash);
  if (!isMatrix) updateBoardSize();
}

/* ---------- filter tabs ---------- */

function buildTagTabs() {
  const wrap = $("#tag-tabs");
  wrap.innerHTML = "";

  const all = { id: "all", label: "all", color: "transparent" };
  [all, ...tags].forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tag-tab" + (t.id === activeTag ? " active" : "");
    b.dataset.tag = t.id;

    const dot = document.createElement("span");
    dot.className = "dot";
    if (t.id === "all") {
      dot.style.background = "transparent";
      dot.style.border = "1px solid var(--line-strong)";
    } else {
      dot.style.background = t.color;
    }

    const label = document.createElement("span");
    label.textContent = t.label;

    b.append(dot, label);
    b.addEventListener("click", () => {
      viewMode = "wall";
      activeTag = t.id;
      buildTagTabs();
      render();
    });
    wrap.appendChild(b);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "tag-tab new-tag-tab";
  add.textContent = "+ new tag";
  add.addEventListener("click", openAddModal);
  wrap.appendChild(add);
}

function buildProgressTabs() {
  const wrap = $("#progress-tabs");
  wrap.innerHTML = "";

  const any = { id: "all", label: "any", color: "transparent" };
  [any, ...PROGRESS].forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "progress-tab" + (p.id === progressFilter ? " active" : "");

    const dot = document.createElement("span");
    dot.className = "dot";
    if (p.id === "all") {
      dot.style.background = "transparent";
      dot.style.border = "1px solid var(--line-strong)";
    } else {
      dot.style.background = p.color;
    }

    const label = document.createElement("span");
    label.textContent = p.label;

    b.append(dot, label);
    b.addEventListener("click", () => {
      viewMode = "wall";
      progressFilter = p.id;
      buildProgressTabs();
      render();
    });
    wrap.appendChild(b);
  });
}

/* ---------- modal ---------- */

function buildPaperControls() {
  const colors = $("#paper-colors");
  colors.innerHTML = "";
  PAPER_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "paper-color" + (c.id === selectedColor ? " selected" : "");
    b.style.setProperty("--swatch", c.color);
    b.title = c.label;
    b.addEventListener("click", () => {
      selectedColor = c.id;
      buildPaperControls();
      updatePreview();
    });
    colors.appendChild(b);
  });

  const styles = $("#paper-styles");
  styles.innerHTML = "";
  PAPER_STYLES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "paper-style" + (s.id === selectedStyle ? " selected" : "");
    const sw = document.createElement("span");
    sw.className = "swatch " + s.id;
    const label = document.createElement("span");
    label.textContent = s.label;
    b.append(sw, label);
    b.addEventListener("click", () => {
      selectedStyle = s.id;
      buildPaperControls();
      updatePreview();
    });
    styles.appendChild(b);
  });
}

function buildTagPicker() {
  const picker = $("#tag-picker");
  picker.innerHTML = "";
  tags.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tag-pick" + (selectedTags.includes(t.id) ? " selected" : "");
    b.style.setProperty("--tag-color", t.color);
    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.textContent = t.label;
    b.append(dot, label);
    b.addEventListener("click", () => {
      const i = selectedTags.indexOf(t.id);
      if (i >= 0) {
        selectedTags.splice(i, 1);
      } else if (selectedTags.length >= MAX_TAGS) {
        showToast("max " + MAX_TAGS + " tags per note");
        return;
      } else {
        selectedTags.push(t.id);
      }
      buildTagPicker();
      updatePreview();
    });
    picker.appendChild(b);
  });
}

function buildProgressPicker() {
  const picker = $("#progress-picker");
  picker.innerHTML = "";
  PROGRESS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "progress-pick" + (p.id === selectedProgress ? " selected" : "");
    b.style.setProperty("--pcolor", p.color);
    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.textContent = p.label;
    b.append(dot, label);
    b.addEventListener("click", () => {
      selectedProgress = p.id;
      buildProgressPicker();
      updatePreview();
    });
    picker.appendChild(b);
  });
}

function setProgressBadge(el, progressId) {
  const p = progressById(progressId);
  el.className = "note-progress progress-" + p.id;
  el.style.setProperty("--pcolor", p.color);
  el.textContent = "";
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = p.label;
  el.append(dot, label);
}



function updatePreview() {
  const previewNote = $("#preview-note");
  const tint = selectedTags.length === 1 ? tagById(selectedTags[0]) : null;
  setPaper(previewNote, tint ? tint.color : selectedColor, selectedStyle);
  previewNote.classList.toggle("size-large", noteInput.value.length > 150);
 

  const tagsWrap = $("#preview-tags");
  tagsWrap.innerHTML = "";
  selectedTags.map(tagById).filter(Boolean).forEach((t) => tagsWrap.appendChild(makeTagChip(t)));

  const text = noteInput.value.trim();
  $("#preview-text").textContent = text || "a question worth chasing...";
  $("#preview-source").textContent = sourceInput.value.trim();
  setProgressBadge($("#preview-progress"), selectedProgress);
}

function openAddModal() {
  editingNoteId = null;
  $("#add-note-title").textContent = "pin a note";
  $("#submit-btn").textContent = "Pin";
  selectedTags = [];
  selectedProgress = "todo";
  selectedColor = "cream";
  selectedStyle = "blank";

  noteInput.maxLength = 300;
  noteInput.value = "";
  sourceInput.value = "";
  $("#new-tag-input").value = "";
  noteInput.placeholder = NOTE_PROMPTS[Math.floor(Math.random() * NOTE_PROMPTS.length)];
  updateCharCount();
  buildPaperControls();
  buildTagPicker();
  buildProgressPicker();
  updatePreview();
  addModal.hidden = false;
  setTimeout(() => {
    noteInput.focus();
    autogrowNoteInput();
  }, 60);
}

function closeAddModal() {
  addModal.hidden = true;
  editingNoteId = null;
}

function openEditModal(id) {
  const note = findNote(id);
  if (!note || isTrashed(note)) return;
  closePopup();
  editingNoteId = id;
  selectedTags = (note.tags || []).filter((t) => tags.some((x) => x.id === t));
  selectedProgress = note.progress;
  selectedColor = note.color;
  selectedStyle = note.style;

  noteInput.value = note.text;
  sourceInput.value = note.source || "";
  noteInput.maxLength = 300;
  $("#new-tag-input").value = "";
  $("#add-note-title").textContent = "edit note";
  $("#submit-btn").textContent = "Save";
  updateCharCount();
  buildPaperControls();
  buildTagPicker();
  buildProgressPicker();
  updatePreview();
  addModal.hidden = false;
  setTimeout(() => {
    noteInput.focus();
    autogrowNoteInput();
  }, 60);
}

function addNewTag() {
  const input = $("#new-tag-input");
  const label = input.value.trim();
  if (!label) return;
  const tag = { id: makeId(), label, color: nextTagColor() };
  tags.push(tag);
  saveTags();
  if (!selectedTags.includes(tag.id)) {
    if (selectedTags.length >= MAX_TAGS) showToast("max " + MAX_TAGS + " tags per note");
    else selectedTags.push(tag.id);
  }
  input.value = "";
  buildTagPicker();
  buildTagTabs();
  updatePreview();
}

/* ---------- submit ---------- */

function submitNote() {
  const text = noteInput.value.trim();
  if (!text) {
    noteInput.focus();
    noteInput.style.borderColor = "rgba(224, 138, 122, 0.7)";
    setTimeout(() => (noteInput.style.borderColor = ""), 900);
    return;
  }

  if (editingNoteId) {
    const note = findNote(editingNoteId);
    if (note) {
      note.text = text;
      note.tags = selectedTags.slice();
      note.progress = selectedProgress;
      note.color = selectedColor;
      note.style = selectedStyle;

      note.size = noteInput.value.length > 150 ? "large" : "normal";
      note.source = sourceInput.value.trim();
      note.touchedAt = Date.now();
      saveNotes();
    }
    closeAddModal();
    render();
    return;
  }

  const pos = defaultNotePosition(noteInput.value.length > 150 ? "large" : "normal");
  notes.unshift({
    id: makeId(),
    text,
    tags: selectedTags.slice(),
    progress: selectedProgress,
    color: selectedColor,
    style: selectedStyle,
    matrixQuadrant: "ot",
    size: noteInput.value.length > 150 ? "large" : "normal",
    source: sourceInput.value.trim(),
    views: 0,
    date: Date.now(),
    touchedAt: Date.now(),
    trashedAt: null,
    x: pos.x,
    y: pos.y,
    cx: pos.x,
    cy: pos.y,
  });

  saveNotes();
  closeAddModal();
  viewMode = "wall";
  render();
}

/* ---------- note popup ---------- */

function openNote(id) {
  const note = findNote(id);
  if (!note || isTrashed(note)) return;
  if (openNoteId !== id) {
    note.views = (note.views || 0) + 1;
    saveNotes();
  }
  openNoteId = id;

  const detail = $("#detail-note");
  setPaper(detail, paperColorFor(note), note.style);
  detail.classList.toggle("size-large", note.size === "large");

  const tagsWrap = $("#detail-tags");
  tagsWrap.innerHTML = "";
  noteTags(note).forEach((t) => tagsWrap.appendChild(makeTagChip(t)));

  const detailText = $("#detail-text");
  detailText.className = "note-text";
  detailText.textContent = note.text;

  const src = $("#detail-source");
  src.textContent = note.source || "";
  if (note.source && /^https?:\/\//i.test(note.source)) {
    src.href = note.source;
  } else {
    src.removeAttribute("href");
  }

  setProgressBadge($("#detail-progress"), note.progress);
  $("#progress-btn").textContent = "progress: " + progressById(note.progress).label + " \u25B8";

  $("#view-count").textContent = "opened " + (note.views || 0) + " time" + ((note.views || 0) === 1 ? "" : "s");
  notePopup.hidden = false;
}

function closePopup() {
  notePopup.hidden = true;
  openNoteId = null;
}

function cycleProgress() {
  if (!openNoteId) return;
  const note = findNote(openNoteId);
  if (!note) return;
  const idx = PROGRESS.findIndex((p) => p.id === note.progress);
  note.progress = PROGRESS[(idx + 1) % PROGRESS.length].id;
  note.touchedAt = Date.now();
  saveNotes();
  openNote(note.id);
  render();
}

/* ---------- trash actions ---------- */

function addTagToNote(id, tagId) {
  const note = findNote(id);
  if (!note) return false;
  if (!Array.isArray(note.tags)) note.tags = [];
  if (note.tags.includes(tagId)) return false;
  if (note.tags.length >= MAX_TAGS) {
    showToast("max " + MAX_TAGS + " tags per note");
    return false;
  }
  note.tags.push(tagId);
  note.touchedAt = Date.now();
  saveNotes();
  return true;
}

function trashNote(id) {
  const note = findNote(id);
  if (!note) return;
  note.trashedAt = Date.now();
  saveNotes();
  closePopup();
  render();
}

function restoreNote(id) {
  const note = findNote(id);
  if (!note) return;
  note.trashedAt = null;
  note.touchedAt = Date.now();
  saveNotes();
  render();
}

function deleteForever(id) {
  notes = notes.filter((n) => n.id !== id);
  saveNotes();
  render();
}

/* ---------- theme (light / dark) ---------- */

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  updateThemeBtn();
}

function updateThemeBtn() {
  const light = currentTheme() === "light";
  const icon = $("#theme-icon");
  const label = $("#theme-label");
  if (icon) icon.textContent = light ? "\u2600" : "\u263E";
  if (label) label.textContent = light ? "light" : "dark";
}

/* ---------- events ---------- */

$("#submit-btn").addEventListener("click", submitNote);
$("#pin-btn").addEventListener("click", openAddModal);
$("#theme-btn").addEventListener("click", () => {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
});

function autogrowNoteInput() {
  noteInput.style.height = "auto";
  noteInput.style.height = noteInput.scrollHeight + "px";
}

noteInput.addEventListener("input", () => {
  autogrowNoteInput();
  updateCharCount();
  updatePreview();
});

sourceInput.addEventListener("input", updatePreview);

noteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitNote();
  }
});

function updateCharCount() {
  const len = noteInput.value.length;
  const limit = len > 150 ? 300 : 150;
  charCount.textContent = `${len}/${limit}`;
  charCount.style.color = len > 150 ? "var(--terracotta)" : "";
}

const newTagInput = $("#new-tag-input");
$("#new-tag-btn").addEventListener("click", addNewTag);
newTagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addNewTag();
  }
});

$("#search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  render();
});

$("#trash-btn").addEventListener("click", () => {
  viewMode = viewMode === "trash" ? "wall" : "trash";
  if (viewMode === "trash") searchQuery = "";
  render();
});

$("#back-to-wall").addEventListener("click", () => {
  viewMode = "wall";
  render();
});

// clicking the title returns to the home wall: clears filters and search, closes
// any open modal/popup, and restores the hand-arranged Custom layout
function goHome() {
  closeAddModal();
  closePopup();
  viewMode = "wall";
  activeTag = "all";
  progressFilter = "all";
  searchQuery = "";
  $("#search-input").value = "";
  sortMode = "custom";
  document.querySelectorAll(".sort-tab").forEach((t) => t.classList.toggle("active", t.dataset.sort === "custom"));
  buildTagTabs();
  buildProgressTabs();
  restoreCustom(notes.filter((n) => !isTrashed(n)));
  render();
}

$(".brand").addEventListener("click", goHome);
$(".brand").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    goHome();
  }
});

document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeAddModal);
});

document.querySelectorAll("[data-close-popup]").forEach((el) => {
  el.addEventListener("click", closePopup);
});

// sort tabs now re-arrange the board into a grid in that order
document.querySelectorAll(".sort-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    sortMode = tab.dataset.sort;
    document.querySelectorAll(".sort-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const list = notes.filter((n) => !isTrashed(n));
    if (sortMode === "matrix") {
      // matrix doesn't need board positions — just render the grid
    } else if (sortMode === "custom") restoreCustom(list);
    else if (sortMode === "random") scatterNotes(list);
    else if (sortMode === "bytag") layoutByTag(list);
    else if (sortMode === "clean") { list.sort((a, b) => (b.date || 0) - (a.date || 0)); layoutNotes(list); }
    else layoutNotes(sortList(list));
    saveNotes();
    render();
  });
});

$("#trash-note-btn").addEventListener("click", () => {
  if (openNoteId) trashNote(openNoteId);
});

$("#progress-btn").addEventListener("click", cycleProgress);

$("#edit-btn").addEventListener("click", () => {
  if (openNoteId) openEditModal(openNoteId);
});

$("#detail-note").addEventListener("dblclick", () => {
  if (openNoteId) openEditModal(openNoteId);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!addModal.hidden) closeAddModal();
  if (!notePopup.hidden) closePopup();
  const syncModal = $("#sync-modal");
  if (syncModal && !syncModal.hidden) syncModal.hidden = true;
});

/* ---------- sync UI ---------- */

$("#sync-btn").addEventListener("click", () => {
  const modal = $("#sync-modal");
  const input = $("#sync-code-input");
  if (modal) modal.hidden = false;
  if (input) input.value = syncCode || "";
  setSyncState(syncState);
});

document.querySelectorAll("[data-close-sync]").forEach((el) => {
  el.addEventListener("click", () => { $("#sync-modal").hidden = true; });
});

$("#sync-generate").addEventListener("click", () => {
  $("#sync-code-input").value = generateSyncCode();
});

$("#sync-connect").addEventListener("click", () => {
  connectSync($("#sync-code-input").value);
});

$("#sync-disconnect").addEventListener("click", () => {
  disconnectSync();
});

/* ---------- boot ---------- */

updateThemeBtn();
buildTagTabs();
buildProgressTabs();
render();
initSync();
