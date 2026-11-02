// ─────────────────────────────────────────────────────────────────────────────
// cento — app.js  (vanilla JS + CodeMirror 5 + Web Components)
// Loaded before components.js. Defines globals and the App object.
// App.init() is called by components.js after custom elements are registered.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME             = 'cento';
const DB_VERSION          = 2;
const NOTEBOOK_STORE      = 'notebooks';
const STATE_STORE         = 'app-state';
const NOTEBOOK_SESSION    = '.cento-notebook.json';
const AUTOSAVE_MS         = 1500;
const SESSION_MS          = 1000;

// Element lookup, cached: the shell's elements are never replaced, so each id is looked up once.
const _els = new Map();
const $ = id => {
    let el = _els.get(id);
    if (!el && (el = document.getElementById(id))) _els.set(id, el);
    return el;
};

// Small shared helpers
const byName    = (a, b) => a.name.localeCompare(b.name);
const byTitle   = (a, b) => a.title.localeCompare(b.title);
const joinPath  = (base, name) => (base ? `${base}/${name}` : name);
const parentPath = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
/** Copy text; falls back to the browser's own copy command if the clipboard API refuses. */
const copyText  = text => navigator.clipboard.writeText(text).catch(() => document.execCommand('copy'));

/** Links that open ANOTHER APP: an explicit allow-list of exactly these two schemes. (http/https
 *  open in a browser tab and relative paths open notes; every other scheme is never opened.) */
const APP_LINK_RE = /^(?:zotero|obsidian):\/\/[^\s\x00-\x1f\x7f]+$/i;

/** Hand a URL to whichever app registered its protocol; the browser asks the user to confirm. */
function openExternalApp(url) {
    const a = Object.assign(document.createElement('a'), { href: url, rel: 'noopener noreferrer' });
    document.body.appendChild(a);   // attached, so every browser honours the click
    a.click();
    a.remove();
}

// Reserved name for the "direct pages" pseudo-tab that appears as the first
// tab in the sub-section tabs row. Clicking it sets activeSubsection = null
// (i.e. the page list shows the section's direct .md files). Using a reserved
// sentinel instead of a human-readable string like "Pages" avoids any chance
// of collision with a real sub-section folder name. The <section-tabs>
// component renders this tab with the friendly label "Pages" via sec.label.
const PAGES_PSEUDO_TAB    = '__pages__';

// Supported themes. The active theme is applied as data-theme on <html> and
// persisted in the app-state IDB store (key 'theme') so it survives reloads.
// The CSS for each palette lives in looks.css under [data-theme="..."].
const THEMES = ['dark', 'cream'];

// ─────────────────────────────────────────────────────────────────────────────
// Typography settings — font catalog, weight scale, and defaults.
// Each family is now a single variable-font TTF (see looks.css @font-face),
// so the weight lists below reflect the full wght axis each variable font
// actually supports — users can pick any of these in the Settings dialog.
// ─────────────────────────────────────────────────────────────────────────────
const FONT_CATALOG = [
    { id: 'dm-sans',         label: 'DM Sans',           stack: "'DM Sans', system-ui, sans-serif",        tag: 'Sans · Screen',  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
    { id: 'inter',           label: 'Inter',             stack: "'Inter', system-ui, sans-serif",          tag: 'Sans · Screen',  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
    { id: 'ibm-plex-sans',   label: 'IBM Plex Sans',     stack: "'IBM Plex Sans', system-ui, sans-serif",  tag: 'Sans · Screen',  weights: [100, 200, 300, 400, 500, 600, 700] },
    { id: 'jetbrains-mono',  label: 'JetBrains Mono',    stack: "'JetBrains Mono', 'Fira Code', monospace",tag: 'Mono',           weights: [100, 200, 300, 400, 500, 600, 700, 800] },
    { id: 'lora',            label: 'Lora',              stack: "'Lora', Georgia, serif",                  tag: 'Serif',          weights: [400, 500, 600, 700] },
    { id: 'source-serif-4',  label: 'Source Serif 4',    stack: "'Source Serif 4', Georgia, serif",        tag: 'Serif',          weights: [200, 300, 400, 500, 600, 700, 800, 900] },
    { id: 'playfair-display',label: 'Playfair Display',  stack: "'Playfair Display', Georgia, serif",      tag: 'Display Serif',  weights: [400, 500, 600, 700, 800, 900] },
];

const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extralight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extrabold', 900: 'Heavy' };

const TYPOGRAPHY_DEFAULTS = {
    body: { font: 'dm-sans', size: 14, weight: 400 },
    h1:   { font: 'dm-sans', size: 27, weight: 600 },
    h2:   { font: 'dm-sans', size: 21, weight: 600 },
    h3:   { font: 'dm-sans', size: 17, weight: 600 },
};

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB  — two stores: 'notebooks' (all open notebooks) + 'app-state'
// ─────────────────────────────────────────────────────────────────────────────
// One connection, opened on first use and reused (it used to be reopened for every call).
let _db = null;
function openDB() {
    return _db ??= new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(NOTEBOOK_STORE))
                db.createObjectStore(NOTEBOOK_STORE, { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains(STATE_STORE))
                db.createObjectStore(STATE_STORE);
        };
        r.onsuccess = e => {
            const db = e.target.result;
            db.onversionchange = () => { db.close(); _db = null; };   // let another tab upgrade the schema
            res(db);
        };
        r.onerror = e => { _db = null; rej(e.target.error); };
    });
}

/** Run one request against a store and resolve with its result once the transaction commits. */
async function idb(store, mode, run) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx  = db.transaction(store, mode);
        const req = run(tx.objectStore(store));
        tx.oncomplete = () => res(req?.result);
        tx.onerror = tx.onabort = e => rej(e.target.error || tx.error);
    });
}

const dbGetAllNotebooks   = ()             => idb(NOTEBOOK_STORE, 'readonly',  st => st.getAll());
const dbAddNotebook       = (name, handle) => idb(NOTEBOOK_STORE, 'readwrite', st => st.add({ name, handle }));   // → the new id
const dbRemoveNotebook    = id             => idb(NOTEBOOK_STORE, 'readwrite', st => st.delete(id));
const dbSetActiveNotebook = id             => idb(STATE_STORE,    'readwrite', st => st.put({ activeNotebookId: id }, 'global'));
const dbGetAppState       = async ()       => (await idb(STATE_STORE, 'readonly', st => st.get('global'))) || {};

/** The active theme ('dark' | 'cream') lives under its own key, separate from 'global',
 *  so a future change to the global state object can't clobber it. */
const dbSetTheme          = theme          => idb(STATE_STORE,    'readwrite', st => st.put(theme, 'theme'));
const dbGetTheme          = async ()       => (await idb(STATE_STORE, 'readonly', st => st.get('theme'))) || null;

// ─────────────────────────────────────────────────────────────────────────────
// File system helpers
// ─────────────────────────────────────────────────────────────────────────────
async function readFile(fh)           { return (await fh.getFile()).text(); }
async function writeFile(fh, content) {
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
}

async function resolveDir(rootHandle, folderPath) {
    if (!folderPath) return rootHandle;
    let dir = rootHandle;
    for (const part of folderPath.split('/'))
        dir = await dir.getDirectoryHandle(part);
    return dir;
}

// ── Copy / move helpers ──────────────────────────────────────────────────────
// The File System Access API has no rename or move for directories, so a folder
// is "moved" by copying it, checking the copy, and only then deleting the original.

/** True if dir already holds an entry called `name` (case-insensitive, as on Windows). */
async function entryExists(dir, name) {
    for await (const [n] of dir.entries())
        if (n.toLowerCase() === name.toLowerCase()) return true;
    return false;
}

/** Copy one file (binary-safe, so images and PDFs survive) into dstDir as `name`. */
async function copyFileInto(srcFh, dstDir, name) {
    const file = await srcFh.getFile();
    const dst  = await dstDir.getFileHandle(name, { create: true });
    const w    = await dst.createWritable();
    await w.write(file);
    await w.close();
    return dst;
}

/** Copy everything inside srcDir into the (existing) dstDir. */
async function copyContents(srcDir, dstDir) {
    for await (const [n, entry] of srcDir.entries()) {
        if (entry.kind === 'file') {
            await copyFileInto(entry, dstDir, n);
        } else {
            const sub = await dstDir.getDirectoryHandle(n, { create: true });
            await copyContents(entry, sub);
        }
    }
}

/** { entries, bytes } of a whole directory tree, used to verify a copy. */
async function treeStats(dir) {
    let entries = 0, bytes = 0;
    for await (const [, e] of dir.entries()) {
        entries++;
        if (e.kind === 'file') bytes += (await e.getFile()).size;
        else { const s = await treeStats(e); entries += s.entries; bytes += s.bytes; }
    }
    return { entries, bytes };
}

/** Copy srcParent/name to dstParent/newName and verify it. The original is NOT touched.
 *  A failed or mismatching copy is removed again before the error is thrown. */
async function copyDirVerified(srcParent, name, dstParent, newName) {
    if (await entryExists(dstParent, newName)) throw new Error(`"${newName}" already exists there`);
    const src = await srcParent.getDirectoryHandle(name);
    const dst = await dstParent.getDirectoryHandle(newName, { create: true });
    try {
        await copyContents(src, dst);
        const [a, b] = [await treeStats(src), await treeStats(dst)];
        if (a.entries !== b.entries || a.bytes !== b.bytes)
            throw new Error('the copy did not match the original, so nothing was deleted');
    } catch (e) {
        await dstParent.removeEntry(newName, { recursive: true }).catch(() => {});
        throw e;
    }
    return dst;
}

/** Rename a folder in place. A case-only change ("notes" → "Notes") goes through a
 *  temporary name: on a case-insensitive disk the two names are the same folder, and a
 *  plain copy-then-delete would copy it onto itself and then delete it. */
async function renameDirectory(parent, oldName, newName) {
    const step = async (from, to) => {
        const dst = await copyDirVerified(parent, from, parent, to);
        await parent.removeEntry(from, { recursive: true });
        return dst;
    };
    if (oldName.toLowerCase() === newName.toLowerCase()) {
        const tmp = `${newName}.cento-tmp-${Date.now()}`;
        await step(oldName, tmp);
        return step(tmp, newName);
    }
    return step(oldName, newName);
}

async function uniqueFilename(dirHandle, base = 'Untitled') {
    const existing = [];
    for await (const [n] of dirHandle.entries()) existing.push(n);
    let name = base + '.md', i = 1;
    while (existing.includes(name)) name = `${base} ${i++}.md`;
    return name;
}

/** HTML for `text` with each case-insensitive occurrence of `query` wrapped in <mark>.
 *  `query` is matched literally (so "c++" or "(x" are fine), and every piece is escaped
 *  on its own, so a search for "amp" can never cut into an &amp; entity. */
