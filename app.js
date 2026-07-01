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

// ─────────────────────────────────────────────────────────────────────────────
// Typography settings — font catalog, weight scale, and defaults.
// All 7 fonts are loaded locally as TTFs from /fonts (see looks.css @font-face).
// ─────────────────────────────────────────────────────────────────────────────
const FONT_CATALOG = [
    { id: 'dm-sans',         label: 'DM Sans',           stack: "'DM Sans', system-ui, sans-serif",        tag: 'Sans · Screen',  weights: [300, 400, 500, 600, 700, 800, 900] },
    { id: 'inter',           label: 'Inter',             stack: "'Inter', system-ui, sans-serif",          tag: 'Sans · Screen',  weights: [300, 400, 500, 600, 700, 800, 900] },
    { id: 'ibm-plex-sans',   label: 'IBM Plex Sans',     stack: "'IBM Plex Sans', system-ui, sans-serif",  tag: 'Sans · Screen',  weights: [300, 400, 500, 600, 700] },
    { id: 'jetbrains-mono',  label: 'JetBrains Mono',    stack: "'JetBrains Mono', 'Fira Code', monospace",tag: 'Mono',           weights: [300, 400, 500, 600, 700, 800] },
    { id: 'lora',            label: 'Lora',              stack: "'Lora', Georgia, serif",                  tag: 'Serif',          weights: [400, 500, 600, 700] },
    { id: 'source-serif-4',  label: 'Source Serif 4',    stack: "'Source Serif 4', Georgia, serif",        tag: 'Serif',          weights: [300, 400, 500, 600, 700, 800, 900] },
    { id: 'playfair-display',label: 'Playfair Display',  stack: "'Playfair Display', Georgia, serif",      tag: 'Display Serif',  weights: [400, 500, 600, 700, 800, 900] },
];

const WEIGHT_NAMES = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extrabold', 900: 'Heavy' };

const TYPOGRAPHY_DEFAULTS = {
    body: { font: 'dm-sans', size: 14, weight: 400 },
    h1:   { font: 'dm-sans', size: 27, weight: 600 },
    h2:   { font: 'dm-sans', size: 21, weight: 600 },
    h3:   { font: 'dm-sans', size: 17, weight: 600 },
};

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB  — two stores: 'notebooks' (all open notebooks) + 'app-state'
// ─────────────────────────────────────────────────────────────────────────────
function openDB() {
    return new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(NOTEBOOK_STORE))
                db.createObjectStore(NOTEBOOK_STORE, { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains(STATE_STORE))
                db.createObjectStore(STATE_STORE);
        };
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
    });
}

async function dbGetAllNotebooks() {
    const db = await openDB();
    return new Promise((res, rej) => {
        const r = db.transaction(NOTEBOOK_STORE, 'readonly')
                    .objectStore(NOTEBOOK_STORE).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });
}

async function dbAddNotebook(name, handle) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(NOTEBOOK_STORE, 'readwrite');
        const r  = tx.objectStore(NOTEBOOK_STORE).add({ name, handle });
        r.onsuccess = () => res(r.result); // returns auto-generated id
        tx.onerror  = () => rej(tx.error);
    });
}

async function dbRemoveNotebook(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(NOTEBOOK_STORE, 'readwrite');
        tx.objectStore(NOTEBOOK_STORE).delete(id);
        tx.oncomplete = res;
        tx.onerror    = () => rej(tx.error);
    });
}

async function dbSetActiveNotebook(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(STATE_STORE, 'readwrite');
        tx.objectStore(STATE_STORE).put({ activeNotebookId: id }, 'global');
        tx.oncomplete = res;
        tx.onerror    = () => rej(tx.error);
    });
}

async function dbGetAppState() {
    const db = await openDB();
    return new Promise((res, rej) => {
        const r = db.transaction(STATE_STORE, 'readonly')
                    .objectStore(STATE_STORE).get('global');
        r.onsuccess = () => res(r.result || {});
        r.onerror   = () => rej(r.error);
    });
}

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

