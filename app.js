// ─────────────────────────────────────────────────────────────────────────────
// cento — app.js  (vanilla JS + CodeMirror 5)
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'cento-db';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const SESSION_FILE = 'cento-session.json';
const AUTOSAVE_MS = 1500;
const SESSION_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB helpers
// ─────────────────────────────────────────────────────────────────────────────
function openDB() {
    return new Promise( (res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
        r.onsuccess = e => res(e.target.result);
        r.onerror = e => rej(e.target.error);
    }
    );
}
async function dbGet(key) {
    const db = await openDB();
    return new Promise( (res, rej) => {
        const r = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    }
    );
}
async function dbSet(key, val) {
    const db = await openDB();
    return new Promise( (res, rej) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(val, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// File system helpers
// ─────────────────────────────────────────────────────────────────────────────
async function readFile(fh) {
    return (await fh.getFile()).text();
}
async function writeFile(fh, content) {
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
}
async function scanDirectory(dirHandle, path='') {
    const nodes = [];
    for await(const [name,handle] of dirHandle.entries()) {
        if (name.startsWith('.') || name === SESSION_FILE)
            continue;
        const nodePath = path ? `${path}/${name}` : name;
        if (handle.kind === 'directory') {
            const children = await scanDirectory(handle, nodePath);
            nodes.push({
                type: 'folder',
                name,
                path: nodePath,
                handle,
                children
            });
        } else if (name.endsWith('.md')) {
            nodes.push({
                type: 'file',
                name,
                path: nodePath,
                handle,
                title: name.replace(/\.md$/, '')
            });
        }
    }
    nodes.sort( (a, b) => {
        if (a.type !== b.type)
            return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    }
    );
    return nodes;
}
function findNode(tree, path) {
    for (const n of tree) {
        if (n.path === path)
            return n;
        if (n.type === 'folder' && n.children) {
            const f = findNode(n.children, path);
            if (f)
                return f;
        }
    }
    return null;
}
async function resolveDir(vaultHandle, folderPath) {
    if (!folderPath)
        return vaultHandle;
    let dir = vaultHandle;
    for (const part of folderPath.split('/'))
        dir = await dir.getDirectoryHandle(part);
    return dir;
}
async function uniqueFilename(dirHandle, base='sample') {
    const existing = [];
    for await(const [n] of dirHandle.entries())
        existing.push(n);
    let name = base + '.md'
      , i = 1;
    while (existing.includes(name))
        name = `${base}-${i++}.md`;
    return name;
}
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → HTML  (preview mode)
// ─────────────────────────────────────────────────────────────────────────────
function mdToHtml(md) {
    const lines = md.split('\n');
    const out = [];
    let inCode = false, codeBuf = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (raw.startsWith('```')) {
            if (inCode) {
                out.push(`<pre><code>${escHtml(codeBuf.join('\n'))}</code></pre>`);
                codeBuf = []; inCode = false;
            } else { inCode = true; }
            continue;
        }
        if (inCode) { codeBuf.push(raw); continue; }

        let line = raw
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/==(.+?)==/g, '<mark>$1</mark>')
            .replace(/\^(.+?)\^/g, '<sup>$1</sup>')
            .replace(/~(.+?)~/g, '<sub>$1</sub>')
            .replace(/\[\[([^\]]+)\]\]/g, '<a href="#" class="wikilink" data-target="$1">$1</a>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        const hm = raw.match(/^(#{1,6})\s(.*)/);
        if (hm) { out.push(`<h${hm[1].length}>${line.replace(/^#+\s/, '')}</h${hm[1].length}>`); continue; }
        if (/^---+$/.test(raw.trim())) { out.push('<hr/>'); continue; }
        if (raw.startsWith('> ')) { out.push(`<blockquote>${line.slice(5)}</blockquote>`); continue; }
        if (/^\s*[-*]\s/.test(raw)) { out.push(`<li>${line.replace(/^\s*[-*]\s/, '')}</li>`); continue; }
        if (/^\d+\.\s/.test(raw)) { out.push(`<li>${line.replace(/^\d+\.\s/, '')}</li>`); continue; }
        if (line.trim() === '') { out.push('<p></p>'); continue; }
        out.push(`<p>${line}</p>`);
    }
    return out.join('\n').replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CodeMirror 5 live-preview decorations
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
        { line: lineNo, ch: from },
        { line: lineNo, ch: to },
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
        if (inRange) mk(0, 2, 'cm-md-syntax');
        else mk(0, 2, 'cm-md-hidden');
        mk(inRange ? 0 : 2, text.length, 'cm-md-blockquote');
        return;
    }
    if (/^---+$/.test(text.trim())) {
        mk(0, text.length, 'cm-md-syntax');
        return;
    }
    applyInline(cm, lineNo, text, cursorCh);
}