function highlightMatches(text, query) {
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let out = '', last = 0, m;
    while ((m = re.exec(text)) !== null) {
        out += escapeHtml(text.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
        last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
}

// ─────────────────────────────────────────────────────────────────────────────
// CodeMirror 5 live-preview decorations  (globals used by <cento-editor>)
// ─────────────────────────────────────────────────────────────────────────────
const HEADING_CLS = ['', 'cm-h1', 'cm-h2', 'cm-h3', 'cm-h4', 'cm-h5', 'cm-h6'];

function rebuildDecorations(cm) {
    cm.operation(() => {
        cm.getAllMarks().forEach(m => m.clear());
        const cursor = cm.getCursor();
        const lineCount = cm.lineCount();
        const blockState = { fence: null, math: false };   // code/maths block state carried from line to line
        for (let i = 0; i < lineCount; i++)
            decorateLine(cm, i, cm.getLine(i), i === cursor.line ? cursor.ch : -1, blockState);
    });
}

/** Returns mk(from, to, cls): marks a character range on one line. */
const lineMarker = (cm, lineNo) => (from, to, cls) => cm.markText(
    { line: lineNo, ch: from }, { line: lineNo, ch: to },
    { className: cls, atomic: false }
);

function decorateLine(cm, lineNo, text, cursorCh, blockState) {
    const mk = lineMarker(cm, lineNo);

    // Fenced code and $$ maths: lightly styled source (fully rendered in Preview Mode).
    // No inline decorations inside them, so *, _ and ^ in code or TeX are left alone.
    if (blockState) {
        const fence = text.match(/^\s*(```+|~~~+)/);
        if (blockState.fence) {
            if (fence && text.trim().startsWith(blockState.fence)) { blockState.fence = null; mk(0, text.length, 'cm-md-fence'); }
            else if (text.length) mk(0, text.length, 'cm-md-codeblock');
            return;
        }
        if (fence) { blockState.fence = fence[1]; mk(0, text.length, 'cm-md-fence'); return; }
        if (blockState.math) {
            if (text.includes('$$')) blockState.math = false;
            if (text.length) mk(0, text.length, 'cm-md-math');
            return;
        }
        const mathStart = text.match(/^\s*\$\$(.*)$/);
        if (mathStart) {
            const close = mathStart[1].indexOf('$$');
            if (close < 0 || mathStart[1].slice(close + 2).trim() === '') {   // same rule as markdown.js
                if (close < 0) blockState.math = true;
                mk(0, text.length, 'cm-md-math');
                return;
            }
        }
    }

    const hm = text.match(/^(#{1,6}) /);
    if (hm) {
        const level = hm[1].length, prefixLen = level + 1;
        const inRange = cursorCh >= 0 && cursorCh <= text.length;
        mk(0, prefixLen, inRange ? 'cm-md-syntax' : 'cm-md-hidden');
        mk(prefixLen, text.length, HEADING_CLS[level]);
        return;
    }
    if (text.startsWith('> ')) {
        const inRange = cursorCh >= 0 && cursorCh <= 2;
        mk(0, 2, inRange ? 'cm-md-syntax' : 'cm-md-hidden');
        mk(inRange ? 0 : 2, text.length, 'cm-md-blockquote');
        return;
    }
    if (/^---+$/.test(text.trim())) { mk(0, text.length, cursorCh >= 0 ? 'cm-md-syntax' : 'cm-md-hr'); return; }
    applyInline(cm, lineNo, text, cursorCh);
}

function applyInline(cm, lineNo, rawText, cursorCh) {
    const mk = lineMarker(cm, lineNo);
    // $inline maths$: styled as source, and masked so the patterns below ignore the TeX.
    // Same rules as markdown.js: no space just inside the $ signs, closing $ not followed by a digit.
    const noCode = rawText.replace(/`[^`\n]*`/g, s => ' '.repeat(s.length));   // $ inside `code` isn't maths
    const mathRe = /(?<![\\$])(?:\$\$[^$\n]+\$\$|\$[^\s$](?:[^$\n]*[^\s$])?\$(?!\d))/g;
    let text = rawText;
    for (const mm of noCode.matchAll(mathRe)) {
        mk(mm.index, mm.index + mm[0].length, 'cm-md-math');
        text = text.slice(0, mm.index) + ' '.repeat(mm[0].length) + text.slice(mm.index + mm[0].length);
    }
    // ^[inline footnotes]: shown inline as a dim italic aside. The "^[" opener is masked so the
    // ^superscript^ pattern below can't start there. Same bracket-matching rule as markdown.js.
    const fnScan = text.replace(/`[^`\n]*`/g, s => ' '.repeat(s.length));   // ignore ^[ inside `code`
    for (let i = 0; i < fnScan.length - 1; i++) {
        if (fnScan[i] !== '^' || fnScan[i + 1] !== '[') continue;
        let depth = 0, end = -1;
        for (let j = i + 1; j < fnScan.length; j++) {
            const c = fnScan[j];
            if (c === '\\') { j++; continue; }
            if (c === '[') depth++;
            else if (c === ']' && --depth === 0) { end = j; break; }
        }
        if (end > i + 2 && fnScan.slice(i + 2, end).trim()) {
            mk(i, end + 1, 'cm-md-footnote');
            text = text.slice(0, i) + '  ' + text.slice(i + 2);
            i = end;
        }
    }
    applyPattern(text, /(\*\*\*)(.+?)(\*\*\*)/g,             cursorCh, mk, 'cm-md-syntax', 'cm-md-bold cm-md-italic', 'cm-md-syntax');
    applyPattern(text, /(\*\*)([^*\n]+?)(\*\*)/g,            cursorCh, mk, 'cm-md-syntax', 'cm-md-bold',              'cm-md-syntax');
    applyPattern(text, /(?<!\*)\*(?!\*)([^*\n]+?)\*/g,       cursorCh, mk, 'cm-md-syntax', 'cm-md-italic',            'cm-md-syntax', true);
    applyPattern(text, /(?<!_)_(?!_)([^_\n]+?)_/g,          cursorCh, mk, 'cm-md-syntax', 'cm-md-italic',            'cm-md-syntax', true);
    applyPattern(text, /(`)(.*?)(`)/g,                       cursorCh, mk, 'cm-md-syntax', 'cm-md-code',              'cm-md-syntax');
    applyPattern(text, /(==)(.+?)(==)/g,                     cursorCh, mk, 'cm-md-syntax', 'cm-md-highlight',         'cm-md-syntax');
    applyPattern(text, /(\^)(.+?)(\^)/g,                     cursorCh, mk, 'cm-md-syntax', 'cm-md-superscript',       'cm-md-syntax');
    applyPattern(text, /(~)(.+?)(~)/g,                       cursorCh, mk, 'cm-md-syntax', 'cm-md-subscript',         'cm-md-syntax');
    applyBracketed(text, /\[\[([^\]]+)\]\]/g,                           2, 'cm-md-wikilink',    cursorCh, mk);
    applyBracketed(text, /\[([^\]]+)\]\((zotero:\/\/[^)]+)\)/g,           1, 'cm-md-zotero-link', cursorCh, mk);
    applyBracketed(text, /\[([^\]]+)\]\(((?!zotero:\/\/)[^)]+)\)/g,       1, 'cm-md-link',        cursorCh, mk);
}

/** [[wikilinks]], [text](zotero://…) and [text](url): show the whole source while the cursor
 *  is inside, otherwise hide the brackets/URL and show only the text (match group 1).
 *  openLen = length of the opening bracket(s). */
function applyBracketed(text, re, openLen, cls, cursorCh, mk) {
    let m;
    while ((m = re.exec(text)) !== null) {
        const start = m.index, end = start + m[0].length;
        const cs = start + openLen, ce = cs + m[1].length;
        if (cursorCh >= start && cursorCh <= end) mk(start, end, cls);
        else { mk(start, cs, 'cm-md-hidden'); mk(cs, ce, cls); mk(ce, end, 'cm-md-hidden'); }
    }
}

function applyPattern(text, re, cursorCh, mk, cls0, cls1, cls2, singleChar = false) {
    let m; re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        const full = m[0], start = m.index;
        const content = singleChar ? m[1] : m[2];
        const open    = singleChar ? full[0] : m[1];
        const close   = singleChar ? full[full.length-1] : m[3];
        const openLen = open.length, closeLen = close.length;
        const cs = start + openLen, ce = cs + content.length, end = ce + closeLen;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) { mk(start, cs, cls0); mk(cs, ce, cls1); mk(ce, end, cls2); }
        else         { mk(start, cs, 'cm-md-hidden'); mk(cs, ce, cls1); mk(ce, end, 'cm-md-hidden'); }
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
const App = {

    // ── State ──────────────────────────────────────────────────────────────────
    // Each notebook in the array: { id, name, handle, sections, unfiledPages, session }
    // sections: [{ name, handle, path, pages, subsections }]
    //   - pages       : the .md files directly in the section
    //   - subsections : [{ name, handle, path, pages }] — folders one level deep
    //                    inside the section. subsection.pages is EVERY .md file anywhere
    //                    under that folder (deeper folders are not part of the hierarchy).
    // PageNode : { name, title, path, handle } — a flat list; no nesting.
    notebooks:        [],
    activeNotebookId: null,
    activeSection:    null,   // section name string, or 'Unfiled'
    activeSubsection: null,   // sub-section name string within the active section,
                              // or null when viewing the section's direct pages
                              // (i.e. the "Pages" pseudo-tab is active).
    activePage:       null,   // path relative to notebook root  e.g. "Research/note.md"
    activePageHandle: null,   // FileSystemFileHandle for the open page
    activePageDirty:  false,
    activeIsDrawer:   false,  // true when the open file came from the Drawer
    drawerFiles:      [],
    sidebarView:      'notebooks',
    editorMode:       'live',
    outlineVisible:   false,
    sidebarWidth:     260,
    pageListWidth:    180,
    rightSidebarWidth:220,
    searchQuery:      '',
    searchResults:    [],
    searchRan:        false,
    saveStatus:       '',
    activeTheme:      'dark',  // 'dark' | 'cream' — applied as data-theme on <html>
    typography:       structuredClone(TYPOGRAPHY_DEFAULTS), // current notebook's font settings

    // ── Internals ──────────────────────────────────────────────────────────────
    _sessionTimers:   {},   // one debounce timer per notebook id
    _saveTimer:       null,
    _outlineTimer:    null,
    _navHistory:      [],   // [{notebookId, section, subsection, pagePath, handle}] — in-memory only
    _navIndex:        -1,   // current position in _navHistory
    _navigating:      false,// true while executing a back/forward jump (suppress push)
    _ctxNode:         null,
    _ctxTab:          null,   // { level: 'section' | 'subsection', name } while the menu is open on a tab
    _moveNode:        null,   // page being moved by the Move to Section dialog
    _moveDest:        null,   // destination picked in that dialog
    _settingsDraft:   null,   // working copy of typography edited inside the Settings dialog

    /** Make a section the active one — what clicking its tab does. `openDefault: false` skips opening
     *  the section's last/first page (used when a new page is about to be created there anyway). */
    _selectSection(sectionName, { openDefault = true } = {}) {
        const nb = this.activeNotebook;
        this.activeSection = sectionName;
        // Restore the section's last-active sub-section, or default to its first (null if it has none)
        this.activeSubsection = nb ? this._resolveActiveSubsection(nb, sectionName) : null;
        this._rememberLastSubsection(this.activeSection, this.activeSubsection);
        this.renderSectionTabs(this.activeNotebookId);      // update active highlight
        this.renderSubsectionTabs(this.activeNotebookId);   // show/hide + update sub row
        this.renderPageList(this.activeSection, this.activeSubsection);
        this.scheduleNotebookSessionSave(this.activeNotebookId);
        if (openDefault) this._openDefaultPageForSection(sectionName);
    },

    get activeNotebook() { return this.notebooks.find(n => n.id === this.activeNotebookId); },

    /** The notebook's saved-session object (created on first use). */
    _session(nb) { return nb.session ??= {}; },

    /** Show the editor (a page is open) or the welcome screen (nothing is). */
    _showEditor(on) {
        $('editor').style.display  = on ? '' : 'none';
        $('welcome').style.display = on ? 'none' : '';
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Boot
    // ─────────────────────────────────────────────────────────────────────────
    init() {
        const ed = () => $('editor');

        // ── Toolbar and welcome-screen buttons ───────────────────────────────
        const clicks = {
            'btn-open-notebook':         () => this.openNotebook(),
            'btn-open-notebook-welcome': () => this.openNotebook(),
            'btn-open-file':             () => this.openFileInDrawer(),
            'btn-open-file-welcome':     () => this.openFileInDrawer(),
            'btn-new-notebook':          () => this.newNotebook(),
            'btn-new-notebook-welcome':  () => this.newNotebook(),
            'btn-new-page':              () => this.newPage(),
            'btn-sidebar-notebooks':     () => this.setSidebarView('notebooks'),
            'btn-sidebar-search':        () => { this.setSidebarView('search'); $('search-input').focus(); },
            'btn-toggle-preview':        () => this.toggleEditorMode(),
            'btn-add-column':            () => ed()?.addColumn(),
            'btn-remove-column':         () => ed()?.removeColumn(),
            'btn-toggle-outline':        () => this.toggleOutline(),
            'btn-save':                  () => this.saveActivePage(),
            'btn-nav-back':              () => this.navBack(),
            'btn-nav-forward':           () => this.navForward(),
            'btn-theme':                 () => this.toggleTheme(),
            'btn-search-go':             () => this.runSearch(),
        };
        for (const [id, fn] of Object.entries(clicks)) $(id).addEventListener('click', fn);

        // ── Search ───────────────────────────────────────────────────────────
        const searchInput = $('search-input');
        searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.runSearch(); });
        searchInput.addEventListener('input', e => { this.searchQuery = e.target.value; });

        // ── Global keyboard ──────────────────────────────────────────────────
        window.addEventListener('keydown', e => {
            // toLowerCase: with Caps Lock on, e.key is 'S'
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveActivePage(); }
        });

        // ── Section tabs (custom element events) ─────────────────────────────
        const sectionTabsEl = $('section-tabs-el');
        sectionTabsEl.addEventListener('section-change', e => this._selectSection(e.detail.section));
        sectionTabsEl.addEventListener('section-add', e => this.addSection(e.detail.name));

        // ── Sub-section tabs (custom element events) ─────────────────────────
        // Same <section-tabs> custom element, but with variant="subsection" so
        // it fires subsection-change / subsection-add instead of section-*.
        // The first tab is always the "Pages" pseudo-tab (PAGES_PSEUDO_TAB)
        // which represents the section's direct .md files (activeSubsection=null).
        const subsectionTabsEl = $('subsection-tabs-el');
        subsectionTabsEl.addEventListener('subsection-change', e => {
            const clicked = e.detail.section;
            this.activeSubsection = (clicked === PAGES_PSEUDO_TAB) ? null : clicked;
            this._rememberLastSubsection(this.activeSection, this.activeSubsection);
            this.renderSubsectionTabs(this.activeNotebookId); // update active highlight
            this.renderPageList(this.activeSection, this.activeSubsection);
            this.scheduleNotebookSessionSave(this.activeNotebookId);
            this._openDefaultPageForSection(this.activeSection);
        });
        subsectionTabsEl.addEventListener('subsection-add', e => this.addSubsection(e.detail.name));

        // Right-click on a section / sub-section tab → the shared context menu; and rename results.
        // The "Unfiled" and "Pages" pseudo-tabs aren't folders, so they get no menu.
        const onTabMenu = level => e => {
            const name = e.detail.name;
            if (name === 'Unfiled' || name === PAGES_PSEUDO_TAB) return;
            this._showContextMenu(e, { kind: 'tab', tab: { level, name } });
        };
        sectionTabsEl.addEventListener('tab-contextmenu', onTabMenu('section'));
        subsectionTabsEl.addEventListener('tab-contextmenu', onTabMenu('subsection'));
        sectionTabsEl.addEventListener('tab-rename', e => this.renameTab('section', e.detail.oldName, e.detail.newName));
        subsectionTabsEl.addEventListener('tab-rename', e => this.renameTab('subsection', e.detail.oldName, e.detail.newName));

        // ── Page list (custom element events) ────────────────────────────────
        const pageListEl = $('page-list-component');
        pageListEl.addEventListener('page-select', async e => {
            const nb = this.activeNotebook;
            if (!nb) return;
            const node = this._findPageByPath(nb, e.detail.path);
            if (node?.handle) await this.openPage(e.detail.path, node.handle);
        });
        pageListEl.addEventListener('page-contextmenu', e => {
            const nb = this.activeNotebook;
            if (!nb) return;
            const node = this._findPageByPath(nb, e.detail.path);
            if (!node) return;
            this._showContextMenu(e, { kind: 'node', node });
        });
        pageListEl.addEventListener('page-rename', async e => {
            await this.commitRename(e.detail.path, e.detail.newTitle);
        });

        // ── Notebook list (custom element events) ────────────────────────────
        $('notebook-list')
            .addEventListener('notebook-activate', e => {
                this.switchToNotebook(Number(e.detail.id));
            });
        $('notebook-list')
            .addEventListener('notebook-close', async e => {
                await this.closeNotebook(Number(e.detail.id));
            });

        // ── <cento-editor> events ─────────────────────────────────────────────
        document.addEventListener('content-change', () => {
            this.activePageDirty = true;
            this.scheduleAutoSave();
        });
        document.addEventListener('cursor-change', () => {
            if (this.outlineVisible) {
                clearTimeout(this._outlineTimer);
                this._outlineTimer = setTimeout(() => this._renderOutline(), 300);
            }
        });
        document.addEventListener('column-count-change', () => this._renderToolbar());
        document.addEventListener('max-columns-reached', () => {
            this.toast('Maximum of 4 columns reached.');
        });
        document.addEventListener('link-click', e => {
            this.handleLinkClick({ href: e.detail.href, isWiki: e.detail.isWiki });
        });

        // ── Link clicks in the editor (live mode, wikilinks/md links) ─────────
        $('panes-container')
            .addEventListener('click', e => {
                const el = e.target.closest('.cm-md-link, .cm-md-zotero-link, .cm-md-wikilink');
                if (!el) return;
                e.preventDefault();
                const cm = ed()?.getActiveCm();
                if (!cm) return;
                const pos  = cm.coordsChar({ left: e.clientX, top: e.clientY });
                const line = cm.getLine(pos.line) || '';
                if (el.classList.contains('cm-md-wikilink')) {
                    const m = line.match(/\[\[([^\]]+)\]\]/);
                    if (m) this.handleLinkClick({ href: m[1], isWiki: true });
                } else {
                    const m = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
                    if (m) this.handleLinkClick({ href: m[2], isWiki: false });
                }
            });

        // ── Context menu ──────────────────────────────────────────────────────
        document.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (e.target.closest('.CodeMirror, .preview-only-pane'))
                this._showContextMenu(e, { kind: 'editor' });
        });
        $('ctx-rename').addEventListener('click', () => {
            const node = this._ctxNode, tab = this._ctxTab; this._hideContextMenu();
            if (tab) { this._startTabRename(tab); return; }
            if (!node) return;
            // Set the renaming attribute on the matching <page-list-item>
            const item = document.querySelector(`page-list-item[page-path="${CSS.escape(node.path)}"]`);
            item?.setAttribute('renaming', '');
        });
        $('ctx-delete').addEventListener('click', () => {
            const node = this._ctxNode, tab = this._ctxTab; this._hideContextMenu();
            if (tab) this.deleteTab(tab);
            else if (node) this.deleteNode(node);
        });
        $('ctx-add-subsection').addEventListener('click', async () => {
            const tab = this._ctxTab; this._hideContextMenu();
            if (tab?.level !== 'section') return;
            if (this.activeSection !== tab.name) this._selectSection(tab.name, { openDefault: false });
            await this.addSubsection('Untitled');   // creates it with its first page already in rename mode
        });
        $('ctx-move')?.addEventListener('click', () => {
            const node = this._ctxNode; this._hideContextMenu();
            if (node) this.openMoveDialog(node);
        });
        $('context-menu').addEventListener('click', e => {
            const item = e.target.closest('.ctx-editor-item');
            if (!item || item.dataset.disabled === 'true') return;
            this._hideContextMenu();
            this._handleEditorCtxAction(item.dataset.action);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('#context-menu')) this._hideContextMenu();
        });
        document.addEventListener('scroll', () => this._hideContextMenu(), true);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this._hideContextMenu(); });

        // ── Panel resize handles ───────────────────────────────────────────────
        this._initResizeDrag($('resize-left'),  'left');
        this._initResizeDrag($('resize-page'),  'page');
        this._initResizeDrag($('resize-right'), 'right');
        this._applyWidths();

        // ── Drawer header click — switches the view back to the Drawer ────────
        document.querySelector('.drawer-section-header')
            .addEventListener('click', () => this.showDrawerView());

        // ── Settings modal ──────────────────────────────────────────────────
        this._initSettingsModal();
        this._initMoveDialog();
        this._applyTypography();

        // ── File Handling API  (open .md files from OS file manager) ──────────
        if ('launchQueue' in window) {
            window.launchQueue.setConsumer(params => {
                if (params.files?.length)
                    params.files.forEach(fh => this._openLaunchFile(fh));
                else if (params.targetURL) {
                    const url = new URL(params.targetURL);
                    const proto = url.searchParams.get('view');
                    if (proto) {
                        const path = new URL(proto).searchParams.get('view');
                        if (path) this.handleLinkClick({ href: path, isProto: true });
                    }
                }
            });
        }

        // ── Initial renders ───────────────────────────────────────────────────
        this._renderToolbar();
        this._renderSidebar();
        this._renderThemeButton();   // sets the correct sun/moon icon for the default theme

        // ── Restore notebooks from IndexedDB ──────────────────────────────────
        (async () => {
            try {
                // Restore the saved theme as early as possible so the first
                // paint isn't a flash of the default dark theme when the user
                // had previously chosen cream.
                const savedTheme = await dbGetTheme();
                if (savedTheme && THEMES.includes(savedTheme) && savedTheme !== this.activeTheme) {
                    this.applyTheme(savedTheme);
                }

                const [stored, state] = await Promise.all([dbGetAllNotebooks(), dbGetAppState()]);
                for (const rec of stored) {
                    const perm = await rec.handle.queryPermission({ mode: 'readwrite' });
                    if (perm === 'granted') {
                        // Permission already held — mount immediately
                        await this._mountNotebookRecord(rec);
                    } else if (perm === 'prompt') {
                        // Show as "needs reconnect" in the sidebar
                        this.notebooks.push({
                            id: rec.id, name: rec.name, handle: rec.handle,
                            sections: [], unfiledPages: [], session: {},
                            needsPermission: true
                        });
                        this.renderNotebookList();
                    }
                    // 'denied' → silently skip
                }
                // Activate the notebook that was last used
                if (state.activeNotebookId) {
                    const nb = this.notebooks.find(n => n.id === state.activeNotebookId && !n.needsPermission);
                    if (nb) await this.switchToNotebook(nb.id);
                } else if (this.notebooks.length) {
                    const ready = this.notebooks.find(n => !n.needsPermission);
                    if (ready) await this.switchToNotebook(ready.id);
                }
            } catch (e) { console.warn('Cento: IDB restore error', e); }
        })();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Notebook management
    // ─────────────────────────────────────────────────────────────────────────

    /** User clicks "Open Notebook" — picks a directory and adds it */
    async openNotebook() {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            // Check if already open
            const existing = this.notebooks.find(n => n.name === handle.name);
            if (existing) { await this.switchToNotebook(existing.id); return; }

            const id = await dbAddNotebook(handle.name, handle);
            await this._mountNotebookRecord({ id, name: handle.name, handle });
            await this.switchToNotebook(id);
        } catch (e) {
            if (e.name !== 'AbortError') this.toast('Could not open folder: ' + e.message);
        }
    },

    /** Internal: scan a notebook record and add it to this.notebooks */
    async _mountNotebookRecord(rec) {
        const nb = {
            id: rec.id,
            name: rec.name,
            handle: rec.handle,
            sections: [],
            unfiledPages: [],
            session: {},
            needsPermission: false
        };
        // Remove any pending-permission placeholder with the same id
        const idx = this.notebooks.findIndex(n => n.id === rec.id);
        if (idx >= 0) this.notebooks.splice(idx, 1, nb);
        else this.notebooks.push(nb);

        await this._scanNotebook(nb);
        await this._loadNotebookSession(nb);
        this.renderNotebookList();
    },

    /** Remove a notebook from the app and from IDB */
    async closeNotebook(id) {
        const nb = this.notebooks.find(n => n.id === id);
        if (!nb) return;
        if (!await this._confirm(`Close notebook "${nb.name}"?`)) return;

        await dbRemoveNotebook(id);
        this.notebooks = this.notebooks.filter(n => n.id !== id);

        if (this.activeNotebookId === id) {
            this.activeNotebookId = null;
            this.activeSection    = null;
            this.activeSubsection = null;
            this.activePage       = null;
            this.activePageHandle = null;
            this.activeIsDrawer   = false;
            // Clear the editor and show the welcome screen
            this._showEditor(false);
            $('section-tabs-el').style.display = 'none';
            $('subsection-tabs-el').style.display = 'none';
            $('page-list-panel').style.display = 'none';
            $('page-list-component').innerHTML = '';

            // Switch to another open notebook if one exists
            const next = this.notebooks.find(n => !n.needsPermission);
            if (next) await this.switchToNotebook(next.id);
        }

        this.renderNotebookList();
        this._renderToolbar();
    },

    /** Switch the editor to a notebook that's already mounted */
    async switchToNotebook(id) {
        const nb = this.notebooks.find(n => n.id === id);
        if (!nb) return;

        // Re-request permission if needed (user must interact)
        if (nb.needsPermission) {
            try {
                const perm = await nb.handle.requestPermission({ mode: 'readwrite' });
                if (perm !== 'granted') { this.toast('Permission denied for this notebook.'); return; }
                nb.needsPermission = false;
                await this._scanNotebook(nb);
                await this._loadNotebookSession(nb);
            } catch { return; }
        }

        this.activeNotebookId = id;
        this.activeIsDrawer   = false;   // switching to a notebook always exits Drawer view
        await dbSetActiveNotebook(id);

        this.renderNotebookList();
        this.renderSectionTabs(id);
        this.renderSubsectionTabs(id);   // preliminary: hides stale sub-section row if the
                                         // previous notebook's activeSection isn't in this one
        this._renderToolbar();
        this._applyWidths();

        // Open the last-active section and page from session
        const s = nb.session || {};
        const section = s.activeSection || nb.sections[0]?.name || (nb.unfiledPages.length ? 'Unfiled' : null);
        if (section) {
            this.activeSection = section;
            // Resolve the active sub-section for this section (last-active from
            // session, else first sub-section, else null when no sub-sections).
            this.activeSubsection = this._resolveActiveSubsection(nb, section);
            this.renderSectionTabs(id);   // re-render to reflect active section
            this.renderSubsectionTabs(id); // show/hide sub-section row + highlight
            this.renderPageList(section, this.activeSubsection);
        } else {
            this.activeSubsection = null;
        }

        if (s.activePage) {
            const node = this._findPageByPath(nb, s.activePage);
            if (node?.handle) {
                const colData = s.pageStates?.[s.activePage]?.columns || [];
                await this.openPage(s.activePage, node.handle, colData);
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Notebook scanning
    // Builds the sections[] and unfiledPages[] on the notebook object.
    //
    // Hierarchy — three levels, nothing deeper:
    //   Notebook root
    //     ├─ <Section>/            (top-level directory → Section)
    //     │    ├─ Page.md          (direct page of the section)
    //     │    └─ <Sub-section>/   (folder one level deep → Sub-section)
    //     │         ├─ Page.md
    //     │         └─ <any deeper folders>/…   not sections: their .md files simply
    //     │                                    count as pages of this sub-section
    //     └─ Page.md               (unfiled page at notebook root)
    // ─────────────────────────────────────────────────────────────────────────

    /** One directory level: its .md files and its sub-folders (dot-names skipped), in listing order. */
    async _readDir(dir) {
        const files = [], dirs = [];
        for await (const [name, entry] of dir.entries()) {
            if (name.startsWith('.')) continue;   // includes the .cento-notebook.json session file
            if (entry.kind === 'directory') dirs.push([name, entry]);
            else if (name.endsWith('.md'))  files.push([name, entry]);
        }
        return { files, dirs };
    },

    _makePage(name, path, handle) {
        return { name, title: name.replace(/\.md$/, ''), path, handle };
    },

    async _scanNotebook(nb) {
        const { files, dirs } = await this._readDir(nb.handle);
        const sections = [];
        for (const [name, entry] of dirs) {
            const { pages, subsections } = await this._scanSectionTopLevel(entry, name);
            sections.push({ name, handle: entry, path: name, pages, subsections });
        }
        nb.sections     = sections.sort(byName);
        nb.unfiledPages = files.map(([name, fh]) => this._makePage(name, name, fh)).sort(byName);
    },

    /**
     * Scan a section's top level. .md files become the section's direct pages; each directory
     * becomes a sub-section whose pages are every .md file anywhere beneath it.
     */
    async _scanSectionTopLevel(sectionHandle, sectionPath) {
        const { files, dirs } = await this._readDir(sectionHandle);
        const pages = files.map(([name, fh]) => this._makePage(name, `${sectionPath}/${name}`, fh)).sort(byTitle);
        const subsections = [];
        for (const [name, dh] of dirs) {
            const path = `${sectionPath}/${name}`;
            subsections.push({ name, handle: dh, path, pages: (await this._collectPages(dh, path)).sort(byTitle) });
        }
        return { pages, subsections: subsections.sort(byName) };
    },

    /** Every .md file in `dir` and in all folders beneath it, as one flat list. Folders deeper than
     *  a sub-section are not part of the hierarchy — only the notes inside them count. */
    async _collectPages(dir, basePath) {
        const { files, dirs } = await this._readDir(dir);
        const pages = files.map(([name, fh]) => this._makePage(name, joinPath(basePath, name), fh));
        for (const [name, dh] of dirs) pages.push(...await this._collectPages(dh, joinPath(basePath, name)));
        return pages;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Page navigation
    // ─────────────────────────────────────────────────────────────────────────

    async openPage(pagePath, handle, columnsData = []) {
        if (!handle) return;
        const content = await readFile(handle);

        // If no columnsData was supplied, try the notebook session
        if (!columnsData.length && this.activeNotebookId) {
            const nb = this.activeNotebook;
            const stored = nb?.session?.pageStates?.[pagePath]?.columns;
            if (stored) columnsData = stored;
        }

        this.activePage       = pagePath;
        this.activePageHandle = handle;
        this.activePageDirty  = false;
        this.activeIsDrawer   = false;

        // Remember which page was last open in this section+sub-section
        // (so section/sub-section tab switches can restore it). The key is
        // "Section" when no sub-section is active, or "Section/Subsection" —
        // this preserves backward-compat with old sessions that only used
        // the section name as the key.
        if (this.activeNotebookId && this.activeSection) {
            const nb = this.activeNotebook;
            if (nb) {
                (this._session(nb).sectionLastPage ??= {})[this._subsectionKey(this.activeSection, this.activeSubsection)] = pagePath;
            }
        }

        // Push to in-memory navigation history unless we're executing a back/forward jump
        if (!this._navigating) {
            this._pushHistory({
                notebookId: this.activeNotebookId,
                section:     this.activeSection,
                subsection:  this.activeSubsection,
                pagePath, handle
            });
        }

        const editorEl = $('editor');
        this._showEditor(true);

        editorEl.editorMode = this.editorMode;
        editorEl.load(content, columnsData);

        this._renderToolbar();
        this.renderPageList(this.activeSection, this.activeSubsection);
        if (this.outlineVisible) this._renderOutline();
        this.scheduleNotebookSessionSave(this.activeNotebookId);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Session persistence  (one .cento-notebook.json per notebook)
    // ─────────────────────────────────────────────────────────────────────────

    async _loadNotebookSession(nb) {
        try {
            const fh   = await nb.handle.getFileHandle(NOTEBOOK_SESSION);
            const text = await readFile(fh);
            nb.session = JSON.parse(text);
        } catch { nb.session = {}; }

        const s = nb.session;
        if (s.sidebarWidth)      this.sidebarWidth      = s.sidebarWidth;
        if (s.pageListWidth)     this.pageListWidth      = s.pageListWidth;
        if (s.rightSidebarWidth) this.rightSidebarWidth  = s.rightSidebarWidth;
        if (s.outlineVisible !== undefined) this.outlineVisible = s.outlineVisible;

        // Typography is per-notebook; fall back to defaults for any role not stored.
        this.typography = Object.fromEntries(Object.entries(TYPOGRAPHY_DEFAULTS)
            .map(([role, defaults]) => [role, { ...defaults, ...(s.typography?.[role] || {}) }]));
        this._applyTypography();
        this._applyWidths();
    },

    async saveNotebookSession(notebookId) {
        const nb = this.notebooks.find(n => n.id === notebookId);
        if (!nb || nb.needsPermission) return;

        // Snapshot current page's editor state into pageStates
        const editorEl = $('editor');
        if (this.activePage && editorEl && !this.activeIsDrawer) {
            (this._session(nb).pageStates ??= {})[this.activePage] = { columns: editorEl.getColumnsState() };
        }

        const session = {
            activeSection:    this.activeSection,
            activeSubsection: this.activeSubsection,
            activePage:       this.activePage,
            sidebarWidth:     this.sidebarWidth,
            pageListWidth:    this.pageListWidth,
            rightSidebarWidth:this.rightSidebarWidth,
            outlineVisible:   this.outlineVisible,
            typography:       this.typography,
            sectionLastPage:  nb.session?.sectionLastPage  || {},
            sectionLastSubsection: nb.session?.sectionLastSubsection || {},
            pageStates:       nb.session?.pageStates       || {},
        };

        nb.session = session;
        try {
            const fh = await nb.handle.getFileHandle(NOTEBOOK_SESSION, { create: true });
            await writeFile(fh, JSON.stringify(session, null, 2));
        } catch {}
    },

    scheduleNotebookSessionSave(notebookId) {
        if (!notebookId) return;
        clearTimeout(this._sessionTimers[notebookId]);
        this._sessionTimers[notebookId] = setTimeout(() => this.saveNotebookSession(notebookId), SESSION_MS);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Save
    // ─────────────────────────────────────────────────────────────────────────

    scheduleAutoSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveActivePage(), AUTOSAVE_MS);
    },

    async saveActivePage() {
        const handle = this.activePageHandle;
        const editorEl = $('editor');
        if (!handle || !editorEl) return;

        this.saveStatus = 'saving';
        this._renderSaveStatus();
        try {
            await writeFile(handle, editorEl.getContent());
            this.activePageDirty = false;
            this.saveStatus = 'saved';
            this._renderSaveStatus();
            this._renderToolbar();
            setTimeout(() => {
                if (this.saveStatus === 'saved') { this.saveStatus = ''; this._renderSaveStatus(); }
            }, 2000);
            this.scheduleNotebookSessionSave(this.activeNotebookId);
        } catch (e) {
            this.saveStatus = '';
            this._renderSaveStatus();
            this.toast('Save failed: ' + e.message);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // New page
    // ─────────────────────────────────────────────────────────────────────────

    async newPage() {
        if (!this.activeNotebookId || !this.activeSection) return;
        const nb = this.activeNotebook;
        if (!nb) return;

        // Resolve the directory where the new page should be created:
        //   - active sub-section's directory  (when a sub-section is active)
        //   - section's directory             (otherwise)
        //   - notebook root                   (for the 'Unfiled' pseudo-section)
        // `basePath` is the folder path relative to the notebook root, used to
        // compute the new page's full path string for session/storage lookups.
        let dirHandle, basePath;
        if (this.activeSection === 'Unfiled') {
            dirHandle = nb.handle;
            basePath  = '';
        } else {
            const section = nb.sections.find(s => s.name === this.activeSection);
            if (!section) return;
            if (this.activeSubsection) {
                const sub = section.subsections?.find(s => s.name === this.activeSubsection);
                if (!sub) return;
                dirHandle = sub.handle;
                basePath  = sub.path;          // "Section/Sub"
            } else {
                dirHandle = section.handle;
                basePath  = section.path;      // "Section"
            }
        }

        const filename = await uniqueFilename(dirHandle, 'Untitled');
        const fh = await dirHandle.getFileHandle(filename, { create: true });
        await writeFile(fh, '');

        const pagePath = basePath ? `${basePath}/${filename}` : filename;

        await this._refreshAfterFsChange(nb);
        await this.openPage(pagePath, fh);

        // Enter rename mode immediately for the new page
        await new Promise(r => setTimeout(r, 50));
        const item = document.querySelector(`page-list-item[page-path="${CSS.escape(pagePath)}"]`);
        item?.setAttribute('renaming', '');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Rename
    // ─────────────────────────────────────────────────────────────────────────

    async commitRename(pagePath, newTitle) {
        if (!newTitle?.trim()) return;
        const nb = this.activeNotebook;
        if (!nb) return;

        const node = this._findPageByPath(nb, pagePath);
        if (!node?.handle) return;

        const newName = newTitle.trim().replace(/\.md$/, '') + '.md';
        if (newName === node.name) return;

        const parent = parentPath(pagePath);
        try {
            const dirHandle = parent ? await resolveDir(nb.handle, parent) : nb.handle;
            try { await dirHandle.getFileHandle(newName); this.toast('A file with that name already exists.'); return; } catch {}

            await this._flushActivePage();   // unsaved edits reach the file before it is copied
            const content = await readFile(node.handle);
            const newFh   = await dirHandle.getFileHandle(newName, { create: true });
            await writeFile(newFh, content);
            await dirHandle.removeEntry(node.name);

            // Point every saved reference (open page, history, session) at the new name
            this._remapNotebookPaths(nb, pagePath, joinPath(parent, newName), { sameTab: true });
            await this._refreshAfterFsChange(nb);   // also re-resolves the open page's file handle
        } catch (e) { this.toast('Rename failed: ' + e.message); }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Delete
    // ─────────────────────────────────────────────────────────────────────────

    async deleteNode(node) {
        if (!await this._confirm(`Permanently delete "${node.name}"?`)) return;

        const nb = this.activeNotebook;
        if (!nb) return;

        const parent     = parentPath(node.path || '');
        const hadActive  = !!this.activePage && !this.activeIsDrawer && this.activePage === node.path;
        if (hadActive) clearTimeout(this._saveTimer);   // a pending autosave must not target the deleted file
        try {
            const dirHandle = parent ? await resolveDir(nb.handle, parent) : nb.handle;
            await dirHandle.removeEntry(node.name, { recursive: true });
        } catch (e) { this.toast('Delete failed: ' + e.message); return; }

        this._forgetPaths(nb, node.path);   // saved editor state, last-page-per-tab
        this._dropHistory(nb, node.path);   // Back/Forward must not point at a file that is gone
        if (hadActive) {
            this.activePage       = null;
            this.activePageHandle = null;
            this.activePageDirty  = false;
            this._showEditor(false);
        }
        await this._refreshAfterFsChange(nb);
        this._renderToolbar();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Editor mode toggle
    // ─────────────────────────────────────────────────────────────────────────

    toggleEditorMode() {
        this.editorMode = this.editorMode === 'live' ? 'preview' : 'live';
        const ed = $('editor');
        if (ed) ed.editorMode = this.editorMode;
        this._renderToolbar();
        this.scheduleNotebookSessionSave(this.activeNotebookId);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Rendering helpers — each updates only its own DOM slice
    // ─────────────────────────────────────────────────────────────────────────

    _renderToolbar() {
        const hasNotebook = !!this.activeNotebookId;
        const hasPage     = !!this.activePageHandle;
        const editorEl    = $('editor');
        const colCount    = editorEl ? editorEl.getColumnCount() : 0;

        $('btn-new-page').disabled = !hasNotebook || !this.activeSection;
        this._renderNavButtons();

        // Toolbar-right buttons: only visible when a page is open
        const show = el => { if (el) el.style.display = hasPage ? '' : 'none'; };
        ['btn-toggle-preview', 'btn-save', 'btn-toggle-outline',
         'btn-add-column', 'btn-remove-column']
            .forEach(id => show($(id)));

        if (hasPage) {
            const isPreview = this.editorMode === 'preview';
            const btnPrev   = $('btn-toggle-preview');
            btnPrev.classList.toggle('active', isPreview);
            btnPrev.dataset.tip = isPreview ? 'Live Preview' : 'Preview Mode';
            btnPrev.querySelector('.svg-eye').style.display  = isPreview ? 'none' : '';
            btnPrev.querySelector('.svg-edit').style.display = isPreview ? ''     : 'none';

            $('btn-toggle-outline').classList.toggle('active', this.outlineVisible);

            const btnAdd = $('btn-add-column');
            const btnRem = $('btn-remove-column');
            btnAdd.disabled = colCount >= 4;
            btnRem.disabled = colCount <= 1;
            btnAdd.dataset.tip = colCount >= 4 ? 'Max 4 columns' : `Add Column (${colCount}/4)`;
            btnRem.dataset.tip = colCount <= 1 ? 'Only one column' : 'Remove Last Column';
        }
    },

    _renderSaveStatus() {
        const el = $('save-indicator');
        el.className  = this.saveStatus;
        el.textContent = this.saveStatus === 'saving' ? 'saving…'
                       : this.saveStatus === 'saved'  ? 'saved' : '';
    },

    _renderSidebar() {
        const isNB = this.sidebarView === 'notebooks';
        $('panel-notebooks').style.display = isNB  ? '' : 'none';
        $('panel-search').style.display    = isNB  ? 'none' : '';
        $('btn-sidebar-notebooks').classList.toggle('active',  isNB);
        $('btn-sidebar-search').classList.toggle('active', !isNB);
    },

    /** Repopulate the notebook list with <notebook-entry> custom elements */
    renderNotebookList() {
        const list = $('notebook-list');
        const msg  = $('no-notebook-msg');
        const real = this.notebooks.filter(n => !n.needsPermission);
        const pend = this.notebooks.filter(n =>  n.needsPermission);

        msg.style.display = this.notebooks.length ? 'none' : '';
        // Remove old entries (but keep msg and drawer-section)
        list.querySelectorAll('notebook-entry, .notebook-pending').forEach(el => el.remove());

        real.forEach(nb => {
            const entry = document.createElement('notebook-entry');
            entry.setAttribute('name', nb.name);
            entry.setAttribute('notebook-id', String(nb.id));
            // Notebook only reads as "active" when we're actually viewing it —
            // not while the Drawer is showing an isolated file.
            if (nb.id === this.activeNotebookId && !this.activeIsDrawer) entry.setAttribute('active', '');
            //list.insertBefore(entry, $('drawer-section'));
            list.appendChild(entry);
        });

        // "Needs permission" items shown as dim clickable rows
        pend.forEach(nb => {
            const div = document.createElement('div');
            div.className = 'notebook-pending';
            div.title = 'Click to reconnect';
            div.innerHTML = `<span class="pending-icon">⚠</span> <span class="pending-name">${escapeHtml(nb.name)}</span>`;
            div.addEventListener('click', () => this.switchToNotebook(nb.id));
            //list.insertBefore(div, $('drawer-section'));
            list.appendChild(div);
        });

        // Drawer header reads as "active" while a Drawer file is being viewed
        const drawerHdr = document.querySelector('.drawer-section-header');
        if (drawerHdr) drawerHdr.classList.toggle('drawer-active', this.activeIsDrawer);
    },

    /** Update the <section-tabs> custom element attributes */
    renderSectionTabs(notebookId) {
        const el = $('section-tabs-el');
        if (!el) return;
        const nb = this.notebooks.find(n => n.id === notebookId);
        if (!nb) { el.style.display = 'none'; return; }

        const sections = nb.sections.map(s => ({ name: s.name }));
        if (nb.unfiledPages.length) sections.push({ name: 'Unfiled' });

        el.style.display = sections.length ? '' : 'none';
        el.setAttribute('sections', JSON.stringify(sections));
        el.setAttribute('active-section', this.activeSection || '');

        // Update the page-list panel header to reflect section + sub-section
        const hdr = $('page-list-section-name');
        if (hdr) hdr.textContent = this._pageListHeader(this.activeSection, this.activeSubsection);
    },

    /** Update the sub-section <section-tabs variant="subsection"> element.
     *  Only shown when the active section has ≥1 sub-section. The first tab
     *  is always the "Pages" pseudo-tab (PAGES_PSEUDO_TAB, labelled "Pages")
     *  which represents the section's direct .md files (activeSubsection=null). */
    renderSubsectionTabs(notebookId) {
        const el = $('subsection-tabs-el');
        if (!el) return;
        const nb = this.notebooks.find(n => n.id === notebookId);
        if (!nb) { el.style.display = 'none'; return; }

        // Sub-section row is only relevant for real sections (not 'Unfiled')
        // and only when that section actually has sub-sections.
        const section = this.activeSection && this.activeSection !== 'Unfiled'
            ? nb.sections.find(s => s.name === this.activeSection)
            : null;
        if (!section || !section.subsections?.length) {
            el.style.display = 'none';
            el.setAttribute('sections', '[]');
            el.setAttribute('active-section', '');
            return;
        }

        // Build tab list: pseudo-tab "Pages" + one tab per sub-section.
        // The pseudo-tab uses a reserved sentinel name (PAGES_PSEUDO_TAB) so
        // it can never collide with a real sub-section folder name; the
        // <section-tabs> component displays it as "Pages" via sec.label.
        const tabs = [
            { name: PAGES_PSEUDO_TAB, label: 'Pages' },
            ...section.subsections.map(s => ({ name: s.name }))
        ];
        el.style.display = '';
        el.setAttribute('sections', JSON.stringify(tabs));
        // When activeSubsection is null, the "Pages" pseudo-tab is the active one.
        el.setAttribute('active-section', this.activeSubsection || PAGES_PSEUDO_TAB);
    },

    /** Rebuild the <page-list-item> tree for the given section + sub-section.
     *  If subsectionName is omitted, falls back to this.activeSubsection. */
    renderPageList(sectionName, subsectionName) {
        const listEl = $('page-list-component');
        const hdr    = $('page-list-section-name');
        if (!listEl) return;

        listEl.innerHTML = '';

        // Resolve which sub-section to render: explicit arg > activeSubsection > null
        const subsection = subsectionName !== undefined ? subsectionName : this.activeSubsection;
        if (hdr) hdr.textContent = this._pageListHeader(sectionName, subsection);

        if (!sectionName || !this.activeNotebookId) return;
        const nb = this.activeNotebook;
        if (!nb) return;

        const pages = this._getActivePages(nb, sectionName, subsection);
        pages.forEach(page => listEl.appendChild(this._buildPageItem(page)));
    },

    _buildPageItem(page) {
        const item = document.createElement('page-list-item');
        item.setAttribute('title', page.title);
        item.setAttribute('page-path', page.path);
        if (page.path === this.activePage) item.setAttribute('active', '');
        return item;
    },

    // ── Sub-section helpers ──────────────────────────────────────────────────
    // These centralize the section+subsection logic so callers (rendering,
    // navigation, search, history, session) all stay consistent.

    /** Page-list panel header text: "Section" or "Section / Subsection". */
    _pageListHeader(section, subsection) {
        if (!section) return '';
        if (subsection) return `${section} / ${subsection}`;
        return section;
    },

    /** Composite key used for the per-(section,subsection) "last page" map.
     *  Returns just the section name when no sub-section is active, which
     *  preserves backward-compat with old session files. */
    _subsectionKey(section, subsection) {
        return subsection ? `${section}/${subsection}` : section;
    },

    /** Return the PageNode tree to display in the page list for the given
     *  section + sub-section. For 'Unfiled', returns nb.unfiledPages.
     *  For a real section with a sub-section, returns that sub-section's pages.
     *  Otherwise returns the section's direct pages. */
    _getActivePages(nb, sectionName, subsection) {
        if (sectionName === 'Unfiled') return nb.unfiledPages;
        const section = nb.sections.find(s => s.name === sectionName);
        if (!section) return [];
        if (subsection) {
            return section.subsections?.find(s => s.name === subsection)?.pages || [];
        }
        return section.pages;
    },

    /** Resolve which sub-section should be active when entering a section:
     *  - undefined session entry → default to the first sub-section
     *  - null session entry      → user previously chose "Pages" (direct pages)
     *  - a string                → restore that sub-section (if it still exists)
     *  - section has no sub-sections → always null
     *  Returns the sub-section name, or null. */
    _resolveActiveSubsection(nb, sectionName) {
        const section = nb.sections.find(s => s.name === sectionName);
        if (!section?.subsections?.length) return null;
        const stored = nb.session?.sectionLastSubsection?.[sectionName];
        if (stored === undefined) return section.subsections[0].name;
        if (stored === null) return null;
        if (section.subsections.find(s => s.name === stored)) return stored;
        // Stored sub-section no longer exists (renamed/deleted on disk) — fall
        // back to the first available sub-section.
        return section.subsections[0].name;
    },

    /** Persist the user's last-active sub-section choice for a section, so
     *  switching away and back restores the same sub-section. Stores null
     *  explicitly to record the "Pages" pseudo-tab choice. */
    _rememberLastSubsection(sectionName, subsectionName) {
        if (!this.activeNotebookId || !sectionName) return;
        const nb = this.activeNotebook;
        if (!nb) return;
        (this._session(nb).sectionLastSubsection ??= {})[sectionName] = subsectionName;
    },

    /** Set both activeSection and activeSubsection at once, re-rendering the
     *  tab rows and page list. Used by link navigation (wikilinks, cento:
     *  protocol, search results) to jump to a page wherever it lives. */
    _setActiveSectionAndSubsection(section, subsection) {
        const sub = subsection || null;
        if (this.activeSection === section && this.activeSubsection === sub) return;
        this.activeSection = section;
        this.activeSubsection = sub;
        this.renderSectionTabs(this.activeNotebookId);
        this.renderSubsectionTabs(this.activeNotebookId);
        this.renderPageList(section, sub);
        this._rememberLastSubsection(section, sub);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Sidebar view toggle
    // ─────────────────────────────────────────────────────────────────────────

    setSidebarView(view) {
        this.sidebarView = view;
        this._renderSidebar();
        this.scheduleNotebookSessionSave(this.activeNotebookId);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Search  (searches the active notebook only)
    // ─────────────────────────────────────────────────────────────────────────

    async runSearch() {
        if (!this.activeNotebookId || !this.searchQuery.trim()) return;
        const nb = this.activeNotebook;
        if (!nb) return;
        this.searchResults = [];
        this.searchRan     = true;
        // Search every page in the notebook: each section's direct pages,
        // each sub-section's pages, and the unfiled pages at the notebook root.
        for (const section of nb.sections) {
            await this._searchPages(section.pages, this.searchQuery.toLowerCase());
            for (const sub of section.subsections || []) {
                await this._searchPages(sub.pages, this.searchQuery.toLowerCase());
            }
        }
        await this._searchPages(nb.unfiledPages, this.searchQuery.toLowerCase());
        this._renderSearchResults();
    },

    async _searchPages(pages, query) {
        for (const page of pages) {
            if (page.handle && page.path) {
                try {
                    const text  = await readFile(page.handle);
                    const lines = text.split('\n');
                    const idx   = lines.findIndex(l => l.toLowerCase().includes(query));
                    if (idx !== -1) {
                        const line  = lines[idx];
                        const pos   = line.toLowerCase().indexOf(query);
                        const start = Math.max(0, pos - 40);
                        const end   = Math.min(line.length, pos + query.length + 40);
                        const snip  = (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
                        const hl    = highlightMatches(snip, query);
                        this.searchResults.push({ path: page.path, handle: page.handle, title: page.title, context: hl });
                    }
                } catch {}
            }
        }
    },

    _renderSearchResults() {
        const list  = $('search-results-list');
        const empty = $('search-empty');
        list.innerHTML = '';
        empty.style.display = (this.searchRan && !this.searchResults.length) ? '' : 'none';
        for (const r of this.searchResults) {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `<div class="search-result-title">${escapeHtml(r.title)}</div>
                             <div class="search-result-context">${r.context}</div>`;
            // When a search result is clicked, switch the section + sub-section
            // tabs to where the page lives before opening it, so the user sees
            // the correct context in the page list and tab rows.
            div.addEventListener('click', async () => {
                const nb = this.activeNotebook;
                const loc = nb ? this._findNoteWithSection(nb, { path: r.path }) : null;
                if (loc) this._setActiveSectionAndSubsection(loc.section, loc.subsection);
                await this.openPage(r.path, r.handle);
            });
            list.appendChild(div);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Link navigation
    // ─────────────────────────────────────────────────────────────────────────

    async handleLinkClick({ href, isWiki, isProto }) {
        if (isProto) {
            const parts  = href.split('/');
            const nb     = this.notebooks.find(n => n.name === parts[0]);
            if (!nb) { this.toast(`Open notebook "${parts[0]}" to follow this link.`); return; }
            await this._gotoPage(nb, { path: parts.slice(1).join('/') + '.md' }, `Page not found: ${href}`);
            return;
        }
        if (!isWiki && APP_LINK_RE.test(href)) { openExternalApp(href); return; }   // Preview and Live Preview both land here
        const nb = this.activeNotebook;
        if (!nb) return;
        if (isWiki) return this._gotoPage(nb, { title: href }, `Page not found: [[${href}]]`);
        if (/^https?:\/\//.test(href)) { window.open(href, '_blank'); return; }
        await this._gotoPage(nb, { path: href }, `Page not found: ${href}`);
    },

    /** Open the page found by { title } or { path }, first switching notebook, section and
     *  sub-section so the tabs and page list sync up. Toasts notFound if there is no such page. */
    async _gotoPage(nb, query, notFound) {
        const found = this._findNoteWithSection(nb, query);
        if (!found?.node?.handle) { this.toast(notFound); return; }
        if (nb.id !== this.activeNotebookId) await this.switchToNotebook(nb.id);
        this._setActiveSectionAndSubsection(found.section, found.subsection);
        await this.openPage(found.node.path, found.node.handle);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Node lookup helpers
    // All three walk both a section's direct pages AND every sub-section's
    // page tree, so a page can be found no matter which sub-section it lives in.
    // ─────────────────────────────────────────────────────────────────────────

    /** Every list of pages in a notebook, with where it lives: each section's direct pages,
     *  each sub-section's pages, then the unfiled pages. Lookups all walk this one sequence. */
    *_pageRoots(nb) {
        for (const section of nb.sections) {
            yield { pages: section.pages, section: section.name, subsection: null };
            for (const sub of section.subsections || [])
                yield { pages: sub.pages, section: section.name, subsection: sub.name };
        }
        yield { pages: nb.unfiledPages, section: 'Unfiled', subsection: null };
    },

    /** First page matching pred, as { node, section, subsection } (or null). */
    _findPage(nb, pred) {
        for (const root of this._pageRoots(nb)) {
            const node = root.pages.find(pred);
            if (node) return { node, section: root.section, subsection: root.subsection };
        }
        return null;
    },

    _findPageByPath(nb, path) {
        return this._findPage(nb, p => p.path === path)?.node || null;
    },

    /** Find a page by title (wikilinks) or by path, and report which section (or 'Unfiled')
     *  and sub-section (or null) it lives in, so callers can switch both tab rows to match
     *  before opening it. */
    _findNoteWithSection(nb, { title, path } = {}) {
        const low = title ? title.toLowerCase() : null;
        return this._findPage(nb, p => (low ? p.title.toLowerCase() === low : p.path === path));
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Context menu
    // ─────────────────────────────────────────────────────────────────────────

    _showContextMenu(e, ctx) {
        e.preventDefault();
        const menu = $('context-menu');
        menu.querySelectorAll('.ctx-editor-item, .ctx-sep').forEach(el => el.remove());

        const showMove = on => { const m = $('ctx-move'); if (m) m.style.display = on ? '' : 'none'; };
        $('ctx-add-subsection').style.display = ctx.kind === 'tab' && ctx.tab.level === 'section' ? '' : 'none';
        if (ctx.kind === 'node') {
            this._ctxNode = ctx.node;
            this._ctxTab  = null;
            $('ctx-rename').style.display = '';
            $('ctx-delete').style.display = '';
            showMove(!!ctx.node.handle);
        } else if (ctx.kind === 'tab') {
            this._ctxNode = null;
            this._ctxTab  = ctx.tab;
            $('ctx-rename').style.display = '';
            $('ctx-delete').style.display = '';
            showMove(false);
        } else {
            this._ctxNode = null;
            this._ctxTab  = null;
            $('ctx-rename').style.display = 'none';
            $('ctx-delete').style.display = 'none';
            showMove(false);

            const isPreview = this.editorMode === 'preview';
            const editorEl  = $('editor');
            const hasSel    = isPreview
                ? (window.getSelection()?.toString().length ?? 0) > 0
                : (editorEl?.getActiveCm()?.getSelection().length ?? 0) > 0;

            const items = isPreview
                ? [{ action: 'cento-link', label: 'Get Cento link', needsSel: false },
                   { sep: true },
                   { action: 'copy', label: 'Copy', needsSel: true }]
                : [{ action: 'cento-link', label: 'Get Cento link', needsSel: false },
                   { sep: true },
                   { action: 'copy',       label: 'Copy',        needsSel: true  },
                   { action: 'cut',        label: 'Cut',         needsSel: true  },
                   { action: 'paste',      label: 'Paste',       needsSel: false },
                   { sep: true },
                   { action: 'bold',       label: 'Bold',        needsSel: true  },
                   { action: 'italic',     label: 'Italic',      needsSel: true  },
                   { action: 'highlight',  label: 'Highlight',   needsSel: true  },
                   { action: 'superscript',label: 'Superscript', needsSel: true  },
                   { action: 'subscript',  label: 'Subscript',   needsSel: true  },
                   { sep: true },
                   { action: 'blockquote', label: 'Block Quote', needsSel: true  },
                   { action: 'codeblock',  label: 'Code Block',  needsSel: true  }];

            items.forEach(item => {
                if (item.sep) {
                    const sep = document.createElement('div');
                    sep.className = 'ctx-sep';
                    menu.appendChild(sep);
                } else {
                    const el  = document.createElement('div');
                    const dis = item.needsSel && !hasSel;
                    el.className        = 'ctx-item ctx-editor-item' + (dis ? ' ctx-disabled' : '');
                    el.dataset.action   = item.action;
                    el.dataset.disabled = dis ? 'true' : 'false';
                    el.textContent      = item.label;
                    menu.appendChild(el);
                }
            });
        }

        menu.classList.add('show');
        menu.style.left = '0'; menu.style.top = '0';
        const mw = menu.offsetWidth, mh = menu.offsetHeight;

        // e may be a CustomEvent (from Shadow DOM) that carries coords in detail,
        // or a regular MouseEvent that has them directly.
        const mx = e.clientX ?? e.detail?.x ?? 0;
        const my = e.clientY ?? e.detail?.y ?? 0;
        menu.style.left = Math.min(mx, window.innerWidth  - mw - 8) + 'px';
        menu.style.top  = Math.min(my, window.innerHeight - mh - 8) + 'px';
    },

    _hideContextMenu() {
        $('context-menu').classList.remove('show');
        this._ctxNode = null; this._ctxTab = null;
        $('ctx-rename').style.display = '';
        $('ctx-delete').style.display = '';
        const mv = $('ctx-move'); if (mv) mv.style.display = 'none';
        $('ctx-add-subsection').style.display = 'none';
    },

    _handleEditorCtxAction(action) {
        const nb = this.activeNotebook;
        const getClink = () => {
            if (!nb || !this.activePage) return;
            const link = `web+cento://link?view=${nb.name}/${this.activePage.replace(/\.md$/, '')}`;
            navigator.clipboard.writeText(link).catch(() => {});
            this.toast('Cento link copied.');
        };

        if (this.editorMode === 'preview') {
            if (action === 'copy') { const sel = window.getSelection()?.toString(); if (sel) copyText(sel); }
            if (action === 'cento-link') getClink();
            return;
        }

        const cm = $('editor')?.getActiveCm();
        if (!cm) return;
        const sel = cm.getSelection(), hasText = sel.length > 0;
        const wrap = (o, c) => { if (hasText) cm.replaceSelection(o + sel + c); };

        switch (action) {
            case 'copy':        if (hasText) copyText(sel); break;
            case 'cut':         if (hasText) { copyText(sel); cm.replaceSelection(''); } break;
            case 'paste':       cm.focus(); document.execCommand('paste'); break;
            case 'bold':        wrap('**', '**'); break;
            case 'italic':      wrap('*', '*'); break;
            case 'highlight':   wrap('==', '=='); break;
            case 'superscript': wrap('^', '^'); break;
            case 'subscript':   wrap('~', '~'); break;
            case 'blockquote':  { if (!hasText) break; const from = cm.getCursor('from'), to = cm.getCursor('to'); cm.operation(() => { for (let ln = from.line; ln <= to.line; ln++) if (!cm.getLine(ln).startsWith('> ')) cm.replaceRange('> ', {line:ln,ch:0}, {line:ln,ch:0}); }); break; }
            case 'codeblock':   { if (!hasText) break; cm.replaceSelection('```\n' + sel + (sel.endsWith('\n') ? '' : '\n') + '```'); break; }
            case 'cento-link':  getClink(); break;
        }
        cm.focus();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Drawer  (files opened from the OS via the File Handling API)
    // ─────────────────────────────────────────────────────────────────────────

    async _openLaunchFile(fileHandle) {
        const name = fileHandle.name;
        if (!name.endsWith('.md')) return;
        const path  = 'drawer:' + name;
        const title = name.replace(/\.md$/, '');

        if (this.drawerFiles.find(f => f.path === path)) {
            // Already in drawer — just open it
            if (this.activePage !== path) await this._openDrawerFile(fileHandle, path, title);
            return;
        }
        this.drawerFiles.push({ name, path, title, handle: fileHandle });
        this.renderDrawer();
        await this._openDrawerFile(fileHandle, path, title);
    },

    async _openDrawerFile(handle, path, title) {
        const content = await readFile(handle);
        this.activePage       = path;
        this.activePageHandle = handle;
        this.activePageDirty  = false;
        this.activeIsDrawer   = true;

        const editorEl = $('editor');
        this._showEditor(true);
        editorEl.load(content, []);
        this._renderToolbar();
        this.renderDrawer();
        this.renderNotebookList();   // clears the "active" highlight on the notebook entry
        this._applyWidths();         // slides the page-list panel & section tabs away
    },

    async removeDrawerFile(path) {
        // If this is the active page and it's dirty, confirm before closing
        if (this.activePage === path && this.activePageDirty) {
            if (!await this._confirm('This file has unsaved changes. Remove from Drawer anyway?')) return;
        }
        this.drawerFiles = this.drawerFiles.filter(f => f.path !== path);
        if (this.activePage === path) {
            this.activePage = null; this.activePageHandle = null; this.activeIsDrawer = false;
            this._showEditor(false);
            this.renderNotebookList();
            this._applyWidths();
        }
        this.renderDrawer();
    },

    /** User clicks "Open File in Drawer" — picks a single .md file and adds it
     *  to the Drawer, independent of any open notebook. */
    async openFileInDrawer() {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
                excludeAcceptAllOption: false,
                multiple: false,
            });
            await this._openLaunchFile(fileHandle);
        } catch (e) {
            if (e.name !== 'AbortError') this.toast('Could not open file: ' + e.message);
        }
    },

    /** User clicks the "Drawer" header in the sidebar — switches the editor
     *  back to whichever Drawer file was last open, without touching the
     *  active notebook (so switching back via a notebook name still works). */
    async showDrawerView() {
        if (!this.drawerFiles.length) return;
        // Re-open the currently active drawer file if there is one, else the most recent
        const current = this.drawerFiles.find(f => f.path === this.activePage);
        const target  = current || this.drawerFiles[this.drawerFiles.length - 1];
        await this._openDrawerFile(target.handle, target.path, target.title);
    },

    renderDrawer() {
        const section = $('drawer-section');
        const list    = $('drawer-list');
        if (!section || !list) return;
        if (!this.drawerFiles.length) { section.style.display = 'none'; return; }

        section.style.display = '';
        list.innerHTML = '';
        for (const file of this.drawerFiles) {
            const isActive = this.activePage === file.path && this.activeIsDrawer;
            const row = document.createElement('div');
            row.className = 'tree-row' + (isActive ? ' active-file' : '');
            row.innerHTML = `<span style="width:12px;display:inline-block"></span>
                <svg class="tree-icon"><use href="#icon-file"/></svg>
                <span class="tree-label">${escapeHtml(file.title)}</span>
                <button class="drawer-remove-btn" title="Remove"><svg><use href="#icon-x"/></svg></button>`;
            row.addEventListener('click', e => {
                if (e.target.closest('.drawer-remove-btn')) return;
                this._openDrawerFile(file.handle, file.path, file.title);
            });
            row.querySelector('.drawer-remove-btn').addEventListener('click', e => {
                e.stopPropagation(); this.removeDrawerFile(file.path);
            });
            list.appendChild(row);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Toast & confirm dialog
    // ─────────────────────────────────────────────────────────────────────────

    toast(msg, duration = 3000) {
        const el = $('toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), duration);
    },

    _confirm(message) {
        return new Promise(resolve => {
            const dialog = $('confirm-dialog');
            $('confirm-message').textContent = message;
            // One AbortController removes all three listeners however the dialog ends: OK,
            // Cancel, or Esc (which closes a modal <dialog> without clicking anything).
            // Without the 'close' listener an Esc left the old OK handler attached, so the
            // NEXT confirmation's OK also ran the previous, cancelled action.
            const ac = new AbortController();
            const finish = result => { ac.abort(); if (dialog.open) dialog.close(); resolve(result); };
            $('confirm-ok').addEventListener('click', () => finish(true), { signal: ac.signal });
            $('confirm-cancel').addEventListener('click', () => finish(false), { signal: ac.signal });
            dialog.addEventListener('close', () => finish(false), { signal: ac.signal });
            dialog.showModal();
        });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Outline panel
    // ─────────────────────────────────────────────────────────────────────────

    _renderOutline() {
        const list = $('outline-list');
        if (!list) return;
        list.innerHTML = '';
        const editorEl = $('editor');
        const cms      = editorEl?.getColumnCms();
        if (!cms?.length) { list.innerHTML = '<div class="outline-empty">No note open.</div>'; return; }

        const headings = [];
        cms.forEach((cm, colIdx) => {
            cm.getValue().split('\n').forEach((line, localLine) => {
                const m = line.match(/^(#{1,6}) (.*)/);
                if (m) headings.push({ level: m[1].length, text: m[2].trim(), colIdx, localLine, cm });
            });
        });

        if (!headings.length) { list.innerHTML = '<div class="outline-empty">No headings found.</div>'; return; }

        for (const h of headings) {
            const item = document.createElement('div');
            item.className = `outline-item ol-h${h.level}`;
            item.textContent = h.text; item.title = h.text;
            item.addEventListener('click', () => {
                h.cm.setCursor({ line: h.localLine, ch: 0 });
                h.cm.scrollIntoView({ line: h.localLine, ch: 0 }, 100);
                if (this.editorMode === 'live') {
                    h.cm.focus();
                    editorEl.setActiveColumn(h.colIdx);
                }
            });
            list.appendChild(item);
        }
    },

    toggleOutline() {
        this.outlineVisible = !this.outlineVisible;
        this._applyWidths();
        if (this.outlineVisible) this._renderOutline();
        this._renderToolbar();
        this.scheduleNotebookSessionSave(this.activeNotebookId);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Panel widths  (left sidebar / page-list / outline)
    // ─────────────────────────────────────────────────────────────────────────

    _applyWidths() {
        const ls  = $('sidebar');
        const pl  = $('page-list-panel');
        const rs  = $('right-sidebar');
        const rhr = $('resize-right');
        const rpg = $('resize-page');
        const st  = $('section-tabs-el');
        const sst = $('subsection-tabs-el');

        if (ls)  ls.style.width  = this.sidebarWidth + 'px';

        // The page-list panel and section tabs are only shown when a
        // notebook page (not a Drawer file) is the active view. The sub-section
        // tabs row collapses the same way so both strips slide up/away together
        // when the user enters Drawer view.
        const showNotebookChrome = !!this.activeNotebookId && !this.activeIsDrawer;
        if (pl) {
            pl.style.display = '';   // clear any stale inline display:none from older code paths
            pl.classList.toggle('panel-collapsed', !showNotebookChrome);
            if (showNotebookChrome) pl.style.width = this.pageListWidth + 'px';
        }
        if (rpg) rpg.classList.toggle('handle-collapsed', !showNotebookChrome);
        if (st)  st.classList.toggle('tabs-collapsed', !showNotebookChrome);
        if (sst) sst.classList.toggle('tabs-collapsed', !showNotebookChrome);

        if (rs)  { rs.style.display  = this.outlineVisible ? '' : 'none'; if (this.outlineVisible) rs.style.width = this.rightSidebarWidth + 'px'; }
        if (rhr) rhr.style.display   = this.outlineVisible ? '' : 'none';
    },

    /** Push this.typography onto CSS custom properties. These vars are read
     *  by both the CodeMirror editor (.cm-h1/h2/h3, .CodeMirror) and the
     *  Preview pane (.preview-content h1/h2/h3), so the two stay identical —
     *  this is the single point of truth for note typography. */
    _applyTypography() {
        const root  = document.documentElement.style;
        const find  = id => FONT_CATALOG.find(f => f.id === id) || FONT_CATALOG[0];
        for (const role of ['body', 'h1', 'h2', 'h3']) {
            const t = this.typography[role] || TYPOGRAPHY_DEFAULTS[role];
            root.setProperty(`--note-font-${role}`,   find(t.font).stack);
            root.setProperty(`--note-size-${role}`,   t.size + 'px');
            root.setProperty(`--note-weight-${role}`, String(t.weight));
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Theme  (toggle between 'dark' and 'cream')
    // ─────────────────────────────────────────────────────────────────────────

    /** Apply a theme by name. Sets data-theme on <html> (which the [data-theme]
     *  blocks in looks.css pick up), updates the toggle button's icon so it
     *  always shows the theme you'd switch TO, and persists the choice to IDB.
     *  No-op for unknown theme names. */
    applyTheme(theme) {
        if (!THEMES.includes(theme)) return;
        this.activeTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this._renderThemeButton();
        // Persist asynchronously — fire and forget; the toggle feels instant.
        dbSetTheme(theme).catch(e => console.warn('Cento: could not save theme', e));
    },

    /** Flip between the two themes. */
    toggleTheme() {
        const next = this.activeTheme === 'dark' ? 'cream' : 'dark';
        this.applyTheme(next);
    },

    /** Update the theme button's icon + tooltip to reflect the current theme.
     *  Icon convention: show the icon of the theme you'd switch TO —
     *  sun when in dark (click → cream/light), moon when in cream (click → dark). */
    _renderThemeButton() {
        const btn  = $('btn-theme');
        if (!btn) return;
        const sun  = btn.querySelector('.svg-sun');
        const moon = btn.querySelector('.svg-moon');
        const isDark = this.activeTheme === 'dark';
        if (sun)  sun.style.display  = isDark ? '' : 'none';
        if (moon) moon.style.display = isDark ? 'none' : '';
        btn.dataset.tip = isDark ? 'Switch to Cream Theme' : 'Switch to Dark Theme';
    },

    /** Wire up the Settings dialog: role tabs, font grid, size slider,
     *  weight chips, live preview, and Apply / Reset actions. The dialog
     *  edits a working draft (this._settingsDraft) so Cancel/close without
     *  Apply leaves the saved typography untouched. */
    _initSettingsModal() {
        const dialog   = $('settings-dialog');
        const grid      = $('settings-font-grid');
        const weightRow = $('settings-weight-row');
        const sizeSlider= $('settings-size-slider');
        const sizeValue = $('settings-size-value');
        const preview   = $('settings-preview-text');
        const roleTabs  = document.querySelectorAll('.settings-role-tab');

        let activeRole = 'body';

        const openDialog = () => {
            // Start each session editing a fresh copy of the current settings
            this._settingsDraft = structuredClone(this.typography);
            activeRole = 'body';
            roleTabs.forEach(t => t.classList.toggle('active', t.dataset.role === 'body'));
            renderRole();
            dialog.showModal();
        };

        const closeDialog = () => dialog.close();

        const renderRole = () => {
            const draft = this._settingsDraft[activeRole];
            const fontMeta = FONT_CATALOG.find(f => f.id === draft.font) || FONT_CATALOG[0];

            // Font grid
            grid.innerHTML = '';
            FONT_CATALOG.forEach(f => {
                const btn = document.createElement('button');
                btn.className = 'settings-font-option' + (f.id === draft.font ? ' active' : '');
                btn.innerHTML = `<span class="settings-font-name" style="font-family:${f.stack}">${f.label}</span>
                                  <span class="settings-font-tag">${f.tag}</span>`;
                btn.addEventListener('click', () => {
                    draft.font = f.id;
                    // Clamp weight to nearest available weight for the new font
                    const fm = FONT_CATALOG.find(x => x.id === f.id);
                    if (!fm.weights.includes(draft.weight)) {
                        draft.weight = fm.weights.reduce((closest, w) =>
                            Math.abs(w - draft.weight) < Math.abs(closest - draft.weight) ? w : closest, fm.weights[0]);
                    }
                    renderRole();
                });
                grid.appendChild(btn);
            });

            // Size slider
            sizeSlider.value = draft.size;
            sizeValue.textContent = draft.size;

            // Weight chips — only the weights this font actually has
            weightRow.innerHTML = '';
            fontMeta.weights.forEach(w => {
                const chip = document.createElement('button');
                chip.className = 'settings-weight-chip' + (w === draft.weight ? ' active' : '');
                chip.textContent = WEIGHT_NAMES[w] || w;
                chip.addEventListener('click', () => {
                    draft.weight = w;
                    renderRole();
                });
                weightRow.appendChild(chip);
            });

            // Live preview
            preview.style.fontFamily = fontMeta.stack;
            preview.style.fontSize   = draft.size + 'px';
            preview.style.fontWeight = draft.weight;
        };

        roleTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                activeRole = tab.dataset.role;
                roleTabs.forEach(t => t.classList.toggle('active', t === tab));
                renderRole();
            });
        });

        sizeSlider.addEventListener('input', () => {
            const draft = this._settingsDraft[activeRole];
            draft.size = Number(sizeSlider.value);
            sizeValue.textContent = draft.size;
            preview.style.fontSize = draft.size + 'px';
        });

        $('btn-settings').addEventListener('click', openDialog);
        $('btn-settings-close').addEventListener('click', closeDialog);
        dialog.addEventListener('click', e => { if (e.target === dialog) closeDialog(); });

        $('btn-settings-reset').addEventListener('click', () => {
            this._settingsDraft = structuredClone(TYPOGRAPHY_DEFAULTS);
            renderRole();
        });

        $('btn-settings-apply').addEventListener('click', () => {
            this.typography = this._settingsDraft;
            this._applyTypography();
            this.scheduleNotebookSessionSave(this.activeNotebookId);
            closeDialog();
        });
    },

    _initResizeDrag(handleEl, side) {
        if (!handleEl) return;
        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            handleEl.classList.add('dragging');
            const startX = e.clientX;
            const startW = side === 'left'  ? this.sidebarWidth
                         : side === 'page'  ? this.pageListWidth
                         :                    this.rightSidebarWidth;
            const onMove = e => {
                // 'left' grows rightward; 'page' and 'right' grow leftward
                const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
                const min   = side === 'page' ? 120 : 160;
                const newW  = Math.min(480, Math.max(min, startW + delta));
                if      (side === 'left')  this.sidebarWidth      = newW;
                else if (side === 'page')  this.pageListWidth      = newW;
                else                       this.rightSidebarWidth  = newW;
                this._applyWidths();
            };
            const onUp = () => {
                handleEl.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this.scheduleNotebookSessionSave(this.activeNotebookId);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Navigation history  (back / forward — in-memory only, clears on reload)
    // ─────────────────────────────────────────────────────────────────────────

    _pushHistory({ notebookId, section, subsection, pagePath, handle }) {
        // Discard everything after the current index (forward history is stale)
        this._navHistory = this._navHistory.slice(0, this._navIndex + 1);
        // Don't push a duplicate of the current entry
        const curr = this._navHistory[this._navIndex];
        if (curr && curr.pagePath === pagePath && curr.notebookId === notebookId) return;
        this._navHistory.push({ notebookId, section, subsection: subsection || null, pagePath, handle });
        if (this._navHistory.length > 50) this._navHistory.shift();
        this._navIndex = this._navHistory.length - 1;
    },

    _renderNavButtons() {
        const back    = $('btn-nav-back');
        const forward = $('btn-nav-forward');
        if (back)    back.disabled    = this._navIndex <= 0;
        if (forward) forward.disabled = this._navIndex >= this._navHistory.length - 1;
    },

    async navBack() {
        if (this._navIndex <= 0) return;
        this._navIndex--;
        await this._navTo(this._navHistory[this._navIndex]);
    },

    async navForward() {
        if (this._navIndex >= this._navHistory.length - 1) return;
        this._navIndex++;
        await this._navTo(this._navHistory[this._navIndex]);
    },

    async _navTo(entry) {
        this._navigating = true;
        try {
            // Switch notebook if needed
            if (entry.notebookId !== this.activeNotebookId)
                await this.switchToNotebook(entry.notebookId);
            // Switch section + sub-section if needed (both are part of the
            // history entry so back/forward restores the exact view).
            const targetSub = entry.subsection || null;
            if (entry.section !== this.activeSection || targetSub !== this.activeSubsection) {
                this.activeSection = entry.section;
                this.activeSubsection = targetSub;
                this.renderSectionTabs(entry.notebookId);
                this.renderSubsectionTabs(entry.notebookId);
                this.renderPageList(entry.section, this.activeSubsection);
            }
            await this.openPage(entry.pagePath, entry.handle);
        } finally {
            this._navigating = false;
        }
        this._renderNavButtons();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Default page for section/sub-section  (called when switching tabs)
    // Respects this.activeSubsection — opens the last-active page in the
    // current (section, sub-section) combo, else the first available page.
    // ─────────────────────────────────────────────────────────────────────────

    async _openDefaultPageForSection(sectionName) {
        const nb = this.activeNotebook;
        if (!nb) return;

        // Pages visible in the page list for the current (section, sub-section)
        const pages = this._getActivePages(nb, sectionName, this.activeSubsection);

        // Try the last page that was active in this section+sub-section.
        // The key is "Section" when no sub-section is active, or "Section/Sub".
        const lastKey  = this._subsectionKey(sectionName, this.activeSubsection);
        const lastPath = nb.session?.sectionLastPage?.[lastKey];
        if (lastPath) {
            const node = this._findPageByPath(nb, lastPath);
            if (node?.handle) { await this.openPage(lastPath, node.handle); return; }
        }

        // Fall back to the first available page in the current view
        const first = pages.find(p => !!p.handle);
        if (first) await this.openPage(first.path, first.handle);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Add section / sub-section
    // ─────────────────────────────────────────────────────────────────────────

    async addSection(sectionName) {
        const nb = this.activeNotebook;
        if (!nb) return;

        const base    = (sectionName || '').trim() || 'Untitled';
        const problem = this._badFolderName(base, 'section');
        if (problem) { this.toast(problem, 5000); return; }
        const name = this._uniqueName(base, nb.sections);   // a clash gets " 1", " 2"…

        try {
            await nb.handle.getDirectoryHandle(name, { create: true });
            this.activeSection    = name;
            this.activeSubsection = null;   // brand-new section has no sub-sections yet
            await this._refreshAfterFsChange(nb);   // rescans, then draws tabs + page list
            this.newPage();
        } catch (e) {
            this.toast('Could not create section: ' + e.message);
        }
    },

    /** Create a new sub-section folder inside the active section, then create
     *  a first page inside it and switch to it. Mirrors addSection() but one
     *  level deeper. No-op for the 'Unfiled' pseudo-section (which has no
     *  real folder to put a sub-section into). */
    async addSubsection(subsectionName) {
        if (!this.activeNotebookId || !this.activeSection) return;
        const nb = this.activeNotebook;
        if (!nb) return;
        const section = nb.sections.find(s => s.name === this.activeSection);
        if (!section) return;   // can't add a sub-section to 'Unfiled'

        const base    = (subsectionName || '').trim() || 'Untitled';
        const problem = this._badFolderName(base, 'sub-section');
        if (problem) { this.toast(problem, 5000); return; }
        const name = this._uniqueName(base, section.subsections || []);   // a clash gets " 1", " 2"…

        try {
            await section.handle.getDirectoryHandle(name, { create: true });
            this.activeSubsection = name;
            this._rememberLastSubsection(this.activeSection, name);
            await this._refreshAfterFsChange(nb);
            this.newPage();   // creates the first page inside the new sub-section
        } catch (e) {
            this.toast('Could not create sub-section: ' + e.message);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // New notebook
    // ─────────────────────────────────────────────────────────────────────────

    /** Choose an EMPTY folder (the system dialog's "New folder" button makes one) and turn it
     *  into a notebook: a single unfiled page, "page-1", plus its .cento-notebook.json. */
    async newNotebook() {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });

            for await (const _entry of handle.entries()) {
                this.toast(`"${handle.name}" isn't empty. To use an existing folder as a notebook, choose Open Notebook instead.`, 6000);
                return;
            }
            if (this.notebooks.some(n => n.name === handle.name)) {
                this.toast(`A notebook named "${handle.name}" is already open. Please choose a folder with a different name.`, 6000);
                return;
            }

            const pageName = 'page-1.md';
            const pageFh   = await handle.getFileHandle(pageName, { create: true });
            await writeFile(pageFh, '');

            const id = await dbAddNotebook(handle.name, handle);
            await this._mountNotebookRecord({ id, name: handle.name, handle });
            await this.switchToNotebook(id);        // no saved page yet, so this only selects the "Unfiled" tab...
            await this.openPage(pageName, pageFh);  // ...and we open page-1 ourselves
            await this.saveNotebookSession(id);     // write .cento-notebook.json now rather than after the debounce
        } catch (e) {
            if (e.name !== 'AbortError') this.toast('Could not create notebook: ' + e.message);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Shared bookkeeping for anything that renames / moves / deletes files
    // ─────────────────────────────────────────────────────────────────────────

    /** Write out unsaved edits first, so they can't be lost or land on a stale file handle. */
    async _flushActivePage() {
        clearTimeout(this._saveTimer);
        if (this.activePageDirty && this.activePageHandle && !this.activeIsDrawer) await this.saveActivePage();
    },

    /** Rewrite every saved reference to paths under oldPrefix so they point under newPrefix:
     *  the open page, per-page editor state, last-page-per-tab, and history. */
    _remapNotebookPaths(nb, oldPrefix, newPrefix, { sameTab = false } = {}) {
        const map = p => (typeof p === 'string' && (p === oldPrefix || p.startsWith(oldPrefix + '/')))
            ? newPrefix + p.slice(oldPrefix.length) : p;
        const s = this._session(nb);
        if (s.pageStates)    s.pageStates    = Object.fromEntries(Object.entries(s.pageStates).map(([k, v]) => [map(k), v]));
        if (s.sectionLastPage) {
            // Keys are tab paths ("Section" / "Section/Sub"), values are page paths. When a folder is
            // renamed both change together; when a page moves out of a tab only the value changes,
            // and that stale entry is dropped (it would otherwise open a page from another tab).
            const out = {};
            for (const [k, v] of Object.entries(s.sectionLastPage)) {
                const nk = map(k), nv = map(v);
                // sameTab: a page renamed in place stays the tab's "last page" (only the value changes)
                if (sameTab || (nk !== k) === (nv !== v)) out[nk] = nv;
            }
            s.sectionLastPage = out;
        }
        if (this.activeNotebookId === nb.id && this.activePage) this.activePage = map(this.activePage);
        this._navHistory.forEach(h => { if (h.notebookId === nb.id) h.pagePath = map(h.pagePath); });
    },

    /** Forget everything saved about a deleted path (and anything beneath it). */
    _forgetPaths(nb, prefix) {
        const s     = this._session(nb);
        const under = p => typeof p === 'string' && (p === prefix || p.startsWith(prefix + '/'));
        if (s.pageStates)      for (const k of Object.keys(s.pageStates)) if (under(k)) delete s.pageStates[k];
        if (s.sectionLastPage) for (const [k, v] of Object.entries(s.sectionLastPage)) if (under(k) || under(v)) delete s.sectionLastPage[k];
    },

    /** After a rescan the old file handles are dead: re-resolve the open page's and history's. */
    _repairHandles(nb) {
        if (this.activeNotebookId === nb.id && this.activePage && !this.activeIsDrawer) {
            const n = this._findPageByPath(nb, this.activePage);
            if (n?.handle) this.activePageHandle = n.handle;
        }
        for (const h of this._navHistory) {
            if (h.notebookId !== nb.id) continue;
            const n = this._findPageByPath(nb, h.pagePath);
            if (n?.handle) h.handle = n.handle;
        }
    },

    /** Remove history entries for pages under pathPrefix (they no longer exist). */
    _dropHistory(nb, pathPrefix) {
        const gone = h => h.notebookId === nb.id && (h.pagePath === pathPrefix || h.pagePath.startsWith(pathPrefix + '/'));
        let idx = this._navIndex;
        const kept = [];
        this._navHistory.forEach((h, i) => { if (gone(h)) { if (i <= this._navIndex) idx--; } else kept.push(h); });
        this._navHistory = kept;
        this._navIndex = kept.length ? Math.min(Math.max(idx, 0), kept.length - 1) : -1;
    },

    /** If the active section / sub-section no longer exists, fall back to one that does. */
    _ensureValidActiveSection(nb) {
        const sec = nb.sections.find(s => s.name === this.activeSection);
        const ok  = this.activeSection === 'Unfiled' ? nb.unfiledPages.length > 0 : !!sec;
        if (!ok) {
            const first = nb.sections[0]?.name || (nb.unfiledPages.length ? 'Unfiled' : null);
            this.activeSection    = first;
            this.activeSubsection = first && first !== 'Unfiled' ? this._resolveActiveSubsection(nb, first) : null;
            return;
        }
        if (sec && this.activeSubsection && !sec.subsections?.some(s => s.name === this.activeSubsection))
            this.activeSubsection = null;   // the sub-section vanished: fall back to the section's own "Pages" tab
    },

    /** The usual refresh after files changed on disk. */
    async _refreshAfterFsChange(nb) {
        await this._scanNotebook(nb);
        this._repairHandles(nb);
        this._ensureValidActiveSection(nb);
        this.renderSectionTabs(nb.id);
        this.renderSubsectionTabs(nb.id);
        this.renderPageList(this.activeSection, this.activeSubsection);
        this._renderNavButtons();
        this.scheduleNotebookSessionSave(nb.id);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Section / sub-section tabs: rename and delete  (the tab IS a folder)
    // ─────────────────────────────────────────────────────────────────────────

    /** Why a section / sub-section folder name can't be used (null if it's fine).
     *  One rule set for adding AND renaming, so the two can't drift apart. */
    _badFolderName(name, kind) {
        if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.') || /[. ]$/.test(name))
            return `A ${kind} name can't contain \\ / : * ? " < > |, start with a dot, or end with a dot or space.`;
        return null;
    },

    /** `base`, or "base 1", "base 2"… if a sibling already has that name. Compared
     *  case-insensitively, the way Windows and macOS file systems treat folder names. */
    _uniqueName(base, siblings) {
        const taken = new Set(siblings.map(x => x.name.toLowerCase()));
        let name = base, i = 1;
        while (taken.has(name.toLowerCase())) name = `${base} ${i++}`;
        return name;
    },

    _startTabRename({ level, name }) {
        $(level === 'section' ? 'section-tabs-el' : 'subsection-tabs-el')?.startRename(name);
    },

    async renameTab(level, oldName, newName) {
        newName = (newName || '').trim();
        if (!newName || newName === oldName) return;
        const nb = this.activeNotebook;
        if (!nb) return;
        const kind = level === 'section' ? 'section' : 'sub-section';

        const problem = this._badFolderName(newName, kind);
        if (problem) { this.toast(problem, 5000); return; }
        const section  = level === 'section' ? null : nb.sections.find(s => s.name === this.activeSection);
        const siblings = level === 'section' ? nb.sections : (section?.subsections || []);
        const entry    = siblings.find(s => s.name === oldName);
        if (!entry) return;
        if (siblings.some(s => s !== entry && s.name.toLowerCase() === newName.toLowerCase())) {
            this.toast(`A ${kind} named "${newName}" already exists.`);
            return;
        }

        await this._flushActivePage();
        const parent  = level === 'section' ? nb.handle : section.handle;
        const oldPath = entry.path;
        const newPath = level === 'section' ? newName : `${section.name}/${newName}`;
        try {
            await renameDirectory(parent, oldName, newName);
        } catch (e) {
            this.toast('Rename failed: ' + e.message, 5000);
            await this._refreshAfterFsChange(nb);
            return;
        }

        // Keep every saved reference pointing at the renamed folder
        this._remapNotebookPaths(nb, oldPath, newPath);
        const s = this._session(nb);
        if (level === 'section') {
            if (this.activeSection === oldName) this.activeSection = newName;
            if (s.sectionLastSubsection && oldName in s.sectionLastSubsection) {
                s.sectionLastSubsection[newName] = s.sectionLastSubsection[oldName];
                delete s.sectionLastSubsection[oldName];
            }
            this._navHistory.forEach(h => { if (h.notebookId === nb.id && h.section === oldName) h.section = newName; });
        } else {
            if (this.activeSection === section.name && this.activeSubsection === oldName) this.activeSubsection = newName;
            if (s.sectionLastSubsection?.[section.name] === oldName) s.sectionLastSubsection[section.name] = newName;
            this._navHistory.forEach(h => {
                if (h.notebookId === nb.id && h.section === section.name && h.subsection === oldName) h.subsection = newName;
            });
        }
        await this._refreshAfterFsChange(nb);
        this.toast(`Renamed to "${newName}".`);
    },

    async deleteTab({ level, name }) {
        const nb = this.activeNotebook;
        if (!nb) return;
        const section = level === 'section' ? null : nb.sections.find(s => s.name === this.activeSection);
        const entry   = (level === 'section' ? nb.sections : (section?.subsections || [])).find(s => s.name === name);
        if (!entry) return;

        const pages = level === 'section'
            ? [...entry.pages, ...(entry.subsections || []).flatMap(s => s.pages)].length
            : entry.pages.length;
        const kind = level === 'section' ? 'section' : 'sub-section';
        if (!await this._confirm(`Permanently delete ${kind} "${name}" and everything in it (${pages} page${pages === 1 ? '' : 's'})? This cannot be undone.`)) return;

        const parent    = level === 'section' ? nb.handle : section.handle;
        const hadActive = !!this.activePage && !this.activeIsDrawer &&
                          (this.activePage === entry.path || this.activePage.startsWith(entry.path + '/'));
        if (hadActive) clearTimeout(this._saveTimer);   // (an unrelated page keeps its pending autosave)
        try {
            await parent.removeEntry(name, { recursive: true });
        } catch (e) {
            this.toast('Delete failed: ' + e.message, 5000);
            return;
        }

        // Forget everything saved about the deleted folder
        const s = this._session(nb);
        this._forgetPaths(nb, entry.path);
        if (s.sectionLastSubsection) {
            if (level === 'section') delete s.sectionLastSubsection[name];
            else if (s.sectionLastSubsection[section.name] === name) delete s.sectionLastSubsection[section.name];
        }
        this._dropHistory(nb, entry.path);

        if (hadActive) {
            this.activePage = null; this.activePageHandle = null; this.activePageDirty = false;
            this._showEditor(false);
        }
        if (level === 'subsection' && this.activeSubsection === name) this.activeSubsection = null;

        await this._refreshAfterFsChange(nb);
        this._renderToolbar();
        if (hadActive && this.activeSection) await this._openDefaultPageForSection(this.activeSection);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Move a page to another section / sub-section
    // ─────────────────────────────────────────────────────────────────────────

    _initMoveDialog() {
        const dialog = $('move-dialog');
        if (!dialog) return;
        const close = () => dialog.close();
        $('btn-move-close')?.addEventListener('click', close);
        $('btn-move-cancel')?.addEventListener('click', close);
        dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
        $('btn-move-confirm')?.addEventListener('click', () => {
            const node = this._moveNode, dest = this._moveDest;
            close();
            if (node && dest) this.movePage(node, dest);
        });
    },

    /** Show the destination tree: Unfiled, then each section with its sub-sections. */
    async openMoveDialog(node) {
        const nb     = this.activeNotebook;
        const dialog = $('move-dialog');
        if (!nb || !node?.handle || !dialog) return;
        const tree    = $('move-tree');
        const confirm = $('btn-move-confirm');

        const here = parentPath(node.path);

        this._moveNode = node; this._moveDest = null; confirm.disabled = true;
        $('move-page-name').textContent = `Move \u201C${node.title}\u201D to:`;
        tree.innerHTML = '';

        const makeRow = (dest, depth, collapsible) => {
            const row = document.createElement('div');
            row.className = 'move-row';
            row.style.paddingLeft = (10 + depth * 18) + 'px';
            const chev = document.createElement('span');
            chev.className = 'move-chev' + (collapsible ? '' : ' leaf');
            const label = document.createElement('span');
            label.className = 'move-label';
            label.textContent = dest.name;
            row.append(chev, label);

            let why = '';
            if (dest.path === here) why = 'The page is already here';
            if (why) {
                row.classList.add('move-disabled');
                row.title = why;
            } else {
                row.addEventListener('click', () => {
                    tree.querySelectorAll('.move-row.selected').forEach(r => r.classList.remove('selected'));
                    row.classList.add('selected');
                    this._moveDest = dest;
                    confirm.disabled = false;
                });
            }
            if (collapsible) chev.addEventListener('click', e => { e.stopPropagation(); row.parentElement.classList.toggle('collapsed'); });
            return row;
        };

        tree.appendChild(makeRow({ name: 'Unfiled', label: 'Unfiled', path: '', handle: nb.handle, section: 'Unfiled', sub: null }, 0, false));
        for (const sec of nb.sections) {
            const subs  = sec.subsections || [];
            const group = document.createElement('div');
            group.className = 'move-group';
            group.appendChild(makeRow({ name: sec.name, label: sec.name, path: sec.path, handle: sec.handle, section: sec.name, sub: null }, 0, subs.length > 0));
            if (subs.length) {
                const kids = document.createElement('div');
                kids.className = 'move-children';
                subs.forEach(sub => kids.appendChild(makeRow(
                    { name: sub.name, label: `${sec.name} / ${sub.name}`, path: sub.path, handle: sub.handle, section: sec.name, sub: sub.name }, 1, false)));
                group.appendChild(kids);
            }
            tree.appendChild(group);
        }
        dialog.showModal();
    },

    async movePage(node, dest) {
        const nb = this.activeNotebook;
        if (!nb || !node?.handle) return;

        const srcPath   = node.path;
        const srcParent = parentPath(srcPath);
        if (srcParent === dest.path) { this.toast('That page is already there.'); return; }

        const wasOpen = !!this.activePage && !this.activeIsDrawer && this.activePage === srcPath;
        await this._flushActivePage();

        // Pick a name that clashes with nothing at the destination
        const taken = new Set();
        for await (const [n] of dest.handle.entries()) taken.add(n.toLowerCase());
        let newTitle = node.title, i = 1;
        while (taken.has(`${newTitle}.md`.toLowerCase())) newTitle = `${node.title} ${i++}`;
        const newName = `${newTitle}.md`;

        // 1. Copy (and verify). Nothing has been deleted yet, so a failure here loses nothing.
        let srcDir, createdFile = false;
        try {
            srcDir = await resolveDir(nb.handle, srcParent);
            const srcFh = await srcDir.getFileHandle(node.name);
            const newFh = await copyFileInto(srcFh, dest.handle, newName);
            createdFile = true;
            if ((await newFh.getFile()).size !== (await srcFh.getFile()).size)
                throw new Error('the copy did not match the original, so nothing was deleted');
        } catch (e) {
            if (createdFile) await dest.handle.removeEntry(newName).catch(() => {});
            this.toast('Move failed: ' + e.message, 5000);
            return;
        }

        // 2. Only now remove the originals.
        try {
            await srcDir.removeEntry(node.name);
        } catch (e) {
            this.toast('The page was copied, but the original could not be removed: ' + e.message, 6000);
            await this._refreshAfterFsChange(nb);
            return;
        }

        // 3. Point every saved reference at the new location.
        const destPrefix = dest.path ? dest.path + '/' : '';
        const newPath    = `${destPrefix}${newName}`;
        this._remapNotebookPaths(nb, srcPath, newPath);
        this._navHistory.forEach(h => { if (h.notebookId === nb.id && h.pagePath === newPath) { h.section = dest.section; h.subsection = dest.sub; } });

        if (wasOpen) {   // follow the open page, so it stays visible in the page list
            this.activeSection = dest.section;
            this.activeSubsection = dest.sub;
            this._rememberLastSubsection(dest.section, dest.sub);
            nb.session.sectionLastPage = nb.session.sectionLastPage || {};
            nb.session.sectionLastPage[this._subsectionKey(dest.section, dest.sub)] = newPath;
        }
        await this._refreshAfterFsChange(nb);
        this.toast(`Moved \u201C${node.title}\u201D to ${dest.label}.`);
    },

};
// App.init() is called from components.js after custom elements are defined.