async function uniqueFilename(dirHandle, base = 'Untitled') {
    const existing = [];
    for await (const [n] of dirHandle.entries()) existing.push(n);
    let name = base + '.md', i = 1;
    while (existing.includes(name)) name = `${base} ${i++}.md`;
    return name;
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → HTML  (used by <cento-editor> in preview mode)
// ─────────────────────────────────────────────────────────────────────────────
function mdToHtml(md) {
    const lines = md.split('\n');
    const out = [];
    let inCode = false, codeBuf = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (raw.startsWith('```')) {
            if (inCode) { out.push(`<pre><code>${escHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; inCode = false; }
            else { inCode = true; }
            continue;
        }
        if (inCode) { codeBuf.push(raw); continue; }

        let line = raw
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
            .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
            .replace(/\*(.+?)\*/g,'<em>$1</em>')
            .replace(/_(.+?)_/g,'<em>$1</em>')
            .replace(/`([^`]+)`/g,'<code>$1</code>')
            .replace(/==(.+?)==/g,'<mark>$1</mark>')
            .replace(/\^(.+?)\^/g,'<sup>$1</sup>')
            .replace(/~(.+?)~/g,'<sub>$1</sub>')
            .replace(/\[\[([^\]]+)\]\]/g,'<a href="#" class="wikilink" data-target="$1">$1</a>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank">$1</a>');

        const hm = raw.match(/^(#{1,6})\s(.*)/);
        if (hm) { out.push(`<h${hm[1].length}>${line.replace(/^#+\s/,'')}</h${hm[1].length}>`); continue; }
        if (/^---+$/.test(raw.trim())) { out.push('<hr/>'); continue; }
        if (raw.startsWith('> ')) { out.push(`<blockquote>${line.slice(5)}</blockquote>`); continue; }
        if (/^\s*[-*]\s/.test(raw)) { out.push(`<li>${line.replace(/^\s*[-*]\s/,'')}</li>`); continue; }
        if (/^\d+\.\s/.test(raw)) { out.push(`<li>${line.replace(/^\d+\.\s/,'')}</li>`); continue; }
        if (line.trim() === '') { out.push('<p></p>'); continue; }
        out.push(`<p>${line}</p>`);
    }
    return out.join('\n').replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
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
        for (let i = 0; i < lineCount; i++)
            decorateLine(cm, i, cm.getLine(i), i === cursor.line ? cursor.ch : -1);
    });
}

function decorateLine(cm, lineNo, text, cursorCh) {
    const mk = (from, to, cls) => cm.markText(
        { line: lineNo, ch: from }, { line: lineNo, ch: to },
        { className: cls, atomic: false }
    );
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
    if (/^---+$/.test(text.trim())) { mk(0, text.length, 'cm-md-syntax'); return; }
    applyInline(cm, lineNo, text, cursorCh);
}

function applyInline(cm, lineNo, text, cursorCh) {
    const mk = (from, to, cls) => cm.markText(
        { line: lineNo, ch: from }, { line: lineNo, ch: to },
        { className: cls, atomic: false }
    );
    applyPattern(text, /(\*\*\*)(.+?)(\*\*\*)/g,             cursorCh, mk, 'cm-md-syntax', 'cm-md-bold cm-md-italic', 'cm-md-syntax');
    applyPattern(text, /(\*\*)([^*\n]+?)(\*\*)/g,            cursorCh, mk, 'cm-md-syntax', 'cm-md-bold',              'cm-md-syntax');
    applyPattern(text, /(?<!\*)\*(?!\*)([^*\n]+?)\*/g,       cursorCh, mk, 'cm-md-syntax', 'cm-md-italic',            'cm-md-syntax', true);
    applyPattern(text, /(?<!_)_(?!_)([^_\n]+?)_/g,          cursorCh, mk, 'cm-md-syntax', 'cm-md-italic',            'cm-md-syntax', true);
    applyPattern(text, /(`)(.*?)(`)/g,                       cursorCh, mk, 'cm-md-syntax', 'cm-md-code',              'cm-md-syntax');
    applyPattern(text, /(==)(.+?)(==)/g,                     cursorCh, mk, 'cm-md-syntax', 'cm-md-highlight',         'cm-md-syntax');
    applyPattern(text, /(\^)(.+?)(\^)/g,                     cursorCh, mk, 'cm-md-syntax', 'cm-md-superscript',       'cm-md-syntax');
    applyPattern(text, /(~)(.+?)(~)/g,                       cursorCh, mk, 'cm-md-syntax', 'cm-md-subscript',         'cm-md-syntax');
    let m;
    const wikiRe = /\[\[([^\]]+)\]\]/g;
    while ((m = wikiRe.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) { mk(start, end, 'cm-md-wikilink'); }
        else { mk(start, start+2, 'cm-md-hidden'); mk(start+2, start+2+m[1].length, 'cm-md-wikilink'); mk(start+2+m[1].length, end, 'cm-md-hidden'); }
    }
    const zotRe = /\[([^\]]+)\]\((zotero:\/\/[^)]+)\)/g;
    while ((m = zotRe.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) { mk(start, end, 'cm-md-zotero-link'); }
        else { mk(start, start+1, 'cm-md-hidden'); mk(start+1, start+1+m[1].length, 'cm-md-zotero-link'); mk(start+1+m[1].length, end, 'cm-md-hidden'); }
    }
    const linkRe = /\[([^\]]+)\]\(((?!zotero:\/\/)[^)]+)\)/g;
    while ((m = linkRe.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) { mk(start, end, 'cm-md-link'); }
        else { mk(start, start+1, 'cm-md-hidden'); mk(start+1, start+1+m[1].length, 'cm-md-link'); mk(start+1+m[1].length, end, 'cm-md-hidden'); }
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
    // sections: [{ name, handle, path, pages }]   pages: recursive PageNode tree
    notebooks:        [],
    activeNotebookId: null,
    activeSection:    null,   // section name string, or 'Unfiled'
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
    renamingPath:     null,
    typography:       JSON.parse(JSON.stringify(TYPOGRAPHY_DEFAULTS)), // current notebook's font settings

    // ── Internals ──────────────────────────────────────────────────────────────
    _sessionTimers:   {},   // one debounce timer per notebook id
    _saveTimer:       null,
    _outlineTimer:    null,
    _navHistory:      [],   // [{notebookId, section, pagePath, handle}] — in-memory only
    _navIndex:        -1,   // current position in _navHistory
    _navigating:      false,// true while executing a back/forward jump (suppress push)
    _ctxNode:         null,
    _ctxKind:         null,
    _settingsDraft:   null,   // working copy of typography edited inside the Settings dialog

    // ─────────────────────────────────────────────────────────────────────────
    // Boot
    // ─────────────────────────────────────────────────────────────────────────
    init() {
        const ed = () => document.getElementById('editor');

        // ── Toolbar buttons ──────────────────────────────────────────────────
        document.getElementById('btn-open-notebook')
            .addEventListener('click', () => this.openNotebook());
        document.getElementById('btn-open-notebook-welcome')
            .addEventListener('click', () => this.openNotebook());
        document.getElementById('btn-open-file')
            .addEventListener('click', () => this.openFileInDrawer());
        document.getElementById('btn-open-file-welcome')
            .addEventListener('click', () => this.openFileInDrawer());
        document.getElementById('btn-new-page')
            .addEventListener('click', () => this.newPage());
        document.getElementById('btn-sidebar-notebooks')
            .addEventListener('click', () => this.setSidebarView('notebooks'));
        document.getElementById('btn-sidebar-search')
            .addEventListener('click', () => {
                this.setSidebarView('search');
                document.getElementById('search-input').focus();
            });
        document.getElementById('btn-toggle-preview')
            .addEventListener('click', () => this.toggleEditorMode());
        document.getElementById('btn-add-column')
            .addEventListener('click', () => ed()?.addColumn());
        document.getElementById('btn-remove-column')
            .addEventListener('click', () => ed()?.removeColumn());
        document.getElementById('btn-toggle-outline')
            .addEventListener('click', () => this.toggleOutline());
        document.getElementById('btn-save')
            .addEventListener('click', () => this.saveActivePage());
        document.getElementById('btn-nav-back')
            .addEventListener('click', () => this.navBack());
        document.getElementById('btn-nav-forward')
            .addEventListener('click', () => this.navForward());

        // ── Search ───────────────────────────────────────────────────────────
        document.getElementById('btn-search-go')
            .addEventListener('click', () => this.runSearch());
        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.runSearch(); });
        searchInput.addEventListener('input', e => { this.searchQuery = e.target.value; });

        // ── Global keyboard ──────────────────────────────────────────────────
        window.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.saveActivePage(); }
        });

        // ── Section tabs (custom element events) ─────────────────────────────
        const sectionTabsEl = document.getElementById('section-tabs-el');
        sectionTabsEl.addEventListener('section-change', e => {
            this.activeSection = e.detail.section;
            this.renderSectionTabs(this.activeNotebookId); // update active highlight
            this.renderPageList(this.activeSection);
            this.scheduleNotebookSessionSave(this.activeNotebookId);
            this._openDefaultPageForSection(e.detail.section);
        });
        sectionTabsEl.addEventListener('section-add', e => this.addSection(e.detail.name));

        // ── Page list (custom element events) ────────────────────────────────
        const pageListEl = document.getElementById('page-list-component');
        pageListEl.addEventListener('page-select', async e => {
            const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
            if (!nb) return;
            const node = this._findPageByPath(nb, e.detail.path);
            if (node?.handle) await this.openPage(e.detail.path, node.handle);
        });
        pageListEl.addEventListener('item-toggle', e => {
            const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
            if (!nb) return;
            nb.session = nb.session || {};
            const set = new Set(nb.session.expandedPages || []);
            e.detail.expanded ? set.add(e.detail.path) : set.delete(e.detail.path);
            nb.session.expandedPages = [...set];
            this.scheduleNotebookSessionSave(this.activeNotebookId);
        });
        pageListEl.addEventListener('page-contextmenu', e => {
            const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
            if (!nb) return;
            const node = this._findPageByPath(nb, e.detail.path);
            if (!node) return;
            this._showContextMenu(e, { kind: 'node', node });
        });
        pageListEl.addEventListener('page-rename', async e => {
            await this.commitRename(e.detail.path, e.detail.newTitle);
        });

        // ── Notebook list (custom element events) ────────────────────────────
        document.getElementById('notebook-list')
            .addEventListener('notebook-activate', e => {
                this.switchToNotebook(Number(e.detail.id));
            });
        document.getElementById('notebook-list')
            .addEventListener('notebook-close', async e => {
                await this.closeNotebook(Number(e.detail.id));
            });

        // ── <cento-editor> events ─────────────────────────────────────────────
        document.addEventListener('content-change', () => {
            this.activePageDirty = true;
            this._renderToolbar();
            this.scheduleAutoSave();
        });
        document.addEventListener('cursor-change', () => {
            if (this.outlineVisible) {
                clearTimeout(this._outlineTimer);
                this._outlineTimer = setTimeout(() => this._renderOutline(), 300);
            }
        });
        document.addEventListener('column-count-change', e => {
            this._renderToolbar();
        });
        document.addEventListener('max-columns-reached', () => {
            this.toast('Maximum of 4 columns reached.');
        });
        document.addEventListener('link-click', e => {
            this.handleLinkClick({ href: e.detail.href, isWiki: e.detail.isWiki });
        });
        document.addEventListener('save-request', () => this.saveActivePage());

        // ── Link clicks in the editor (live mode, wikilinks/md links) ─────────
        document.getElementById('panes-container')
            .addEventListener('click', e => {
                const el = e.target.closest('.cm-md-link, .cm-md-wikilink');
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
        document.getElementById('ctx-rename').addEventListener('click', () => {
            const node = this._ctxNode; this._hideContextMenu();
            if (!node) return;
            // Set the renaming attribute on the matching <page-list-item>
            const item = document.querySelector(`page-list-item[page-path="${CSS.escape(node.path)}"]`);
            if (item) { this._renameCommitted = false; item.setAttribute('renaming', ''); }
        });
        document.getElementById('ctx-delete').addEventListener('click', () => {
            const node = this._ctxNode; this._hideContextMenu();
            if (node) this.deleteNode(node);
        });
        document.getElementById('context-menu').addEventListener('click', e => {
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
        this._initResizeDrag(document.getElementById('resize-left'),  'left');
        this._initResizeDrag(document.getElementById('resize-page'),  'page');
        this._initResizeDrag(document.getElementById('resize-right'), 'right');
        this._applyWidths();

        // ── Drawer header click — switches the view back to the Drawer ────────
        document.querySelector('.drawer-section-header')
            .addEventListener('click', () => this.showDrawerView());

        // ── Settings modal ──────────────────────────────────────────────────
        this._initSettingsModal();
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

        // ── Restore notebooks from IndexedDB ──────────────────────────────────
        (async () => {
            try {
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
            this.activePage       = null;
            this.activePageHandle = null;
            this.activeIsDrawer   = false;
            // Clear the editor and show the welcome screen
            document.getElementById('editor').style.display = 'none';
            document.getElementById('welcome').style.display = '';
            document.getElementById('section-tabs-el').style.display = 'none';
            document.getElementById('page-list-panel').style.display = 'none';
            document.getElementById('page-list-component').innerHTML = '';

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
        this._renderToolbar();
        this._applyWidths();

        // Open the last-active section and page from session
        const s = nb.session || {};
        const section = s.activeSection || nb.sections[0]?.name || (nb.unfiledPages.length ? 'Unfiled' : null);
        if (section) {
            this.activeSection = section;
            this.renderSectionTabs(id);   // re-render to reflect active section
            this.renderPageList(section);
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
    // ─────────────────────────────────────────────────────────────────────────

    async _scanNotebook(nb) {
        const sections = [], unfiledPages = [];
        for await (const [name, entry] of nb.handle.entries()) {
            if (name.startsWith('.') || name === NOTEBOOK_SESSION) continue;
            if (entry.kind === 'directory') {
                const pages = await this._scanPageLevel(entry, name);
                sections.push({ name, handle: entry, path: name, pages });
            } else if (name.endsWith('.md')) {
                unfiledPages.push({ name, title: name.replace(/\.md$/, ''), path: name, handle: entry, type: 'page', children: [] });
            }
        }
        sections.sort((a, b) => a.name.localeCompare(b.name));
        unfiledPages.sort((a, b) => a.name.localeCompare(b.name));
        nb.sections     = sections;
        nb.unfiledPages = unfiledPages;
    },

    /**
     * Recursively scan one level of the page hierarchy.
     * A .md file named "Foo.md" paired with a directory "Foo/" makes Foo a
     * parent page — its children come from the paired directory.
     * An unpaired directory becomes a non-clickable group header.
     */
    async _scanPageLevel(dirHandle, basePath) {
        const files = {}, dirs = {};
        for await (const [name, entry] of dirHandle.entries()) {
            if (name.startsWith('.')) continue;
            if (entry.kind === 'directory') dirs[name]  = entry;
            else if (name.endsWith('.md'))  files[name] = entry;
        }
        const pages = [], paired = new Set();
        for (const [fileName, fh] of Object.entries(files)) {
            const title    = fileName.replace(/\.md$/, '');
            const pagePath = basePath ? `${basePath}/${fileName}` : fileName;
            if (dirs[title]) {
                paired.add(title);
                const children = await this._scanPageLevel(dirs[title], basePath ? `${basePath}/${title}` : title);
                pages.push({ name: fileName, title, path: pagePath, handle: fh, type: 'page', children });
            } else {
                pages.push({ name: fileName, title, path: pagePath, handle: fh, type: 'page', children: [] });
            }
        }
        for (const [dirName, dh] of Object.entries(dirs)) {
            if (paired.has(dirName)) continue;
            const children = await this._scanPageLevel(dh, basePath ? `${basePath}/${dirName}` : dirName);
            pages.push({ name: dirName, title: dirName, path: null, handle: null, type: 'group', children });
        }
        pages.sort((a, b) => a.title.localeCompare(b.title));
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
            const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
            const stored = nb?.session?.pageStates?.[pagePath]?.columns;
            if (stored) columnsData = stored;
        }

        this.activePage       = pagePath;
        this.activePageHandle = handle;
        this.activePageDirty  = false;
        this.activeIsDrawer   = false;

        // Remember which page was last open in this section (for section-tab switching)
        if (this.activeNotebookId && this.activeSection) {
            const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
            if (nb) {
                nb.session = nb.session || {};
                nb.session.sectionLastPage = nb.session.sectionLastPage || {};
                nb.session.sectionLastPage[this.activeSection] = pagePath;
            }
        }

        // Push to in-memory navigation history unless we're executing a back/forward jump
        if (!this._navigating) {
            this._pushHistory({ notebookId: this.activeNotebookId, section: this.activeSection, pagePath, handle });
        }

        const editorEl = document.getElementById('editor');
        editorEl.style.display = '';
        document.getElementById('welcome').style.display = 'none';

        editorEl.editorMode = this.editorMode;
        editorEl.load(content, columnsData);

        this._renderToolbar();
        this.renderPageList(this.activeSection);
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
        this.typography = {
            body: { ...TYPOGRAPHY_DEFAULTS.body, ...(s.typography?.body || {}) },
            h1:   { ...TYPOGRAPHY_DEFAULTS.h1,   ...(s.typography?.h1   || {}) },
            h2:   { ...TYPOGRAPHY_DEFAULTS.h2,   ...(s.typography?.h2   || {}) },
            h3:   { ...TYPOGRAPHY_DEFAULTS.h3,   ...(s.typography?.h3   || {}) },
        };
        this._applyTypography();
        this._applyWidths();
    },

    async saveNotebookSession(notebookId) {
        const nb = this.notebooks.find(n => n.id === notebookId);
        if (!nb || nb.needsPermission) return;

        // Snapshot current page's editor state into pageStates
        const editorEl = document.getElementById('editor');
        if (this.activePage && editorEl && !this.activeIsDrawer) {
            nb.session                              = nb.session || {};
            nb.session.pageStates                   = nb.session.pageStates || {};
            nb.session.pageStates[this.activePage]  = { columns: editorEl.getColumnsState() };
        }

        const session = {
            activeSection:    this.activeSection,
            activePage:       this.activePage,
            sidebarWidth:     this.sidebarWidth,
            pageListWidth:    this.pageListWidth,
            rightSidebarWidth:this.rightSidebarWidth,
            outlineVisible:   this.outlineVisible,
            typography:       this.typography,
            expandedPages:    nb.session?.expandedPages    || [],
            sectionLastPage:  nb.session?.sectionLastPage  || {},
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
        const editorEl = document.getElementById('editor');
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
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;

        let sectionHandle;
        if (this.activeSection === 'Unfiled') {
            sectionHandle = nb.handle;
        } else {
            const section = nb.sections.find(s => s.name === this.activeSection);
            if (!section) return;
            sectionHandle = section.handle;
        }

        const filename = await uniqueFilename(sectionHandle, 'Untitled');
        const fh = await sectionHandle.getFileHandle(filename, { create: true });
        await writeFile(fh, '');

        const pagePath = this.activeSection === 'Unfiled'
            ? filename
            : `${this.activeSection}/${filename}`;

        await this._scanNotebook(nb);
        this.renderPageList(this.activeSection);
        await this.openPage(pagePath, fh);

        // Enter rename mode immediately for the new page
        await new Promise(r => setTimeout(r, 50));
        const item = document.querySelector(`page-list-item[page-path="${CSS.escape(pagePath)}"]`);
        if (item) { this._renameCommitted = false; item.setAttribute('renaming', ''); }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Rename
    // ─────────────────────────────────────────────────────────────────────────

    async commitRename(pagePath, newTitle) {
        if (!newTitle?.trim()) return;
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;

        const node = this._findPageByPath(nb, pagePath);
        if (!node?.handle) return;

        const newName = newTitle.trim().replace(/\.md$/, '') + '.md';
        if (newName === node.name) return;

        const parentPath = pagePath.includes('/') ? pagePath.substring(0, pagePath.lastIndexOf('/')) : '';
        try {
            const dirHandle = parentPath ? await resolveDir(nb.handle, parentPath) : nb.handle;
            try { await dirHandle.getFileHandle(newName); this.toast('A file with that name already exists.'); return; } catch {}

            const content = await readFile(node.handle);
            const newFh   = await dirHandle.getFileHandle(newName, { create: true });
            await writeFile(newFh, content);
            await dirHandle.removeEntry(node.name);

            const newPath = parentPath ? `${parentPath}/${newName}` : newName;

            // Update active page reference if this was the open page
            if (this.activePage === pagePath) {
                this.activePage       = newPath;
                this.activePageHandle = newFh;
            }

            await this._scanNotebook(nb);
            this.renderPageList(this.activeSection);
            this.scheduleNotebookSessionSave(this.activeNotebookId);
        } catch (e) { this.toast('Rename failed: ' + e.message); }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Delete
    // ─────────────────────────────────────────────────────────────────────────

    async deleteNode(node) {
        const label = node.type === 'folder' ? `folder "${node.name}" and all its contents` : `"${node.name}"`;
        if (!await this._confirm(`Permanently delete ${label}?`)) return;

        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;

        const parentPath = node.path?.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
        try {
            const dirHandle = parentPath ? await resolveDir(nb.handle, parentPath) : nb.handle;
            await dirHandle.removeEntry(node.name, { recursive: true });

            if (this.activePage === node.path) {
                this.activePage       = null;
                this.activePageHandle = null;
                document.getElementById('editor').style.display = 'none';
                document.getElementById('welcome').style.display = '';
            }
            await this._scanNotebook(nb);
            this.renderPageList(this.activeSection);
            this.scheduleNotebookSessionSave(this.activeNotebookId);
        } catch (e) { this.toast('Delete failed: ' + e.message); }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Editor mode toggle
    // ─────────────────────────────────────────────────────────────────────────

    toggleEditorMode() {
        this.editorMode = this.editorMode === 'live' ? 'preview' : 'live';
        const ed = document.getElementById('editor');
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
        const editorEl    = document.getElementById('editor');
        const colCount    = editorEl ? editorEl.getColumnCount() : 0;

        document.getElementById('btn-new-page').disabled = !hasNotebook || !this.activeSection;
        this._renderNavButtons();

        // Toolbar-right buttons: only visible when a page is open
        const show = el => { if (el) el.style.display = hasPage ? '' : 'none'; };
        ['btn-toggle-preview', 'btn-save', 'btn-toggle-outline',
         'btn-add-column', 'btn-remove-column']
            .forEach(id => show(document.getElementById(id)));

        if (hasPage) {
            const isPreview = this.editorMode === 'preview';
            const btnPrev   = document.getElementById('btn-toggle-preview');
            btnPrev.classList.toggle('active', isPreview);
            btnPrev.dataset.tip = isPreview ? 'Live Preview' : 'Preview Mode';
            btnPrev.querySelector('.svg-eye').style.display  = isPreview ? 'none' : '';
            btnPrev.querySelector('.svg-edit').style.display = isPreview ? ''     : 'none';

            document.getElementById('btn-toggle-outline').classList.toggle('active', this.outlineVisible);

            const btnAdd = document.getElementById('btn-add-column');
            const btnRem = document.getElementById('btn-remove-column');
            btnAdd.disabled = colCount >= 4;
            btnRem.disabled = colCount <= 1;
            btnAdd.dataset.tip = colCount >= 4 ? 'Max 4 columns' : `Add Column (${colCount}/4)`;
            btnRem.dataset.tip = colCount <= 1 ? 'Only one column' : 'Remove Last Column';
        }
    },

    _renderSaveStatus() {
        const el = document.getElementById('save-indicator');
        el.className  = this.saveStatus;
        el.textContent = this.saveStatus === 'saving' ? 'saving…'
                       : this.saveStatus === 'saved'  ? 'saved' : '';
    },

    _renderSidebar() {
        const isNB = this.sidebarView === 'notebooks';
        document.getElementById('panel-notebooks').style.display = isNB  ? '' : 'none';
        document.getElementById('panel-search').style.display    = isNB  ? 'none' : '';
        document.getElementById('btn-sidebar-notebooks').classList.toggle('active',  isNB);
        document.getElementById('btn-sidebar-search').classList.toggle('active', !isNB);
    },

    /** Repopulate the notebook list with <notebook-entry> custom elements */
    renderNotebookList() {
        const list = document.getElementById('notebook-list');
        const msg  = document.getElementById('no-notebook-msg');
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
            //list.insertBefore(entry, document.getElementById('drawer-section'));
            list.appendChild(entry);
        });

        // "Needs permission" items shown as dim clickable rows
        pend.forEach(nb => {
            const div = document.createElement('div');
            div.className = 'notebook-pending';
            div.title = 'Click to reconnect';
            div.innerHTML = `<span class="pending-icon">⚠</span> <span class="pending-name">${escHtml(nb.name)}</span>`;
            div.addEventListener('click', () => this.switchToNotebook(nb.id));
            //list.insertBefore(div, document.getElementById('drawer-section'));
            list.appendChild(div);
        });

        // Drawer header reads as "active" while a Drawer file is being viewed
        const drawerHdr = document.querySelector('.drawer-section-header');
        if (drawerHdr) drawerHdr.classList.toggle('drawer-active', this.activeIsDrawer);
    },

    /** Update the <section-tabs> custom element attributes */
    renderSectionTabs(notebookId) {
        const el = document.getElementById('section-tabs-el');
        if (!el) return;
        const nb = this.notebooks.find(n => n.id === notebookId);
        if (!nb) { el.style.display = 'none'; return; }

        const sections = nb.sections.map(s => ({ name: s.name }));
        if (nb.unfiledPages.length) sections.push({ name: 'Unfiled' });

        el.style.display = sections.length ? '' : 'none';
        el.setAttribute('sections', JSON.stringify(sections));
        el.setAttribute('active-section', this.activeSection || '');

        // Update the page-list panel header
        const hdr = document.getElementById('page-list-section-name');
        if (hdr) hdr.textContent = this.activeSection || '';
    },

    /** Rebuild the <page-list-item> tree for the given section */
    renderPageList(sectionName) {
        const listEl = document.getElementById('page-list-component');
        const hdr    = document.getElementById('page-list-section-name');
        if (!listEl) return;

        listEl.innerHTML = '';
        if (hdr) hdr.textContent = sectionName || '';

        if (!sectionName || !this.activeNotebookId) return;
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;

        const pages = sectionName === 'Unfiled'
            ? nb.unfiledPages
            : (nb.sections.find(s => s.name === sectionName)?.pages || []);

        const expandedSet = new Set(nb.session?.expandedPages || []);
        const items = this._buildPageItems(pages, 0, expandedSet);
        items.forEach(item => listEl.appendChild(item));
    },

    /** Recursively build <page-list-item> DOM tree */
    _buildPageItems(pages, depth, expandedSet) {
        return pages.map(page => {
            const item = document.createElement('page-list-item');
            item.setAttribute('title', page.title);
            item.setAttribute('depth', String(depth));
            if (page.path)                    item.setAttribute('page-path', page.path);
            if (page.children?.length)        item.setAttribute('has-children', '');
            if (page.type === 'group')        item.setAttribute('is-group', '');
            if (page.path && expandedSet?.has(page.path)) item.setAttribute('expanded', '');
            if (page.path === this.activePage) item.setAttribute('active', '');

            if (page.children?.length) {
                this._buildPageItems(page.children, depth + 1, expandedSet)
                    .forEach(child => item.appendChild(child));
            }
            return item;
        });
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
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;
        this.searchResults = [];
        this.searchRan     = true;
        for (const section of nb.sections)
            await this._searchPages(section.pages, this.searchQuery.toLowerCase());
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
                        const hl    = escHtml(snip).replace(new RegExp(escHtml(query), 'gi'), m => `<mark>${m}</mark>`);
                        this.searchResults.push({ path: page.path, handle: page.handle, title: page.title, context: hl });
                    }
                } catch {}
            }
            if (page.children?.length) await this._searchPages(page.children, query);
        }
    },

    _renderSearchResults() {
        const list  = document.getElementById('search-results-list');
        const empty = document.getElementById('search-empty');
        list.innerHTML = '';
        empty.style.display = (this.searchRan && !this.searchResults.length) ? '' : 'none';
        for (const r of this.searchResults) {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `<div class="search-result-title">${escHtml(r.title)}</div>
                             <div class="search-result-context">${r.context}</div>`;
            div.addEventListener('click', () => this.openPage(r.path, r.handle));
            list.appendChild(div);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Link navigation
    // ─────────────────────────────────────────────────────────────────────────

    async handleLinkClick({ href, isWiki, isProto }) {
        if (isProto) {
            const parts = href.split('/');
            const nbName = parts[0];
            const filePath = parts.slice(1).join('/') + '.md';
            const nb = this.notebooks.find(n => n.name === nbName);
            if (!nb) { this.toast(`Open notebook "${nbName}" to follow this link.`); return; }
            const result = this._findNoteWithSection(nb, { path: filePath });
            if (result?.node?.handle) {
                if (nb.id !== this.activeNotebookId) await this.switchToNotebook(nb.id);
                this.activeSection = result.section;
                this.renderSectionTabs(nb.id);
                await this.openPage(filePath, result.node.handle);
            } else this.toast(`Page not found: ${href}`);
            return;
        }
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;
        if (isWiki) {
            const result = this._findNoteWithSection(nb, { title: href });
            if (result?.node?.handle) {
                this.activeSection = result.section;
                this.renderSectionTabs(nb.id);
                await this.openPage(result.node.path, result.node.handle);
            } else this.toast(`Page not found: [[${href}]]`);
        } else {
            if (/^https?:\/\//.test(href)) { window.open(href, '_blank'); return; }
            const result = this._findNoteWithSection(nb, { path: href });
            if (result?.node?.handle) {
                this.activeSection = result.section;
                this.renderSectionTabs(nb.id);
                await this.openPage(result.node.path, result.node.handle);
            } else this.toast(`Page not found: ${href}`);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Node lookup helpers
    // ─────────────────────────────────────────────────────────────────────────

    _findPageByPath(nb, path) {
        for (const section of nb.sections) {
            const found = this._walkPages(section.pages, p => p.path === path);
            if (found) return found;
        }
        return nb.unfiledPages.find(p => p.path === path) || null;
    },

    _findNoteByTitle(nb, title) {
        const low = title.toLowerCase();
        for (const section of nb.sections) {
            const found = this._walkPages(section.pages, p => p.type === 'page' && p.title.toLowerCase() === low);
            if (found) return found;
        }
        return nb.unfiledPages.find(p => p.title.toLowerCase() === low) || null;
    },

    /** Like _findNoteByTitle/_findPageByPath, but also returns which section
     *  (or 'Unfiled') the page lives in, so callers can switch the section
     *  tab/page-list to match before opening the page. */
    _findNoteWithSection(nb, { title, path } = {}) {
        for (const section of nb.sections) {
            const found = this._walkPages(section.pages, p =>
                p.type === 'page' && (title ? p.title.toLowerCase() === title.toLowerCase() : p.path === path));
            if (found) return { node: found, section: section.name };
        }
        const unfiled = nb.unfiledPages.find(p =>
            title ? p.title.toLowerCase() === title.toLowerCase() : p.path === path);
        if (unfiled) return { node: unfiled, section: 'Unfiled' };
        return null;
    },

    _walkPages(pages, pred) {
        for (const p of pages) {
            if (pred(p)) return p;
            if (p.children?.length) { const f = this._walkPages(p.children, pred); if (f) return f; }
        }
        return null;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Context menu
    // ─────────────────────────────────────────────────────────────────────────

    _showContextMenu(e, ctx) {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        menu.querySelectorAll('.ctx-editor-item, .ctx-sep').forEach(el => el.remove());

        if (ctx.kind === 'node') {
            this._ctxNode = ctx.node;
            this._ctxKind = 'node';
            document.getElementById('ctx-rename').style.display = ctx.node.type === 'folder' ? 'none' : '';
            document.getElementById('ctx-delete').style.display = '';
        } else {
            this._ctxNode = null;
            this._ctxKind = 'editor';
            document.getElementById('ctx-rename').style.display = 'none';
            document.getElementById('ctx-delete').style.display = 'none';

            const isPreview = this.editorMode === 'preview';
            const editorEl  = document.getElementById('editor');
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
        document.getElementById('context-menu').classList.remove('show');
        this._ctxNode = null; this._ctxKind = null;
        document.getElementById('ctx-rename').style.display = '';
        document.getElementById('ctx-delete').style.display = '';
    },

    _handleEditorCtxAction(action) {
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        const getClink = () => {
            if (!nb || !this.activePage) return;
            const link = `web+cento://link?view=${nb.name}/${this.activePage.replace(/\.md$/, '')}`;
            navigator.clipboard.writeText(link).catch(() => {});
            this.toast('Cento link copied.');
        };

        if (this.editorMode === 'preview') {
            if (action === 'copy') { const sel = window.getSelection()?.toString(); if (sel) navigator.clipboard.writeText(sel).catch(() => document.execCommand('copy')); }
            if (action === 'cento-link') getClink();
            return;
        }

        const cm = document.getElementById('editor')?.getActiveCm();
        if (!cm) return;
        const sel = cm.getSelection(), hasText = sel.length > 0;
        const wrap = (o, c) => { if (hasText) cm.replaceSelection(o + sel + c); };

        switch (action) {
            case 'copy':        if (hasText) navigator.clipboard.writeText(sel).catch(() => document.execCommand('copy')); break;
            case 'cut':         if (hasText) { navigator.clipboard.writeText(sel).catch(() => document.execCommand('copy')); cm.replaceSelection(''); } break;
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

        const editorEl = document.getElementById('editor');
        editorEl.style.display = '';
        document.getElementById('welcome').style.display = 'none';
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
            document.getElementById('editor').style.display = 'none';
            document.getElementById('welcome').style.display = '';
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
        const section = document.getElementById('drawer-section');
        const list    = document.getElementById('drawer-list');
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
                <span class="tree-label">${escHtml(file.title)}</span>
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
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), duration);
    },

    _confirm(message) {
        return new Promise(resolve => {
            const dialog = document.getElementById('confirm-dialog');
            document.getElementById('confirm-message').textContent = message;
            dialog.showModal();
            const ok = document.getElementById('confirm-ok'), cancel = document.getElementById('confirm-cancel');
            const finish = result => { dialog.close(); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); resolve(result); };
            const onOk = () => finish(true), onCancel = () => finish(false);
            ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel);
        });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Outline panel
    // ─────────────────────────────────────────────────────────────────────────

    _parseHeadings(content) {
        const headings = [];
        content.split('\n').forEach((line, i) => {
            const m = line.match(/^(#{1,6}) (.*)/);
            if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i });
        });
        return headings;
    },

    _renderOutline() {
        const list = document.getElementById('outline-list');
        if (!list) return;
        list.innerHTML = '';
        const editorEl = document.getElementById('editor');
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
        const ls  = document.getElementById('sidebar');
        const pl  = document.getElementById('page-list-panel');
        const rs  = document.getElementById('right-sidebar');
        const rhr = document.getElementById('resize-right');
        const rpg = document.getElementById('resize-page');
        const st  = document.getElementById('section-tabs-el');

        if (ls)  ls.style.width  = this.sidebarWidth + 'px';

        // The page-list panel and section tabs are only shown when a
        // notebook page (not a Drawer file) is the active view.
        const showNotebookChrome = !!this.activeNotebookId && !this.activeIsDrawer;
        if (pl) {
            pl.style.display = '';   // clear any stale inline display:none from older code paths
            pl.classList.toggle('panel-collapsed', !showNotebookChrome);
            if (showNotebookChrome) pl.style.width = this.pageListWidth + 'px';
        }
        if (rpg) rpg.classList.toggle('handle-collapsed', !showNotebookChrome);
        if (st)  st.classList.toggle('tabs-collapsed', !showNotebookChrome);

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

    /** Wire up the Settings dialog: role tabs, font grid, size slider,
     *  weight chips, live preview, and Apply / Reset actions. The dialog
     *  edits a working draft (this._settingsDraft) so Cancel/close without
     *  Apply leaves the saved typography untouched. */
    _initSettingsModal() {
        const dialog   = document.getElementById('settings-dialog');
        const grid      = document.getElementById('settings-font-grid');
        const weightRow = document.getElementById('settings-weight-row');
        const sizeSlider= document.getElementById('settings-size-slider');
        const sizeValue = document.getElementById('settings-size-value');
        const preview   = document.getElementById('settings-preview-text');
        const roleTabs  = document.querySelectorAll('.settings-role-tab');

        let activeRole = 'body';

        const openDialog = () => {
            // Start each session editing a fresh copy of the current settings
            this._settingsDraft = JSON.parse(JSON.stringify(this.typography));
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

        document.getElementById('btn-settings').addEventListener('click', openDialog);
        document.getElementById('btn-settings-close').addEventListener('click', closeDialog);
        dialog.addEventListener('click', e => { if (e.target === dialog) closeDialog(); });

        document.getElementById('btn-settings-reset').addEventListener('click', () => {
            this._settingsDraft = JSON.parse(JSON.stringify(TYPOGRAPHY_DEFAULTS));
            renderRole();
        });

        document.getElementById('btn-settings-apply').addEventListener('click', () => {
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

    _pushHistory({ notebookId, section, pagePath, handle }) {
        // Discard everything after the current index (forward history is stale)
        this._navHistory = this._navHistory.slice(0, this._navIndex + 1);
        // Don't push a duplicate of the current entry
        const curr = this._navHistory[this._navIndex];
        if (curr && curr.pagePath === pagePath && curr.notebookId === notebookId) return;
        this._navHistory.push({ notebookId, section, pagePath, handle });
        if (this._navHistory.length > 50) this._navHistory.shift();
        this._navIndex = this._navHistory.length - 1;
    },

    _renderNavButtons() {
        const back    = document.getElementById('btn-nav-back');
        const forward = document.getElementById('btn-nav-forward');
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
            // Switch section if needed
            if (entry.section !== this.activeSection) {
                this.activeSection = entry.section;
                this.renderSectionTabs(entry.notebookId);
                this.renderPageList(entry.section);
            }
            await this.openPage(entry.pagePath, entry.handle);
        } finally {
            this._navigating = false;
        }
        this._renderNavButtons();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Default page for section  (called when switching section tabs)
    // ─────────────────────────────────────────────────────────────────────────

    async _openDefaultPageForSection(sectionName) {
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;

        // Try the last page that was active in this section
        const lastPath = nb.session?.sectionLastPage?.[sectionName];
        if (lastPath) {
            const node = this._findPageByPath(nb, lastPath);
            if (node?.handle) { await this.openPage(lastPath, node.handle); return; }
        }

        // Fall back to the first available page in the section
        const pages = sectionName === 'Unfiled'
            ? nb.unfiledPages
            : (nb.sections.find(s => s.name === sectionName)?.pages || []);
        const first = this._walkPages(pages, p => p.type === 'page' && !!p.handle);
        if (first) await this.openPage(first.path, first.handle);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Add section
    // ─────────────────────────────────────────────────────────────────────────

    async addSection(sectionName) {
        const nb = this.notebooks.find(n => n.id === this.activeNotebookId);
        if (!nb) return;
    
        // Resolve any name collision by appending a number
        let name = (sectionName || 'Untitled').trim();
        let i = 1;
        while (nb.sections.find(s => s.name === name)) name = `${sectionName} ${i++}`;
    
        try {
            await nb.handle.getDirectoryHandle(name, { create: true });
            await this._scanNotebook(nb);
            this.activeSection = name;
            this.renderSectionTabs(this.activeNotebookId);
            this.renderPageList(name);
            this.scheduleNotebookSessionSave(this.activeNotebookId);
            this.newPage();
        } catch (e) {
            this.toast('Could not create section: ' + e.message);
        }
    },

};
// App.init() is called from components.js after custom elements are defined.