function applyInline(cm, lineNo, text, cursorCh) {
    const mk = (from, to, cls) => cm.markText(
        { line: lineNo, ch: from },
        { line: lineNo, ch: to },
        { className: cls, atomic: false }
    );

    applyPattern(text, /(\*\*\*)(.+?)(\*\*\*)/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-bold cm-md-italic', 'cm-md-syntax');
    applyPattern(text, /(\*\*)([^*\n]+?)(\*\*)/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-bold', 'cm-md-syntax');
    applyPattern(text, /(?<!\*)\*(?!\*)([^*\n]+?)\*/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-italic', 'cm-md-syntax', true);
    applyPattern(text, /(?<!_)_(?!_)([^_\n]+?)_/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-italic', 'cm-md-syntax', true);
    applyPattern(text, /(`)(.*?)(`)/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-code', 'cm-md-syntax');
    applyPattern(text, /(==)(.+?)(==)/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-highlight', 'cm-md-syntax');
    applyPattern(text, /(\^)(.+?)(\^)/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-superscript', 'cm-md-syntax');
    applyPattern(text, /(~)(.+?)(~)/g, cursorCh, mk, 'cm-md-syntax', 'cm-md-subscript', 'cm-md-syntax');

    let m;
    const wikiRe = /\[\[([^\]]+)\]\]/g;
    while ((m = wikiRe.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) {
            mk(start, end, 'cm-md-wikilink');
        } else {
            mk(start, start + 2, 'cm-md-hidden');
            mk(start + 2, start + 2 + m[1].length, 'cm-md-wikilink');
            mk(start + 2 + m[1].length, end, 'cm-md-hidden');
        }
    }

        // This looks for [label](zotero://...)
    const zotRe = /\[([^\]]+)\]\((zotero:\/\/[^)]+)\)/g;
    while ((m = zotRe.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) {
            mk(start, end, 'cm-md-zotero-link');
        } else {
            mk(start, start + 1, 'cm-md-hidden'); // Hide [
            mk(start + 1, start + 1 + m[1].length, 'cm-md-zotero-link');
            mk(start + 1 + m[1].length, end, 'cm-md-hidden');
        }
    }
    
    // Standard Links (Modified to avoid double-matching zotero link)
    const linkRe = /\[([^\]]+)\]\(((?!zotero:\/\/)[^)]+)\)/g;
    while ((m = linkRe.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) {
            mk(start, end, 'cm-md-link');
        } else {
            mk(start, start + 1, 'cm-md-hidden');
            mk(start + 1, start + 1 + m[1].length, 'cm-md-link');
            mk(start + 1 + m[1].length, end, 'cm-md-hidden');
        }
    }
}

function applyPattern(text, re, cursorCh, mk, cls0, cls1, cls2, singleChar = false) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        const full = m[0];
        const start = m.index;
        const content = singleChar ? m[1] : m[2];
        const open = singleChar ? full[0] : m[1];
        const close = singleChar ? full[full.length - 1] : m[3];
        const openLen = open.length, closeLen = close.length;
        const cs = start + openLen, ce = cs + content.length;
        const end = ce + closeLen;
        const inRange = cursorCh >= start && cursorCh <= end;
        if (inRange) {
            mk(start, cs, cls0);
            mk(cs, ce, cls1);
            mk(ce, end, cls2);
        } else {
            mk(start, cs, 'cm-md-hidden');
            mk(cs, ce, cls1);
            mk(ce, end, 'cm-md-hidden');
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// File tree rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderTree(nodes, app, container) {
    container.innerHTML = '';
    nodes.forEach(node => container.appendChild(makeTreeNode(node, app)));
}

function makeTreeNode(node, app) {
    const div = document.createElement('div');
    div.className = 'tree-node';

    if (node.type === 'folder') {
        const isExpanded = app.expandedFolders.has(node.path);
        const isActive = app.activeFolderPath === node.path;

        const row = document.createElement('div');
        row.className = 'tree-row' + (isActive ? ' active-folder' : '');
        row.innerHTML = `
      <svg class="tree-chevron"><use href="${isExpanded ? '#icon-chevron-down' : '#icon-chevron-right'}"/></svg>
      <svg class="tree-icon tree-folder-icon"><use href="#icon-folder"/></svg>
      <span class="tree-label">${escHtml(node.name)}</span>`;

        row.addEventListener('contextmenu', e => app._showContextMenu(e, {
            kind: 'node',
            node
        }));
        row.addEventListener('click', () => {
            if (app.expandedFolders.has(node.path))
                app.expandedFolders.delete(node.path);
            else
                app.expandedFolders.add(node.path);
            app.activeFolderPath = node.path;
            app.renderFileTree();
            app.scheduleSessionSave();
        }
        );
        div.appendChild(row);

        if (isExpanded && node.children.length) {
            const children = document.createElement('div');
            children.className = 'tree-children';
            node.children.forEach(child => children.appendChild(makeTreeNode(child, app)));
            div.appendChild(children);
        }

    } else {
        const activeTab = app.tabs.find(t => t.id === app.activeTabId);
        const isActive = activeTab?.path === node.path;
        const isRenaming = app.renamingPath === node.path;

        const row = document.createElement('div');
        row.className = 'tree-row' + (isActive ? ' active-file' : '');

        if (isRenaming) {
            row.innerHTML = `
        <span style="width:12px;display:inline-block"></span>
        <svg class="tree-icon"><use href="#icon-file"/></svg>`;
            const input = document.createElement('input');
            input.className = 'tree-label-edit';
            input.value = node.title;

            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    app._renameCommitted = true;
                    app.commitRename(node, input.value);
                }
                if (e.key === 'Escape') {
                    app._renameCommitted = true;
                    app.renamingPath = null;
                    app.renderFileTree();
                }
            }
            );
            input.addEventListener('blur', () => {
                if (!app._renameCommitted)
                    app.commitRename(node, input.value);
            }
            );

            row.appendChild(input);
            setTimeout( () => {
                input.select();
                input.focus();
            }
            , 30);
        } else {
            row.innerHTML = `
        <span style="width:12px;display:inline-block"></span>
        <svg class="tree-icon"><use href="#icon-file"/></svg>
        <span class="tree-label">${escHtml(node.title)}</span>`;
            row.addEventListener('contextmenu', e => app._showContextMenu(e, {
                kind: 'node',
                node
            }));
            row.addEventListener('click', () => app.openFile(node.handle, node.path, node.title));
        }
        div.appendChild(row);
    }
    return div;
}


// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
const App = {
    // ── State ──
    vaultHandle: null,
    vaultName: '',
    fileTree: [],
    drawerFiles: [],
    tabs: [],
    activeTabId: null,
    sidebarView: 'tree',
    editorMode: 'live',
    activeFolderPath: '',
    expandedFolders: new Set(),
    renamingPath: null,
    searchQuery: '',
    searchResults: [],
    searchRan: false,
    saveStatus: '',
    outlineVisible: false,
    sidebarWidth: 260,
    rightSidebarWidth: 220,

    // ── Internals ──
    _editors: {},
    _saveTimers: {},
    _sessionTimer: null,
    _decoTimer: null,
    _outlineTimer: null,
    _openingPaths: new Set(),
    _renameCommitted: false,
    // Unified context-menu state
    _ctxNode: null,
    // sidebar node (when context is 'node')
    _ctxKind: null,
    // 'node' | 'editor'
    _pendingVaultHandle: null,

    // ─────────────────────────────────────────────────────────────────────────
    // Boot
    // ─────────────────────────────────────────────────────────────────────────
    init() {
        document.getElementById('btn-open-vault').addEventListener('click', () => this.openVault());
        document.getElementById('btn-open-vault-welcome').addEventListener('click', () => this.openVault());
        document.getElementById('btn-new-file').addEventListener('click', () => this.newFile());
        document.getElementById('btn-sidebar-tree').addEventListener('click', () => this.setSidebarView('tree'));
        document.getElementById('btn-sidebar-search').addEventListener('click', () => {
            this.setSidebarView('search');
            document.getElementById('search-input').focus();
        }
        );
        document.getElementById('btn-toggle-preview').addEventListener('click', () => this.toggleEditorMode());
        document.getElementById('btn-toggle-outline').addEventListener('click', () => this.toggleOutline());
        document.getElementById('btn-save').addEventListener('click', () => this.saveActiveNote());
        document.getElementById('btn-search-go').addEventListener('click', () => this.runSearch());

        this._initResizeDrag(document.getElementById('resize-left'), 'left');
        this._initResizeDrag(document.getElementById('resize-right'), 'right');
        this._applySidebarWidths();

        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('keydown', e => {
            if (e.key === 'Enter')
                this.runSearch();
        }
        );
        searchInput.addEventListener('input', e => {
            this.searchQuery = e.target.value;
        }
        );

        window.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveActiveNote();
            }
        }
        );

        // Wikilink / standard-link clicks inside editor panes
        document.getElementById('panes-container').addEventListener('click', e => {
            const el = e.target.closest('.cm-md-link, .cm-md-wikilink');
            if (!el)
                return;
            e.preventDefault();
            const isWiki = el.classList.contains('cm-md-wikilink');
            const cm = this._editors[this.activeTabId];
            if (!cm)
                return;
            const pos = cm.coordsChar({
                left: e.clientX,
                top: e.clientY
            });
            const line = cm.getLine(pos.line) || '';
            if (isWiki) {
                const m = line.match(/\[\[([^\]]+)\]\]/);
                if (m)
                    this.handleLinkClick({
                        href: m[1],
                        isWiki: true
                    });
            } else {
                const m = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
                if (m)
                    this.handleLinkClick({
                        href: m[2],
                        isWiki: false
                    });
            }
        }
        );

        // ── Disable the native context menu everywhere ──────────────────────
        document.addEventListener('contextmenu', e => {
            e.preventDefault();
            const inEditor = e.target.closest('.CodeMirror, .preview-only-pane');
            if (inEditor)
                this._showContextMenu(e, {
                    kind: 'editor'
                });
        }
        );

        // ── Context-menu item wiring ────────────────────────────────────────
        document.getElementById('ctx-rename').addEventListener('click', () => {
            const node = this._ctxNode;
            this._hideContextMenu();
            if (!node)
                return;
            this._renameCommitted = false;
            this.renamingPath = node.path;
            this.renderFileTree();
        }
        );
        document.getElementById('ctx-delete').addEventListener('click', () => {
            const node = this._ctxNode;
            this._hideContextMenu();
            if (!node)
                return;
            this.deleteNode(node);
        }
        );

        // Editor-pane menu items (populated dynamically, delegated here)
        document.getElementById('context-menu').addEventListener('click', e => {
            const item = e.target.closest('.ctx-editor-item');
            if (!item)
                return;
            if (item.dataset.disabled === 'true')
                return;
            // no-op when dimmed
            this._hideContextMenu();
            this._handleEditorCtxAction(item.dataset.action);
        }
        );

        document.getElementById('btn-reopen-vault').addEventListener('click', async () => {
            const h = this._pendingVaultHandle;
            if (!h) return;

            let per = await h.requestPermission({ mode: 'readwrite' }) ;
            this.toast('Click Tab, then Enter... in under 3s.');
            await new Promise(resolve => setTimeout(resolve, 2500));
            if (await h.queryPermission({ mode: 'readwrite' }) === 'granted')
              await this.mountVault(h);
        });


        // Dismiss on click outside, scroll, or Escape
        document.addEventListener('click', e => {
            if (!e.target.closest('#context-menu'))
                this._hideContextMenu();
        }
        );
        document.addEventListener('scroll', () => this._hideContextMenu(), true);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape')
                this._hideContextMenu();
        }
        );

        // Initial render
        this._renderToolbar();
        this._renderTabsBar();
        this._renderSidebar();

        // File Handling API — receive .md files launched from Explorer / Finder.
        // The browser buffers launch params until a consumer is registered, so
        // registering here (after the DOM is ready) is safe; no extra buffering needed.
        if ('launchQueue' in window) {
            window.launchQueue.setConsumer(params => {
                if (params.files?.length)
                    params.files.forEach(fh => this._openLaunchFile(fh));
                else if (params.targetURL) {
                    const outer = new URL(params.targetURL);
                    const proto = outer.searchParams.get('view');
                    if (proto) {
                        const path = new URL(proto).searchParams.get('view');
                        if (path) this.handleLinkClick({ href: path, isProto: true });
                    }
                }
            });
        }

        // Restore previous vault

        (async () => {
            try {
                const handle = await dbGet('vaultHandle');
                if (handle) {
                    const perm = await handle.queryPermission({ mode: 'readwrite' });
                    if (perm === 'granted') {
                        await this.mountVault(handle);
                    } else {
                        this._pendingVaultHandle = handle;
                        const btn = document.getElementById('btn-reopen-vault');
                        btn.textContent = `Reopen '${handle.name}'`;
                        btn.style.display = '';
                    }
                }
            } catch {}
        })();
        
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Unified context menu
    // ─────────────────────────────────────────────────────────────────────────

    // ctx: { kind: 'node', node } | { kind: 'editor' }
    _showContextMenu(e, ctx) {
        e.preventDefault();
        // Signal the document-level contextmenu listener that this event is
        // already handled so it doesn't open a second editor menu on top.
        this._ctxPending = true;

        const menu = document.getElementById('context-menu');

        // Remove any previously-injected editor items
        menu.querySelectorAll('.ctx-editor-item, .ctx-sep').forEach(el => el.remove());

        if (ctx.kind === 'node') {
            // ── Sidebar node ──
            this._ctxNode = ctx.node;
            this._ctxKind = 'node';
            const renameEl = document.getElementById('ctx-rename');
            const deleteEl = document.getElementById('ctx-delete');
            renameEl.style.display = ctx.node.type === 'folder' ? 'none' : '';
            renameEl.classList.remove('ctx-editor-item');
            deleteEl.classList.remove('ctx-editor-item');
            renameEl.style.display = ctx.node.type === 'folder' ? 'none' : '';

        } else {
            // ── Editor pane ──
            this._ctxNode = null;
            this._ctxKind = 'editor';

            // Hide the static sidebar items
            document.getElementById('ctx-rename').style.display = 'none';
            document.getElementById('ctx-delete').style.display = 'none';

            const isPreview = this.editorMode === 'preview';

            // Determine whether there is a selection — drives which items are active
            let hasSel = false;
            if (isPreview) {
                hasSel = (window.getSelection()?.toString().length ?? 0) > 0;
            } else {
                const cm = this._editors[this.activeTabId];
                hasSel = cm ? cm.getSelection().length > 0 : false;
            }

            // needsSel: true  → item is only meaningful with selected text
            // needsSel: false → item is always available (Paste)
            const items = isPreview ? [
                { action: 'cento-link', label: 'Get Cento link', needsSel: false },
                { sep: true },
                { action: 'copy', label: 'Copy', needsSel: true }
            ] : [
                { action: 'cento-link', label: 'Get Cento link', needsSel: false },
                { sep: true },
                { action: 'copy', label: 'Copy', needsSel: true
            }, {
                action: 'cut',
                label: 'Cut',
                needsSel: true
            }, {
                action: 'paste',
                label: 'Paste',
                needsSel: false
            }, {
                sep: true
            }, {
                action: 'bold',
                label: 'Bold',
                needsSel: true
            }, {
                action: 'italic',
                label: 'Italic',
                needsSel: true
            }, {
                action: 'highlight',
                label: 'Highlight',
                needsSel: true
            }, {
                action: 'superscript',
                label: 'Superscript',
                needsSel: true
            }, {
                action: 'subscript',
                label: 'Subscript',
                needsSel: true
            }, {
                sep: true
            }, {
                action: 'blockquote',
                label: 'Block Quote',
                needsSel: true
            }, {
                action: 'codeblock',
                label: 'Code Block',
                needsSel: true
            }, ];

            items.forEach(item => {
                if (item.sep) {
                    const sep = document.createElement('div');
                    sep.className = 'ctx-sep';
                    menu.appendChild(sep);
                } else {
                    const el = document.createElement('div');
                    const disabled = item.needsSel && !hasSel;
                    el.className = 'ctx-item ctx-editor-item' + (disabled ? ' ctx-disabled' : '');
                    el.dataset.action = item.action;
                    el.dataset.disabled = disabled ? 'true' : 'false';
                    el.textContent = item.label;
                    menu.appendChild(el);
                }
            }
            );
        }

        menu.classList.add('show');
        // Position: keep within viewport
        menu.style.left = '0';
        menu.style.top = '0';
        // reset so offsetWidth is accurate
        const mw = menu.offsetWidth
          , mh = menu.offsetHeight;
        menu.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
        menu.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
    },

    _hideContextMenu() {
        const menu = document.getElementById('context-menu');
        menu.classList.remove('show');
        this._ctxNode = null;
        this._ctxKind = null;
        this._ctxPending = false;
        // ← add this
        document.getElementById('ctx-rename').style.display = '';
        document.getElementById('ctx-delete').style.display = '';
    },

    // Execute an editor context-menu action
    _handleEditorCtxAction(action) {

        const getClink = () => {
            const tab = this.tabs.find(t => t.id === this.activeTabId);
            if (!tab || !this.vaultHandle || tab.path.startsWith('drawer:')) return;
            const link = `web+cento://link?view=${this.vaultName}/${tab.path.replace(/\.md$/, '')}`;
            navigator.clipboard.writeText(link).catch(() => this.toast('Could not copy link.'));
            this.toast('Cento link copied.');
        }
        
        if (this.editorMode === 'preview') {
            // Preview pane — only copy and Cento link
            if (action === 'copy') {
                const sel = window.getSelection()?.toString();
                if (sel)
                    navigator.clipboard.writeText(sel).catch( () => document.execCommand('copy'));
            }
            if (action === 'cento-link') {
                getClink();
            }
            return;
        }

        // Live-preview mode — operate on CodeMirror
        const cm = this._editors[this.activeTabId];
        if (!cm)
            return;

        const sel = cm.getSelection();
        const hasText = sel.length > 0;

        // Wrap selected text with open/close markers — strict no-op without a selection
        const wrapSelection = (open, close) => {
            if (!hasText)
                return;
            cm.replaceSelection(open + sel + close);
        }
        ;

        switch (action) {
        case 'copy':
            if (hasText)
                navigator.clipboard.writeText(sel).catch( () => document.execCommand('copy'));
            break;
        case 'cut':
            if (hasText) {
                navigator.clipboard.writeText(sel).catch( () => document.execCommand('copy'));
                cm.replaceSelection('');
            }
            break;
        case 'paste':
            navigator.clipboard.readText().then(text => {
                if (text)
                    cm.replaceSelection(text);
            }
            ).catch( () => {/* permissions denied — silent */
            }
            );
            break;
        case 'bold':
            wrapSelection('**', '**');
            break;
        case 'italic':
            wrapSelection('*', '*');
            break;
        case 'highlight':
            wrapSelection('==', '==');
            break;
        case 'superscript':
            wrapSelection('^', '^');
            break;
        case 'subscript':
            wrapSelection('~', '~');
            break;
        case 'blockquote':
            {
                if (!hasText)
                    break;
                // Prefix every selected line with '> '
                const from = cm.getCursor('from')
                  , to = cm.getCursor('to');
                cm.operation( () => {
                    for (let ln = from.line; ln <= to.line; ln++) {
                        if (!cm.getLine(ln).startsWith('> '))
                            cm.replaceRange('> ', {
                                line: ln,
                                ch: 0
                            }, {
                                line: ln,
                                ch: 0
                            });
                    }
                }
                );
                break;
            }
        case 'codeblock':
            {
                if (!hasText)
                    break;
                // Wrap selection in a fenced code block
                cm.replaceSelection('```\n' + sel + (sel.endsWith('\n') ? '' : '\n') + '```');
                break;
            }
        case 'cento-link': {
                getClink();
                break;
            }
        }

        cm.focus();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // UI renderers — each updates only its own slice of the DOM
    // ─────────────────────────────────────────────────────────────────────────
    _renderToolbar() {
        const vaultEl = document.getElementById('vault-name');
        if (this.vaultName) {
            vaultEl.textContent = this.vaultName;
            vaultEl.style.display = '';
        } else {
            vaultEl.style.display = 'none';
        }
        document.getElementById('btn-new-file').disabled = !this.vaultHandle;
        document.getElementById('sidebar-vault-name').textContent = this.vaultName || 'No Vault';
        document.getElementById('no-vault-msg').style.display = this.vaultHandle ? 'none' : '';
    },

    _renderTabsBar() {
        const tabsBar = document.getElementById('tabs-bar');
        const welcome = document.getElementById('welcome');
        const hasTab = this.tabs.length > 0;

        tabsBar.style.display = hasTab ? '' : 'none';
        welcome.style.display = hasTab ? 'none' : '';

        tabsBar.innerHTML = '';
        for (const tab of this.tabs) {
            const div = document.createElement('div');
            div.className = 'tab' + (tab.id === this.activeTabId ? ' active' : '');
            div.innerHTML = `
        <span class="tab-title">${escHtml(tab.title)}${tab.dirty ? ' ●' : ''}</span>
        <span class="tab-close"><svg><use href="#icon-x"/></svg></span>`;
            div.addEventListener('click', () => this.activateTab(tab.id));
            div.querySelector('.tab-close').addEventListener('click', e => {
                e.stopPropagation();
                this.closeTab(tab.id);
            }
            );
            tabsBar.appendChild(div);
        }

        const hasActive = !!this.activeTabId;
        const btnPreview = document.getElementById('btn-toggle-preview');
        const btnSave = document.getElementById('btn-save');
        const btnOutline = document.getElementById('btn-toggle-outline');
        btnPreview.style.display = hasActive ? '' : 'none';
        btnSave.style.display = hasActive ? '' : 'none';
        btnOutline.style.display = hasActive ? '' : 'none';

        if (hasActive) {
            const isPreview = this.editorMode === 'preview';
            btnPreview.classList.toggle('active', isPreview);
            btnPreview.dataset.tip = isPreview ? 'Live Preview' : 'Preview Mode';
            btnPreview.querySelector('.svg-eye').style.display = isPreview ? 'none' : '';
            btnPreview.querySelector('.svg-edit').style.display = isPreview ? '' : 'none';
            btnOutline.classList.toggle('active', this.outlineVisible);
        }
    },

    _renderSaveStatus() {
        const el = document.getElementById('save-indicator');
        el.className = this.saveStatus;
        el.textContent = this.saveStatus === 'saving' ? 'saving…' : this.saveStatus === 'saved' ? 'saved' : '';
    },

    _renderSidebar() {
        const isTree = this.sidebarView === 'tree';
        document.getElementById('panel-tree').style.display = isTree ? '' : 'none';
        document.getElementById('panel-search').style.display = isTree ? 'none' : '';
        document.getElementById('btn-sidebar-tree').classList.toggle('active', isTree);
        document.getElementById('btn-sidebar-search').classList.toggle('active', !isTree);
    },

    _renderSearchResults() {
        const list = document.getElementById('search-results-list');
        const empty = document.getElementById('search-empty');
        list.innerHTML = '';
        empty.style.display = (this.searchRan && this.searchResults.length === 0) ? '' : 'none';
        for (const r of this.searchResults) {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `
        <div class="search-result-title">${escHtml(r.title)}</div>
        <div class="search-result-context">${r.context}</div>`;
            div.addEventListener('click', () => this.openFile(r.handle, r.path, r.title));
            list.appendChild(div);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Sidebar
    // ─────────────────────────────────────────────────────────────────────────
    setSidebarView(view) {
        this.sidebarView = view;
        this._renderSidebar();
        this.scheduleSessionSave();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Vault
    // ─────────────────────────────────────────────────────────────────────────
    async openVault() {
        try {
            const handle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            await dbSet('vaultHandle', handle);
            await this.mountVault(handle);
        } catch (e) {
            if (e.name !== 'AbortError')
                this.toast('Could not open folder: ' + e.message);
        }
    },

    async mountVault(handle) {
        this.vaultHandle = handle;
        this.vaultName = handle.name;
        this.activeFolderPath = '';
        this._renderToolbar();
        await this.refreshTree();
        await this.restoreSession();
    },

    async refreshTree() {
        if (!this.vaultHandle)
            return;
        this.fileTree = await scanDirectory(this.vaultHandle);
        this.renderFileTree();
    },

    renderFileTree() {
        const root = document.getElementById('file-tree-root');
        if (root)
            renderTree(this.fileTree, this, root);
        this.renderDrawer();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Session persistence
    // ─────────────────────────────────────────────────────────────────────────
    async saveSession() {
        if (!this.vaultHandle)
            return;
        const session = {
            activeTabId: this.activeTabId,
            editorMode: this.editorMode,
            sidebarView: this.sidebarView,
            activeFolderPath: this.activeFolderPath,
            expandedFolders: [...this.expandedFolders],
            sidebarWidth: this.sidebarWidth,
            rightSidebarWidth: this.rightSidebarWidth,
            outlineVisible: this.outlineVisible,
            tabs: this.tabs.map(t => ({
                id: t.id,
                title: t.title,
                path: t.path,
                scrollTop: this._editors[t.id]?.getScrollInfo().top ?? t.scrollTop ?? 0,
                cursorPos: this._editors[t.id] ? ( () => {
                    const c = this._editors[t.id].getCursor();
                    return {
                        line: c.line,
                        ch: c.ch
                    };
                }
                )() : (t.cursorPos || {
                    line: 0,
                    ch: 0
                }),
            })),
        };
        try {
            const fh = await this.vaultHandle.getFileHandle(SESSION_FILE, {
                create: true
            });
            await writeFile(fh, JSON.stringify(session, null, 2));
        } catch {}
    },

    scheduleSessionSave() {
        clearTimeout(this._sessionTimer);
        this._sessionTimer = setTimeout( () => this.saveSession(), SESSION_MS);
    },

    async restoreSession() {
        try {
            const fh = await this.vaultHandle.getFileHandle(SESSION_FILE);
            const text = await readFile(fh);
            const s = JSON.parse(text);

            this.editorMode = s.editorMode || 'live';
            this.sidebarView = s.sidebarView || 'tree';
            this.activeFolderPath = s.activeFolderPath || '';
            this.expandedFolders = new Set(s.expandedFolders || []);
            if (s.sidebarWidth)      this.sidebarWidth      = s.sidebarWidth;
            if (s.rightSidebarWidth) this.rightSidebarWidth  = s.rightSidebarWidth;
            this.outlineVisible = s.outlineVisible || false;
            this._applySidebarWidths();
            this._renderSidebar();

            if (s.tabs?.length) {
                for (const t of s.tabs) {
                    const node = findNode(this.fileTree, t.path);
                    if (node?.type === 'file')
                        await this.openFile(node.handle, node.path, node.title, t.cursorPos, t.scrollTop, t.id);
                }
                if (s.activeTabId)
                    this.activateTab(s.activeTabId);
            }
            
        } catch {/* no session yet — fine */
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Files / tabs
    // ─────────────────────────────────────────────────────────────────────────
    async openFile(fileHandle, path, title, cursorPos={
        line: 0,
        ch: 0
    }, scrollTop=0, tabId=null) {
        const existing = this.tabs.find(t => t.path === path);
        if (existing) {
            this.activateTab(existing.id);
            return;
        }

        if (this._openingPaths.has(path))
            return;
        this._openingPaths.add(path);

        try {
            const content = await readFile(fileHandle);
            const id = tabId || ('tab-' + Date.now() + '-' + Math.random().toString(36).slice(2));
            this.tabs.push({
                id,
                title,
                path,
                handle: fileHandle,
                dirty: false,
                scrollTop,
                cursorPos
            });
            this.activeTabId = id;
            this._renderTabsBar();

            await new Promise(r => setTimeout(r, 0));
            this.mountEditor(id, content, cursorPos, scrollTop);
            this.renderFileTree();
            this.scheduleSessionSave();
        } finally {
            this._openingPaths.delete(path);
        }
    },

    activateTab(id) {
        const prevCm = this._editors[this.activeTabId];
        if (prevCm) {
            const prevTab = this.tabs.find(t => t.id === this.activeTabId);
            if (prevTab)
                prevTab.scrollTop = prevCm.getScrollInfo().top;
        }

        this.activeTabId = id;

        document.querySelectorAll('.editor-pane, .preview-only-pane').forEach(p => {
            p.classList.remove('active');
        }
        );

        if (this.editorMode === 'preview') {
            let preview = document.querySelector(`.preview-only-pane[data-tab-id="${id}"]`);
            if (!preview) {
                const cm = this._editors[id];
                preview = document.createElement('div');
                preview.className = 'preview-only-pane';
                preview.dataset.tabId = id;
                preview.innerHTML = `<div class="preview-content">${mdToHtml(cm.getValue())}</div>`;
                preview.addEventListener('click', e => {
                    const a = e.target.closest('a');
                    if (!a)
                        return;
                    e.preventDefault();
                    if (a.classList.contains('wikilink'))
                        this.handleLinkClick({
                            href: a.dataset.target,
                            isWiki: true
                        });
                    else
                        window.open(a.href, '_blank');
                }
                );
                document.getElementById('panes-container').appendChild(preview);
            }
            preview.classList.add('active');
        } else {
            document.querySelector(`.editor-pane[data-tab-id="${id}"]`)?.classList.add('active');
        }

        const cm = this._editors[id];
        if (cm) {
            requestAnimationFrame( () => {
                const tab = this.tabs.find(t => t.id === id);
                if (tab)
                    cm.scrollTo(null, tab.scrollTop || 0);
                cm.refresh();
                cm.focus();
                if (this.editorMode === 'live')
                    rebuildDecorations(cm);
            }
            );
        }

        this._renderTabsBar();
        this.renderFileTree();
        if (this.outlineVisible) this._renderOutline();
        this.scheduleSessionSave();
    },

    async closeTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab)
            return;
        if (tab.dirty && !await this._confirm(`"${tab.title}" has unsaved changes. Close anyway?`))
            return;

        if (this._editors[id]) {
            this._editors[id].toTextArea();
            delete this._editors[id];
        }
        document.querySelector(`[data-tab-id="${id}"]`)?.remove();

        const idx = this.tabs.findIndex(t => t.id === id);
        this.tabs.splice(idx, 1);

        // If this tab belonged to a drawer file, evict it from the drawer too
        if (this.drawerFiles.find(f => f.path === tab.path)) {
            this.drawerFiles = this.drawerFiles.filter(f => f.path !== tab.path);
            // renderDrawer() is called implicitly by renderFileTree() below
        }

        if (this.activeTabId === id) {
            const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
            this.activeTabId = next?.id || null;
            if (this.activeTabId)
                this.activateTab(this.activeTabId);
        }

        this._renderTabsBar();
        this.renderFileTree();
        this.scheduleSessionSave();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Mount CodeMirror
    // ─────────────────────────────────────────────────────────────────────────
    mountEditor(tabId, content, cursorPos={
        line: 0,
        ch: 0
    }, scrollTop=0) {
        const container = document.getElementById('panes-container');

        const pane = document.createElement('div');
        pane.className = 'editor-pane active';
        pane.dataset.tabId = tabId;
        container.appendChild(pane);

        container.querySelectorAll('.editor-pane, .preview-only-pane').forEach(p => {
            if (p !== pane)
                p.classList.remove('active');
        }
        );

        const ta = document.createElement('textarea');
        pane.appendChild(ta);

        const cm = CodeMirror.fromTextArea(ta, {
            mode: 'markdown',
            lineWrapping: true,
            autofocus: true,
            styleActiveLine: true,
            extraKeys: {
                'Ctrl-S': () => this.saveActiveNote(),
                'Cmd-S': () => this.saveActiveNote(),
                'Ctrl-K': () => {
                    const sel = cm.getSelection();
                    if (!sel) return;
                    const replacement = `[${sel}]()`;
                    cm.replaceSelection(replacement);
                    const cur = cm.getCursor();
                    cm.setCursor({ line: cur.line, ch: cur.ch - 1 });
                    },
                'Ctrl-V': () => {
                    navigator.clipboard.readText().then(text => {
                        if (text)
                            cm.replaceSelection(text);
                    }).catch( () => {/* permissions denied — silent */});
                    },
            },
        });

        cm.setValue(content);
        cm.setCursor(cursorPos);
        cm.setSize('100%', '100%');
        this._editors[tabId] = cm;

        if (this.editorMode === 'live')
            rebuildDecorations(cm);

        const onCursorOrChange = () => {
            if (this.editorMode !== 'live')
                return;
            clearTimeout(this._decoTimer);
            this._decoTimer = setTimeout( () => rebuildDecorations(cm), 50);
        }
        ;
        cm.on('cursorActivity', onCursorOrChange);
        cm.on('change', (_, change) => {
            onCursorOrChange();
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab && change.origin !== 'setValue') {
                tab.dirty = true;
                this._renderTabsBar();
                this.scheduleAutoSave(tabId);
            }
            if (this.outlineVisible) {
                clearTimeout(this._outlineTimer);
                this._outlineTimer = setTimeout(() => this._renderOutline(), 300);
            }
        }
        );

        requestAnimationFrame( () => {
            cm.scrollTo(null, scrollTop);
            cm.refresh();
        }
        );
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Editor mode  (live ↔ preview)
    // ─────────────────────────────────────────────────────────────────────────
    toggleEditorMode() {
        this.editorMode = this.editorMode === 'live' ? 'preview' : 'live';

        if (this.editorMode === 'preview') {
            const tabId = this.activeTabId;
            const cm = this._editors[tabId];
            if (!cm)
                return;
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab)
                tab.scrollTop = cm.getScrollInfo().top;

            document.querySelector(`.editor-pane[data-tab-id="${tabId}"]`)?.classList.remove('active');
            document.querySelector(`.preview-only-pane[data-tab-id="${tabId}"]`)?.remove();

            const preview = document.createElement('div');
            preview.className = 'preview-only-pane active';
            preview.dataset.tabId = tabId;
            preview.innerHTML = `<div class="preview-content">${mdToHtml(cm.getValue())}</div>`;
            preview.addEventListener('click', e => {
                const a = e.target.closest('a');
                if (!a)
                    return;
                e.preventDefault();
                if (a.classList.contains('wikilink'))
                    this.handleLinkClick({
                        href: a.dataset.target,
                        isWiki: true
                    });
                else
                    window.open(a.href, '_blank');
            }
            );
            document.getElementById('panes-container').appendChild(preview);
            if (tab)
                preview.scrollTop = tab.scrollTop || 0;

        } else {
            document.querySelectorAll('.preview-only-pane').forEach(p => p.remove());
            const tabId = this.activeTabId;
            document.querySelector(`.editor-pane[data-tab-id="${tabId}"]`)?.classList.add('active');
            const cm = this._editors[tabId];
            if (cm) {
                requestAnimationFrame( () => {
                    cm.refresh();
                    cm.focus();
                    rebuildDecorations(cm);
                }
                );
            }
        }

        this._renderTabsBar();
        this.scheduleSessionSave();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Save
    // ─────────────────────────────────────────────────────────────────────────
    scheduleAutoSave(tabId) {
        clearTimeout(this._saveTimers[tabId]);
        this._saveTimers[tabId] = setTimeout( () => this.saveTab(tabId), AUTOSAVE_MS);
    },

    async saveActiveNote() {
        if (this.activeTabId)
            await this.saveTab(this.activeTabId);
    },

    async saveTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        const cm = this._editors[tabId];
        if (!tab || !cm)
            return;

        this.saveStatus = 'saving';
        this._renderSaveStatus();
        try {
            await writeFile(tab.handle, cm.getValue());
            tab.dirty = false;
            this.saveStatus = 'saved';
            this._renderSaveStatus();
            this._renderTabsBar();
            setTimeout( () => {
                if (this.saveStatus === 'saved') {
                    this.saveStatus = '';
                    this._renderSaveStatus();
                }
            }
            , 2000);
            this.scheduleSessionSave();
        } catch (e) {
            this.saveStatus = '';
            this._renderSaveStatus();
            this.toast('Save failed: ' + e.message);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // New file
    // ─────────────────────────────────────────────────────────────────────────
    async newFile() {
        if (!this.vaultHandle)
            return;
        let dirHandle;
        try {
            dirHandle = this.activeFolderPath ? await resolveDir(this.vaultHandle, this.activeFolderPath) : this.vaultHandle;
        } catch {
            dirHandle = this.vaultHandle;
        }

        const filename = await uniqueFilename(dirHandle, 'sample');
        const fh = await dirHandle.getFileHandle(filename, {
            create: true
        });
        await writeFile(fh, '');

        const path = this.activeFolderPath ? `${this.activeFolderPath}/${filename}` : filename;
        const title = filename.replace(/\.md$/, '');

        await this.refreshTree();
        await this.openFile(fh, path, title);

        await new Promise(r => setTimeout(r, 50));
        this._renameCommitted = false;
        this.renamingPath = path;
        this.renderFileTree();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Rename
    // ─────────────────────────────────────────────────────────────────────────
    async commitRename(node, newTitle) {
        this.renamingPath = null;
        if (!newTitle?.trim()) {
            this.renderFileTree();
            return;
        }

        const newName = newTitle.trim().replace(/\.md$/, '') + '.md';
        if (newName === node.name) {
            this.renderFileTree();
            return;
        }

        const parentPath = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';

        try {
            const dirHandle = parentPath ? await resolveDir(this.vaultHandle, parentPath) : this.vaultHandle;

            try {
                await dirHandle.getFileHandle(newName);
                this.toast('A file with that name already exists.');
                this.renderFileTree();
                return;
            } catch {}

            const content = await readFile(node.handle);
            const newFh = await dirHandle.getFileHandle(newName, {
                create: true
            });
            await writeFile(newFh, content);
            await dirHandle.removeEntry(node.name);

            const tab = this.tabs.find(t => t.path === node.path);
            if (tab) {
                const newPath = parentPath ? `${parentPath}/${newName}` : newName;
                tab.title = newName.replace(/\.md$/, '');
                tab.path = newPath;
                tab.handle = newFh;
            }

            await this.refreshTree();
            this._renderTabsBar();
            this.scheduleSessionSave();
        } catch (e) {
            this.toast('Rename failed: ' + e.message);
            this.renderFileTree();
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Search
    // ─────────────────────────────────────────────────────────────────────────
    async runSearch() {
        if (!this.vaultHandle || !this.searchQuery.trim())
            return;
        this.searchResults = [];
        this.searchRan = true;
        await this._searchNodes(this.fileTree, this.searchQuery.toLowerCase());
        this._renderSearchResults();
    },

    async _searchNodes(nodes, query) {
        for (const node of nodes) {
            if (node.type === 'folder' && node.children) {
                await this._searchNodes(node.children, query);
            } else if (node.type === 'file') {
                try {
                    const text = await readFile(node.handle);
                    const lines = text.split('\n');
                    const idx = lines.findIndex(l => l.toLowerCase().includes(query));
                    if (idx === -1)
                        continue;
                    const line = lines[idx];
                    const matchPos = line.toLowerCase().indexOf(query);
                    const start = Math.max(0, matchPos - 40);
                    const end = Math.min(line.length, matchPos + query.length + 40);
                    const snippet = (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
                    const highlighted = escHtml(snippet).replace(new RegExp(escHtml(query),'gi'), m => `<mark>${m}</mark>`);
                    this.searchResults.push({
                        path: node.path,
                        handle: node.handle,
                        title: node.title,
                        context: highlighted
                    });
                } catch {}
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Link navigation
    // ─────────────────────────────────────────────────────────────────────────

    async handleLinkClick({ href, isWiki, isProto }) {
        if (isProto) {
            const parts = href.split('/');
            const vaultName = parts[0];
            const filePath = parts.slice(1).join('/') + '.md';
            if (!this.vaultHandle) {
                this.toast(`Open vault "${vaultName}" to follow this link.`);
                return;
            }
            if (this.vaultName !== vaultName) {
                this.toast(`Open vault "${vaultName}" to follow this link.`);
                return;
            }
            const node = findNode(this.fileTree, filePath);
            if (node)
                await this.openFile(node.handle, node.path, node.title);
            else
                this.toast(`Note not found: ${href}`);
            return;
        }
        if (isWiki) {
            const match = this._findNoteByTitle(this.fileTree, href);
            if (match)
                await this.openFile(match.handle, match.path, match.title);
            else
                this.toast(`Note not found: [[${href}]]`);
        } else {
            if (/^https?:\/\//.test(href)) {
                window.open(href, '_blank');
                return;
            }
            const node = findNode(this.fileTree, href);
            if (node)
                await this.openFile(node.handle, node.path, node.title);
            else
                this.toast(`Note not found: ${href}`);
        }
    },

    _findNoteByTitle(nodes, title) {
        for (const n of nodes) {
            if (n.type === 'file' && n.title.toLowerCase() === title.toLowerCase())
                return n;
            if (n.type === 'folder' && n.children) {
                const f = this._findNoteByTitle(n.children, title);
                if (f)
                    return f;
            }
        }
        return null;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Delete node
    // ─────────────────────────────────────────────────────────────────────────
    async deleteNode(node) {
        const label = node.type === 'folder' ? `folder "${node.name}" and all its contents` : `"${node.name}"`;
        if (!await this._confirm(`Permanently delete ${label}?`))
            return;

        const parentPath = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';

        try {
            const dirHandle = parentPath ? await resolveDir(this.vaultHandle, parentPath) : this.vaultHandle;
            await dirHandle.removeEntry(node.name, {
                recursive: true
            });

            const pathPrefix = node.type === 'folder' ? node.path + '/' : null;
            const toClose = this.tabs.filter(t => t.path === node.path || (pathPrefix && t.path.startsWith(pathPrefix)));
            for (const tab of toClose)
                await this.closeTab(tab.id);

            await this.refreshTree();
            this.scheduleSessionSave();
        } catch (e) {
            this.toast('Delete failed: ' + e.message);
        }
    },

    _confirm(message) {
    return new Promise(resolve => {
        const dialog = document.getElementById('confirm-dialog');
        document.getElementById('confirm-message').textContent = message;
        dialog.showModal();
        const ok     = document.getElementById('confirm-ok');
        const cancel = document.getElementById('confirm-cancel');
        const finish = result => {
            dialog.close();
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            resolve(result);
        };
        const onOk     = () => finish(true);
        const onCancel = () => finish(false);
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
    });
},
    // ─────────────────────────────────────────────────────────────────────────
    // Drawer  (stray .md files opened via the File Handling API)
    // ─────────────────────────────────────────────────────────────────────────
    async _openLaunchFile(fileHandle) {
        const name = fileHandle.name;
        if (!name.endsWith('.md')) return;
        const path = 'drawer:' + name;

        // Already in the drawer — just focus the existing tab
        if (this.drawerFiles.find(f => f.path === path)) {
            const existing = this.tabs.find(t => t.path === path);
            if (existing) this.activateTab(existing.id);
            return;
        }

        const title = name.replace(/\.md$/, '');
        this.drawerFiles.push({ name, path, title, handle: fileHandle });
        this.renderDrawer();
        await this.openFile(fileHandle, path, title);
    },

    async removeDrawerFile(path) {
        const tab = this.tabs.find(t => t.path === path);
        if (tab) {
            // Delegate to closeTab so the dirty-confirm still works.
            // closeTab's own hook will strip the drawerFiles entry on success.
            await this.closeTab(tab.id);
            // If the tab is still alive the user cancelled — leave the drawer entry too.
            return;
        }
        // No open tab — remove the entry directly
        this.drawerFiles = this.drawerFiles.filter(f => f.path !== path);
        this.renderDrawer();
    },

    renderDrawer() {
        const section = document.getElementById('drawer-section');
        const list    = document.getElementById('drawer-list');
        if (!section || !list) return;

        if (!this.drawerFiles.length) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        list.innerHTML = '';

        const activeTab = this.tabs.find(t => t.id === this.activeTabId);

        for (const file of this.drawerFiles) {
            const isActive = activeTab?.path === file.path;
            const row = document.createElement('div');
            row.className = 'tree-row' + (isActive ? ' active-file' : '');
            row.innerHTML = `
                <span style="width:12px;display:inline-block"></span>
                <svg class="tree-icon"><use href="#icon-file"/></svg>
                <span class="tree-label">${escHtml(file.title)}</span>
                <button class="drawer-remove-btn" title="Remove from Drawer">
                    <svg><use href="#icon-x"/></svg>
                </button>`;

            row.addEventListener('click', e => {
                if (e.target.closest('.drawer-remove-btn')) return;
                this.openFile(file.handle, file.path, file.title);
            });
            row.querySelector('.drawer-remove-btn').addEventListener('click', e => {
                e.stopPropagation();
                this.removeDrawerFile(file.path);
            });

            list.appendChild(row);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Toast
    // ─────────────────────────────────────────────────────────────────────────
    toast(msg, duration=3000) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout( () => el.classList.remove('show'), duration);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Outline
    // ─────────────────────────────────────────────────────────────────────────
    _parseHeadings(content) {
        const headings = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^(#{1,6}) (.*)/);
            if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i });
        }
        return headings;
    },

    _renderOutline() {
        const list = document.getElementById('outline-list');
        if (!list) return;
        list.innerHTML = '';
        const cm = this._editors[this.activeTabId];
        if (!cm) {
            list.innerHTML = '<div class="outline-empty">No note open.</div>';
            return;
        }
        const headings = this._parseHeadings(cm.getValue());
        if (!headings.length) {
            list.innerHTML = '<div class="outline-empty">No headings found.</div>';
            return;
        }
        for (const h of headings) {
            const item = document.createElement('div');
            item.className = `outline-item ol-h${h.level}`;
            item.textContent = h.text;
            item.title = h.text;
            item.addEventListener('click', () => {
                cm.setCursor({ line: h.line, ch: 0 });
                cm.scrollIntoView({ line: h.line, ch: 0 }, 100);
                if (this.editorMode === 'live') cm.focus();
            });
            list.appendChild(item);
        }
    },

    toggleOutline() {
        this.outlineVisible = !this.outlineVisible;
        this._applySidebarWidths();
        if (this.outlineVisible) this._renderOutline();
        this._renderTabsBar();
        this.scheduleSessionSave();
    },

    _applySidebarWidths() {
        const ls = document.getElementById('sidebar');
        const rs = document.getElementById('right-sidebar');
        const rh = document.getElementById('resize-right');
        if (ls) ls.style.width = this.sidebarWidth + 'px';
        if (rs) {
            rs.style.display = this.outlineVisible ? '' : 'none';
            if (this.outlineVisible) rs.style.width = this.rightSidebarWidth + 'px';
        }
        if (rh) rh.style.display = this.outlineVisible ? '' : 'none';
    },

    _initResizeDrag(handleEl, side) {
        if (!handleEl) return;
        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            handleEl.classList.add('dragging');
            const startX = e.clientX;
            const startW = side === 'left' ? this.sidebarWidth : this.rightSidebarWidth;
            const onMove = e => {
                const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
                const newW = Math.min(480, Math.max(160, startW + delta));
                if (side === 'left') this.sidebarWidth = newW;
                else this.rightSidebarWidth = newW;
                this._applySidebarWidths();
            };
            const onUp = () => {
                handleEl.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this.scheduleSessionSave();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },
};

App.init();
