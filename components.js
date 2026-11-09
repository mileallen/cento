// ─────────────────────────────────────────────────────────────────────────────
// components.js — Cento Web Components
//
// Load order: codemirror → markdown → typo → app.js → components.js
// app.js defines the global App object and helpers (rebuildDecorations).
// This file defines custom elements that call those globals, then boots App.init().
//
// Shadow DOM is used for all UI shell components so their internal styles are
// encapsulated. CSS custom properties (--accent, --bg, etc.) defined on :root
// in looks.css pierce Shadow DOM boundaries automatically — so the theme applies
// everywhere without any extra work.
//
// <cento-editor> is the sole exception: it uses NO Shadow DOM because CodeMirror 5
// generates class names (.CodeMirror, .cm-h1, .cm-spell-error …) that must match
// global rules in looks.css. Attaching a shadow root would block those rules.
// ─────────────────────────────────────────────────────────────────────────────

/** Fire a CustomEvent that bubbles out of any shadow root, so App can listen on the document. */
const emit = (el, name, detail = {}) =>
    el.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));

/** Inline text box used for every rename / "add" in the UI. It sits inside `host`, and exactly
 *  one of onCommit(value) / onCancel() fires: Enter or blur commits, Escape cancels. */
function inlineInput(host, { value, className, spellcheck = true }, onCommit, onCancel) {
    const input = document.createElement('input');
    input.className  = className;
    input.value      = value;
    input.spellcheck = spellcheck;
    host.appendChild(input);

    let done = false;
    const finish = commit => {
        if (done) return;
        done = true;
        commit ? onCommit(input.value) : onCancel();
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => { input.select(); input.focus(); }, 30);
    return input;
}

// ─────────────────────────────────────────────────────────────────────────────
// <notebook-entry>
//
// Represents one open notebook in the left sidebar list.
// Attributes : name, notebook-id, active (boolean presence attr)
// Fires       : notebook-activate  { detail: { id } }   — on body click
//               notebook-close     { detail: { id } }   — on × button
// ─────────────────────────────────────────────────────────────────────────────
class NotebookEntry extends HTMLElement {
    static get observedAttributes() {
        return ['name'];
    }

    constructor() {
        super();
        this.attachShadow({
            mode: 'open'
        });
        this.shadowRoot.innerHTML = `
        <style>
            :host { display: block; }
            .entry {
                display: flex; align-items: center;
                padding: 5px 8px 5px 0;
                border-radius: var(--radius);
                margin: 1px 4px;
                cursor: pointer;
                gap: 0;
                min-height: 30px;
                /* border-left: 3px solid transparent; */
                transition: background var(--transition), border-color var(--transition);
                font-family: var(--font-ui);
                -webkit-app-region: no-drag;
                user-select: none;
            }
            .entry:hover { background: var(--bg-hover); }
            :host([active]) .entry {
                /* border-left-color: var(--accent); */
                background: var(--accent-glow);
            }
            .name {
                flex: 1;
                font-size: 13px;
                color: var(--text);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                padding-left: 10px;
            }
            :host([active]) .name { color: var(--text-bright); }
            .close {
                width: 18px; height: 18px;
                display: none;
                align-items: center; justify-content: center;
                border: none; background: none;
                color: var(--text-dim);
                cursor: pointer;
                border-radius: 3px;
                font-size: 14px; line-height: 1;
                flex-shrink: 0;
                margin-right: 4px;
                font-family: var(--font-ui);
            }
            .close:hover { color: var(--text-bright); background: var(--bg-hover); }
            :host(:hover) .close { display: flex; }
        </style>
        <div class="entry">
            <span class="name"></span>
            <button class="close" title="Close notebook">×</button>
        </div>`;

        this.shadowRoot.querySelector('.entry').addEventListener('click', e => {
            if (e.target.closest('.close'))
                return;
            // composed: true lets the event escape the shadow boundary so App can hear it
            emit(this, 'notebook-activate', { id: Number(this.getAttribute('notebook-id')) });
        }
        );

        this.shadowRoot.querySelector('.close').addEventListener('click', e => {
            e.stopPropagation();
            emit(this, 'notebook-close', { id: Number(this.getAttribute('notebook-id')) });
        }
        );
    }

    attributeChangedCallback(name, _old, val) {
        // Update the visible label when the `name` attribute changes
        if (name === 'name') {
            const el = this.shadowRoot.querySelector('.name');
            if (el)
                el.textContent = val || '';
        }
    }
}
customElements.define('notebook-entry', NotebookEntry);

// ─────────────────────────────────────────────────────────────────────────────
// <section-tabs>
//
// Horizontal scrollable row of section tabs at the top of #main.
// Attributes : sections       — JSON array of { name } objects
//              active-section — currently selected section name
//              variant        — optional; "subsection" renders a second-level
//                               row with smaller height and subtly different
//                               colors. variant="zen" is the flat, add-less note
//                               tab row of Zen mode (fires zen-change { section }).
//                               Also changes the fired event names:
//                                 section-change  → subsection-change
//                                 section-add     → subsection-add
// Fires       : section-change     { detail: { section: name } }   (default)
//               section-add        { detail: { name } }            (default)
//             OR
//               subsection-change  { detail: { section: name } }   (variant="subsection")
//               subsection-add     { detail: { name } }            (variant="subsection")
// ─────────────────────────────────────────────────────────────────────────────
class SectionTabs extends HTMLElement {
    static get observedAttributes() {
        return ['sections', 'active-section', 'variant'];
    }

    constructor() {
        super();
        this.attachShadow({
            mode: 'open'
        });
        this.shadowRoot.innerHTML = `
        <style>
            :host { display: block; flex-shrink: 0; }
            .bar {
                display: flex;
                background: var(--bg-tab);
                border-bottom: 1px solid var(--border);
                overflow-x: auto;
                /* Hide the scrollbar visually while keeping scroll behaviour */
                scrollbar-width: none;
                padding: 0 4px;
                align-items: flex-end;
                height: var(--tab-h, 38px);
            }
            .bar::-webkit-scrollbar { display: none; }
            .tab {
                display: flex; align-items: center;
                padding: 0 18px;
                height: 32px;
                background: transparent;
                border: 1px solid transparent;
                border-bottom: none;
                border-radius: 6px 6px 0 0;
                cursor: pointer;
                font-size: 13px;
                font-family: var(--font-ui);
                color: var(--text-dim);
                white-space: nowrap;
                transition: background var(--transition), color var(--transition);
                flex-shrink: 0;
                user-select: none;
                position: relative;
            }
            .tab:hover { background: var(--bg-hover); color: var(--text); }
            .tab.active {
                background: var(--bg-tab-active);
                border-color: var(--border);
                color: var(--text-bright);
            }
            /* Mask the bottom border so active tab appears connected to editor */
            .tab.active::after {
                content: '';
                position: absolute;
                bottom: -1px; left: 0; right: 0;
                height: 1px;
                background: var(--bg-tab-active);
            }
            /* Add-section button sits after the last tab, at the right edge */
            .add-section-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 26px;
                height: 26px;
                margin: auto 4px;
                background: transparent;
                border: 1px dashed var(--border-light);
                border-radius: var(--radius);
                color: var(--text-dim);
                cursor: pointer;
                font-size: 17px;
                font-family: var(--font-ui);
                line-height: 1;
                flex-shrink: 0;
                transition: color var(--transition), border-color var(--transition), background var(--transition);
            }
            .add-section-btn:hover {
                color: var(--accent);
                border-color: var(--accent);
                background: var(--accent-glow);
            }
            .new-tab-input {
                background: var(--surface);
                border: 1px solid var(--accent);
                border-radius: 3px;
                color: var(--text-bright);
                font-family: var(--font-ui);
                font-size: 13px;
                padding: 1px 8px;
                outline: none;
                width: 90px;
            }

            /* ── Sub-section variant ───────────────────────────────────────────
               Same structural layout as the section row, but shorter and with
               subtly differentiated colors so it reads as "one level down".
               Driven by the host attribute [variant="subsection"], which the
               app sets on the second <section-tabs> element. */
            :host([variant="subsection"]) .bar {
                background: var(--bg-tab-sub);
                border-bottom-color: var(--border-sub);
                height: var(--tab-h-sub, 30px);
            }
            :host([variant="subsection"]) .tab {
                height: 26px;
                padding: 0 14px;
                font-size: 12px;
                color: var(--text-sub);
                border-radius: 5px 5px 0 0;
            }
            :host([variant="subsection"]) .tab:hover {
                background: var(--bg-hover);
                color: var(--text-sub-active);
            }
            :host([variant="subsection"]) .tab.active {
                background: var(--bg-tab-sub-active);
                border-color: var(--border-sub);
                color: var(--text-sub-active);
            }
            :host([variant="subsection"]) .tab.active::after {
                background: var(--bg-tab-sub-active);
            }
            :host([variant="subsection"]) .add-section-btn {
                width: 22px;
                height: 22px;
                font-size: 15px;
                border-radius: 5px;
            }
            :host([variant="subsection"]) .new-tab-input {
                font-size: 12px;
                width: 80px;
                padding: 1px 6px;
            }

            /* ── Zen variant: the note tabs in the Zen bar. Flat, no + button; the
               bar's own background and border come from #zen-bar in looks.css. */
            :host([variant="zen"]) { flex: 1; min-width: 0; }
            :host([variant="zen"]) .bar { background: transparent; border-bottom: none; align-items: center; padding: 0; }
            :host([variant="zen"]) .tab { height: 28px; padding: 0 14px; font-size: 12.5px; border: none; border-radius: 6px; }
            :host([variant="zen"]) .tab.active { background: var(--bg-tab-active); color: var(--text-bright); }
            :host([variant="zen"]) .tab.active::after,
            :host([variant="zen"]) .add-section-btn { display: none; }
        </style>
        <div class="bar" part="bar"></div>`;
    }

    /** Event names depend on variant — callers listen on the host element
     *  directly, so the names just need to differ between the two rows. */
    get _variant()     { return this.getAttribute('variant'); }
    get _changeEvent() { return { subsection: 'subsection-change', zen: 'zen-change' }[this._variant] || 'section-change'; }
    get _addEvent()    { return this._variant === 'subsection' ? 'subsection-add'  : 'section-add'; }
    get _addLabel()    { return this._variant === 'subsection' ? 'Add Sub-section' : 'Add Section'; }

    connectedCallback() {
        this._render();
    }
    // The app sets 'sections' and 'active-section' back to back: draw once, after both.
    attributeChangedCallback() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        queueMicrotask(() => { this._renderQueued = false; this._render(); });
    }

    _render() {
        const bar = this.shadowRoot.querySelector('.bar');
        if (!bar)
            return;
        bar.innerHTML = '';

        let sections = [];
        try {
            sections = JSON.parse(this.getAttribute('sections') || '[]');
        } catch {}
        const active = this.getAttribute('active-section') || '';

        sections.forEach(sec => {
            const tab = document.createElement('div');
            tab.className = 'tab' + (sec.name === active ? ' active' : '');
            // sec.label (optional) lets callers display a friendlier label than
            // sec.name — used by the sub-section row's "Pages" pseudo-tab,
            // whose real name is the PAGES_PSEUDO_TAB sentinel.
            tab.textContent = sec.label || sec.name;
            tab.dataset.name = sec.name;
            if (sec.tip) tab.title = sec.tip;   // optional hover text (used by the Zen bar)
            // Right-click: the app shows its shared context menu (Rename / Delete) at the pointer
            tab.addEventListener('contextmenu', e => {
                e.preventDefault();
                emit(this, 'tab-contextmenu', { name: sec.name, x: e.clientX, y: e.clientY });
            });
            tab.addEventListener('click', () => {
                emit(this, this._changeEvent, { section: sec.name });
            }
            );
            bar.appendChild(tab);
        }
        );

        // Add-section button always sits after the last tab
        const addBtn = document.createElement('button');
        addBtn.className = 'add-section-btn';
        addBtn.textContent = '+';
        addBtn.title = this._addLabel;
        addBtn.addEventListener('click', () => this._startAddSection());
        bar.appendChild(addBtn);
    }

    _startAddSection() {
        const bar = this.shadowRoot.querySelector('.bar');
        // Prevent opening a second input if one is already active
        if (!bar || bar.querySelector('.new-tab-input'))
            return;

        const tempTab = document.createElement('div');
        tempTab.className = 'tab';
        // Slot it in before the + button
        bar.insertBefore(tempTab, bar.querySelector('.add-section-btn'));

        inlineInput(tempTab, { value: 'Untitled', className: 'new-tab-input', spellcheck: false },
            value => {
                const name = value.trim() || 'Untitled';
                tempTab.remove();
                emit(this, this._addEvent, { name });
            },
            () => tempTab.remove());
    }

    /** Rename in place: the tab turns into a text box. Called by the app from the context menu.
     *  Fires tab-rename { oldName, newName }; the app renames the folder and re-renders the tabs. */
    startRename(name) {
        const bar = this.shadowRoot.querySelector('.bar');
        if (!bar || bar.querySelector('.new-tab-input'))
            return;
        const tab = [...bar.querySelectorAll('.tab')].find(t => t.dataset.name === name);
        if (!tab)
            return;
        tab.textContent = '';
        inlineInput(tab, { value: name, className: 'new-tab-input', spellcheck: false },
            value => {
                const newName = value.trim();
                this._render();   // restore the tab at once; the app re-renders again after the folder is renamed
                if (newName && newName !== name)
                    emit(this, 'tab-rename', { oldName: name, newName });
            },
            () => this._render());
    }
}
customElements.define('section-tabs', SectionTabs);

// ─────────────────────────────────────────────────────────────────────────────
// <page-list>
//
// Scrollable container for the page list panel. Acts as a styled host for
// <page-list-item> rows placed by the App in its light DOM slot.
// ─────────────────────────────────────────────────────────────────────────────
class PageList extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({
            mode: 'open'
        });
        this.shadowRoot.innerHTML = `
        <style>
            :host { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
            .scroll { flex: 1; overflow-y: auto; padding: 4px 0; }
        </style>
        <div class="scroll"><slot></slot></div>`;
    }
}
customElements.define('page-list', PageList);

// ─────────────────────────────────────────────────────────────────────────────
// <page-list-item>
//
// A single page row in the page list panel.
//
// Attributes:
//   title       — display name
//   page-path   — relative path within the notebook
//   active      — presence attr; highlights this row
//   renaming    — presence attr; switches label to inline input
//
// Fires (bubbles=true, composed=true so they cross shadow boundaries):
//   page-select      { detail: { path } }
//   page-contextmenu { detail: { path, title } }
//   page-rename      { detail: { path, newTitle } }
// ─────────────────────────────────────────────────────────────────────────────
class PageListItem extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'renaming'];   // active is CSS-only
    }

    constructor() {
        super();
        this.attachShadow({
            mode: 'open'
        });
        this.shadowRoot.innerHTML = `
        <style>
            :host { display: block; }
            .item {
                display: flex; align-items: center;
                padding: 4px 8px;
                border-radius: var(--radius);
                margin: 0 4px;
                cursor: pointer;
                gap: 4px;
                min-height: 28px;
                transition: background var(--transition), color var(--transition);
                font-size: 13px;
                font-family: var(--font-ui);
                color: var(--text);
                user-select: none;
                -webkit-app-region: no-drag;
            }
            .item:hover { background: var(--bg-hover); }
            :host([active]) .item { background: var(--accent-glow); color: var(--accent); }
            /* Left gutter: keeps labels (and the rename box) exactly where they have always sat */
            .indent { width: 6px; flex-shrink: 0; }
            .label {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1;
            }
            .rename-input {
                flex: 1;
                background: var(--surface);
                border: 1px solid var(--accent);
                border-radius: 3px;
                color: var(--text-bright);
                font-family: var(--font-ui);
                font-size: 13px;
                padding: 1px 5px;
                outline: none;
                min-width: 0;
            }
        </style>
        <div class="item">
            <span class="indent"></span>
            <span class="label"></span>
        </div>`;

        const item = this.shadowRoot.querySelector('.item');

        item.addEventListener('click', () => {
            const path = this.getAttribute('page-path');
            if (path) emit(this, 'page-select', { path });
        });

        item.addEventListener('contextmenu', e => {
            e.preventDefault();
            const path = this.getAttribute('page-path');
            if (!path) return;
            emit(this, 'page-contextmenu', { path, title: this.getAttribute('title') || '', x: e.clientX, y: e.clientY });
        });
    }

    connectedCallback() {
        this._sync();
    }

    attributeChangedCallback(name, _old, val) {
        if (name !== 'renaming') this._sync();
        else if (val !== null)   this._showRenameInput();
    }

    _sync() {
        const label = this.shadowRoot.querySelector('.label');
        if (label)
            label.textContent = this.getAttribute('title') || '';
    }

    _showRenameInput() {
        const label = this.shadowRoot.querySelector('.label');
        if (!label) return;
        label.style.display = 'none';

        const restore = () => { input.remove(); label.style.display = ''; this.removeAttribute('renaming'); };
        const input = inlineInput(this.shadowRoot.querySelector('.item'),
            { value: this.getAttribute('title') || '', className: 'rename-input' },
            value => {
                const newTitle = value.trim();
                restore();
                if (newTitle && newTitle !== this.getAttribute('title'))
                    emit(this, 'page-rename', { path: this.getAttribute('page-path'), newTitle });
            },
            restore);
    }
}
customElements.define('page-list-item', PageListItem);

// ─────────────────────────────────────────────────────────────────────────────
// <cento-editor>
//
// Wraps the full CodeMirror multi-column editing machinery.
// NO Shadow DOM — CodeMirror's global CSS class names must match rules in
// looks.css, which a shadow root would block.
//
// Public API (called by App):
//   load(rawContent, columnsData)  — parse <!column> delimiters, mount CMs
//   editorMode get/set             — 'live' | 'preview'
//   getContent()                   — joined column text (for saving)
//   getColumnsState()              — [{scrollTop, cursorPos}] (for session)
//   getColumnCms()                 — raw CM array (for outline panel)
//   getActiveCm()                  — focused CM (for context-menu actions)
//   addColumn()                    — insert <!column> at cursor and split
//   removeColumn()                 — merge last column into previous, fire content-change
//   getColumnCount()               — number of current columns
//   refresh()                      — force CM refresh (e.g. after panel resize)
//   focusActive()                  — focus the active CM
//   setActiveColumn(idx)           — set _focusedColIdx (for outline click)
//
// Events fired (bubbles: true so App catches them on the document or a parent):
//   content-change   — content changed, App should schedule autosave
//   cursor-change    — cursor moved, App updates outline if open
//   column-count-change { detail: { count } } — App updates toolbar button states
//   link-click      { detail: { href, isWiki } } — user clicked a link in preview
// ─────────────────────────────────────────────────────────────────────────────
class CentoEditor extends HTMLElement {
    constructor() {
        super();
        // Internal state — no shadow root; all DOM appended directly to this element
        this._cms = [];
        // array of CodeMirror instances (one per column)
        this._focusedColIdx = 0;
        // index of the column that currently has focus
        this._decoTimer = null;
        // debounce handle for live-preview decorations
        this._editorMode = 'live';
        // 'live' | 'preview'
        this._pane = null;
        // the .editor-pane div that hosts col-panes
        this._previewPane = null;
        // the .preview-only-pane div (exists in preview mode)
        this.wikiSuggest = null;
        // set by the app: query => [{ title, hint }] (page titles for the [[ menu)
        this._wiki = null;
        // the open [[ menu: { cm, from, items, sel }
        this._typed = false;
        // set by a typing change; consumed by the next cursorActivity
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Load new content. Destroys existing CMs and rebuilds. */
    load(rawContent, columnsData=[]) {
        this._wikiClose();
        this._clearEditor();
        this._buildEditorPane(rawContent || '', columnsData);
        // If we were in preview mode, rebuild the preview with new content
        if (this._editorMode === 'preview') {
            this._previewPane?.remove();
            this._previewPane = null;
            // Saved positions are editor pixels; read them against the fresh editor while it is still visible
            const lines = this._cms.map( (cm, i) => this._cmLine(cm, columnsData[i]?.scrollTop || 0));
            this._pane.style.display = 'none';
            this._buildPreviewPane(lines);
        }
    }

    get editorMode() {
        return this._editorMode;
    }
    set editorMode(mode) {
        if (mode === this._editorMode)
            return;
        this._editorMode = mode;
        this._applyEditorMode();
    }

    /** Returns the full file content with <!column> delimiters between columns */
    getContent() {
        return this._cms.map(cm => cm.getValue()).join('\n<!column>\n');
    }

    /** Returns [{scrollTop, cursorPos}] for session persistence */
    getColumnsState() {
        return this._cms.map(cm => {
            const c = cm.getCursor();
            return {
                scrollTop: cm.getScrollInfo().top,
                cursorPos: {
                    line: c.line,
                    ch: c.ch
                }
            };
        }
        );
    }

    /** Returns the raw CM array — used by App._renderOutline() */
    getColumnCms() {
        return this._cms;
    }

    /** Returns the focused CM — used by App for context-menu actions */
    getActiveCm() {
        return this._cms[this._focusedColIdx] || this._cms[0] || null;
    }

    addColumn() {
        if (this._cms.length >= 4 || !this._pane)
            return;
        const cm = this.getActiveCm();
        if (!cm)
            return;

        // Insert <!column> at the start of the cursor's current line.
        // If that line already has content, push it down with a trailing newline so
        // the delimiter sits on its own line; if the line is empty, just fill it.
        const cursor = cm.getCursor();
        const lineText = cm.getLine(cursor.line) || '';

        cm.operation( () => {
            if (lineText.trim() === '') {
                cm.replaceRange('<!column>', {
                    line: cursor.line,
                    ch: 0
                }, {
                    line: cursor.line,
                    ch: lineText.length
                });
            } else {
                cm.replaceRange('<!column>\n', {
                    line: cursor.line,
                    ch: 0
                });
            }
            cm.setCursor({
                line: cursor.line,
                ch: 0
            });
        }
        );

        // Reuse split logic — it reads the cursor line and handles the rest
        this._splitColumnAtDelimiter(cm);
    }

    removeColumn() {
        if (this._cms.length <= 1 || !this._pane)
            return;

        const lastCm = this._cms[this._cms.length - 1];
        const prevCm = this._cms[this._cms.length - 2];

        // Merge: append last column's content to previous with a blank line
        const lastContent = lastCm.getValue().trimStart();
        const prevContent = prevCm.getValue().trimEnd();
        const merged = prevContent + (prevContent && lastContent ? '\n\n' : '') + lastContent;

        // Remove the last col-pane and its preceding divider from the DOM
        const lastPane = lastCm.getWrapperElement().closest('.col-pane');
        const prevSibling = lastPane?.previousElementSibling;
        lastCm.toTextArea();
        this._cms.pop();
        lastPane?.remove();
        if (prevSibling?.classList.contains('col-divider'))
            prevSibling.remove();

        // Push merged content into the now-last CM
        prevCm.setValue(merged);
        prevCm.clearHistory();   // a column merge can't be undone with Ctrl+Z

        this._focusedColIdx = Math.min(this._focusedColIdx, this._cms.length - 1);
        requestAnimationFrame( () => {
            prevCm.refresh();
            prevCm.focus();
        }
        );

        this._dispatch('column-count-change', {
            count: this._cms.length
        });
        this._dispatch('content-change');
    }

    getColumnCount() {
        return this._cms.length;
    }

    refresh() {
        this._cms.forEach(cm => cm.refresh());
    }

    focusActive() {
        (this._cms[this._focusedColIdx] || this._cms[0])?.focus();
    }

    /** Called by outline panel to route navigation to the correct CM */
    setActiveColumn(idx) {
        this._focusedColIdx = idx;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /** Destroy all CMs and clear the element's DOM */
    _clearEditor() {
        this._cms.forEach(cm => cm.toTextArea());
        this._cms = [];
        this._focusedColIdx = 0;
        this._previewPane = null;
        this._pane = null;
        this.innerHTML = '';
    }

    /** Split rawContent on <!column> and mount one CM per section */
    _buildEditorPane(rawContent, columnsData) {
        const pane = document.createElement('div');
        pane.className = 'editor-pane active';
        this.appendChild(pane);
        this._pane = pane;

        // Allow flexible whitespace around the delimiter
        const sections = rawContent.split(/\n?<!column>\n?/g);

        sections.forEach( (section, i) => {
            if (i > 0) {
                const div = document.createElement('div');
                div.className = 'col-divider';
                pane.appendChild(div);
            }
            const colPane = document.createElement('div');
            colPane.className = 'col-pane';
            pane.appendChild(colPane);

            const colData = columnsData[i] || {
                scrollTop: 0,
                cursorPos: {
                    line: 0,
                    ch: 0
                }
            };
            this._mountColumnEditor(colPane, section, i, colData);
        }
        );
    }

    /** Mount a single CodeMirror instance into colPane */
    _mountColumnEditor(colPane, content, colIndex, colData) {
        const ta = document.createElement('textarea');
        colPane.appendChild(ta);

        const cm = CodeMirror.fromTextArea(ta, {
            mode: 'markdown',
            lineWrapping: true,
            autofocus: colIndex === 0,
            styleActiveLine: true,
            extraKeys: {
                'Ctrl-S': () => this._dispatch('save-request'),
                // Ctrl+K — wrap selection as a markdown link
                'Ctrl-K': () => {
                    const sel = cm.getSelection();
                    if (!sel)
                        return;
                    cm.replaceSelection(`[${sel}]()`);
                    const cur = cm.getCursor();
                    cm.setCursor({
                        line: cur.line,
                        ch: cur.ch - 1
                    });
                },
                // Ctrl+B — wrap selection as bold
                'Ctrl-B': () => {
                    const sel = cm.getSelection();
                    if (sel) cm.replaceSelection(`**${sel}**`);
                },
                // Ctrl+B — wrap selection as bold
                'Ctrl-I': () => {
                    const sel = cm.getSelection();
                    if (sel) cm.replaceSelection(`*${sel}*`);
                },
                // Enter — detect if the current line is the <!column> delimiter
                'Enter': () => {
                    const lineText = cm.getLine(cm.getCursor().line) || '';
                    if (lineText.trim() === '<!column>') {
                        this._splitColumnAtDelimiter(cm);
                    } else {
                        return CodeMirror.Pass;
                        // normal Enter behaviour
                    }
                },
            },
        });

        cm.setValue(content);
        cm.setCursor(colData.cursorPos || {
            line: 0,
            ch: 0
        });
        cm.clearHistory();   // loading the note isn't a user edit, so Ctrl+Z must not be able to undo it
        cm.setSize('100%', '100%');

        if (this._editorMode === 'live')
            rebuildDecorations(cm);

        // Track focus so getActiveCm() is always accurate, even after column
        // splicing which would make a captured colIndex stale.
        cm.on('focus', () => {
            this._focusedColIdx = this._cms.indexOf(cm);
        }
        );

        const onCursorOrChange = () => {
            if (this._editorMode !== 'live')
                return;
            clearTimeout(this._decoTimer);
            this._decoTimer = setTimeout( () => rebuildDecorations(cm), 50);
        }
        ;

        cm.on('cursorActivity', () => {
            onCursorOrChange();
            this._wikiUpdate(cm, this._typed);
            this._typed = false;
            this._dispatch('cursor-change');
        }
        );

        cm.on('change', (_, change) => {
            onCursorOrChange();
            if (['+input', '+delete', '*compose'].includes(change.origin))
                this._typed = true;
            if (change.origin !== 'setValue') {
                this._dispatch('content-change');
            }
        }
        );

        // [[ menu keys. Registered as a CodeMirror event so that, while the menu is open, they run
        // before CodeMirror's own bindings (Enter, Tab) and can stop Esc reaching the app (Zen mode).
        cm.on('keydown', (_, e) => {
            const w = this._wiki;
            if (!w || w.cm !== cm || e.ctrlKey || e.metaKey || e.altKey || e.isComposing)
                return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                w.sel = (w.sel + (e.key === 'ArrowDown' ? 1 : w.items.length - 1)) % w.items.length;
                this._wikiRender();
            } else if (e.key === 'Enter' || e.key === 'Tab')
                this._wikiPick(w.sel);
            else if (e.key === 'Escape')
                this._wikiClose();
            else
                return;
            e.preventDefault();
            e.stopPropagation();
        });
        cm.on('blur', () => this._wikiClose());
        cm.on('scroll', () => this._wikiClose());

        this._cms.push(cm);

        requestAnimationFrame( () => {
            cm.scrollTo(null, colData.scrollTop || 0);
            cm.refresh();
        }
        );
    }

    // ── [[wikilink]] suggestions ───────────────────────────────────────────────
    // Typing after "[[" opens a small menu of matching page titles, supplied by the app through
    // .wikiSuggest. Up/Down move, Enter/Tab insert, Esc, a click elsewhere or moving away closes it.
    // The menu only opens from typing, never merely because the cursor lands after a "[[".

    _wikiUpdate(cm, typed) {
        const cur = cm.getCursor();
        const m = this.wikiSuggest && !cm.somethingSelected()
            && cm.getLine(cur.line).slice(0, cur.ch).match(/\[\[([^\[\]]+)$/);
        if (!m || !(typed || this._wiki))
            return this._wikiClose();
        const items = this.wikiSuggest(m[1]);
        if (!items.length)
            return this._wikiClose();
        this._wiki = { cm, from: { line: cur.line, ch: cur.ch - m[1].length }, items, sel: 0 };
        this._wikiRender();
    }

    _wikiRender() {
        const { cm, from, items, sel } = this._wiki;
        let el = this._wikiEl;
        if (!el) {
            el = this._wikiEl = document.createElement('div');
            el.id = 'wiki-menu';
            // mousedown, not click: the editor must keep focus
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                const row = e.target.closest('[data-i]');
                if (row)
                    this._wikiPick(+row.dataset.i);
            });
            document.body.appendChild(el);
        }
        el.replaceChildren(...items.map( (it, i) => {
            const row = document.createElement('div');
            row.className = 'wiki-item' + (i === sel ? ' sel' : '');
            row.dataset.i = i;
            const name = document.createElement('span');
            name.textContent = it.title;
            row.append(name);
            if (it.hint) {
                const hint = document.createElement('small');
                hint.textContent = it.hint;
                row.append(hint);
            }
            return row;
        }));
        el.style.display = 'block';
        const at = cm.cursorCoords(from, 'window');
        el.style.left = Math.max(8, Math.min(at.left, innerWidth - el.offsetWidth - 8)) + 'px';
        el.style.top = (at.bottom + el.offsetHeight + 8 > innerHeight ? at.top - el.offsetHeight - 4 : at.bottom + 4) + 'px';
    }

    _wikiPick(i) {
        const { cm, from, items } = this._wiki;
        const at = cm.getCursor();
        // An existing "]]" ends this link: replace what is left of the old target too, and keep it.
        const close = cm.getLine(from.line).slice(at.ch).match(/^[^\[\]]*\]\]/);
        this._wikiClose();
        cm.replaceRange(items[i].title + (close ? '' : ']]'), from, { line: from.line, ch: at.ch + (close ? close[0].length - 2 : 0) });
        cm.setCursor({ line: from.line, ch: from.ch + items[i].title.length + 2 });
        cm.focus();
    }

    _wikiClose() {
        this._wiki = null;
        if (this._wikiEl)
            this._wikiEl.style.display = 'none';
    }

    // ── Scroll position across Live Preview / Preview ────────────────────────────
    // The editor and the rendered preview have different heights, so pixel offsets don't transfer. Source
    // line numbers do: the renderer tags each top-level block with the line it starts on (data-line) and
    // CodeMirror knows where every line is. So a position is carried as a fractional source line, per
    // column, in both directions. The reference point is the top edge of the viewport at the top of the
    // note and slides to the bottom edge at the bottom, so the two ends always line up. The padding above
    // the first line (or block) counts as one extra line, -1 to 0, so a note that hasn't been scrolled
    // maps to a preview that hasn't been scrolled, to the pixel.

    /** Fractional source line at document pixel `y` of an editor column (-1 to 0 in the padding above line 0). */
    _lineAt(cm, y) {
        const first = cm.heightAtLine(0, 'local');
        if (y < first)
            return y / first - 1;
        const n = cm.lineAtHeight(y, 'local'), top = cm.heightAtLine(n, 'local'), next = cm.heightAtLine(n + 1, 'local');
        return n + (next > top ? Math.min(1, Math.max(0, (y - top) / (next - top))) : 0);
    }

    /** Document pixel of a fractional source line of an editor column. */
    _pixelOf(cm, line) {
        if (line < 0)
            return Math.max(0, 1 + line) * cm.heightAtLine(0, 'local');
        const n = Math.floor(line), top = cm.heightAtLine(n, 'local');
        return top + (line - n) * (cm.heightAtLine(n + 1, 'local') - top);
    }

    /** The line at an editor column's reference point. Must be visible; `top` overrides its scroll position.
     *  The note's height is where its last line ends, not the scroller's height, which includes padding below. */
    _cmLine(cm, top) {
        const info = cm.getScrollInfo(), max = info.height - info.clientHeight;
        return max > 0 ? this._lineAt(cm, (top ?? info.top) * this._pixelOf(cm, cm.lineCount()) / max) : -1;   // fits in view: the top
    }

    _scrollToLine(cm, line) {
        const info = cm.getScrollInfo(), max = info.height - info.clientHeight;
        if (max > 0)
            cm.scrollTo(null, this._pixelOf(cm, line) * max / this._pixelOf(cm, cm.lineCount()));
    }

    /** Two neighbouring [line, y] points of a preview column around `at` (on axis 0 = line, 1 = y): the last
     *  tagged block at or before it (or the padding above the first, [-1, 0]), and the next block (or the
     *  note's end). By bisection, so a long note doesn't mean measuring every block. */
    _around(col, nLines, axis, at) {
        const els = col.querySelectorAll('[data-line]');
        const origin = col.getBoundingClientRect().top - col.scrollTop;
        const mark = el => [+el.dataset.line, el.getBoundingClientRect().top - origin];
        let lo = 0, hi = els.length - 1, k = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (mark(els[mid])[axis] <= at) { k = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return [k >= 0 ? mark(els[k]) : [-1, 0], k + 1 < els.length ? mark(els[k + 1]) : [nLines, col.scrollHeight]];
    }

    /** The line at a preview column's reference point. Must be visible. */
    _previewLine(col, nLines) {
        const max = col.scrollHeight - col.clientHeight;
        if (max <= 0)
            return -1;
        const ref = col.scrollTop * col.scrollHeight / max;
        const [a, b] = this._around(col, nLines, 1, ref);
        return a[0] + Math.min(1, Math.max(0, (ref - a[1]) / (b[1] - a[1] || 1))) * (b[0] - a[0]);
    }

    /** The scrollTop that puts a fractional source line at a preview column's reference point. */
    _previewScroll(col, line, nLines) {
        const [a, b] = this._around(col, nLines, 0, line);
        const y = a[1] + Math.min(1, Math.max(0, (line - a[0]) / (b[0] - a[0] || 1))) * (b[1] - a[1]);
        return y * (col.scrollHeight - col.clientHeight) / (col.scrollHeight || 1);
    }

    /** Switch between live-edit and rendered-preview modes */
    _applyEditorMode() {
        if (this._editorMode === 'preview') {
            const lines = this._cms.map(cm => this._cmLine(cm));   // measure before hiding: a hidden pane has no height
            // Hide (don't destroy) the editor pane so switching back is instant
            if (this._pane)
                this._pane.style.display = 'none';
            this._buildPreviewPane(lines);
        } else {
            // Remove preview, restore editor
            const lines = this._previewPane   // likewise, before removing it
                ? [...this._previewPane.querySelectorAll('.preview-col-pane')].map( (col, i) => this._previewLine(col, this._cms[i].lineCount())) : [];
            this._previewPane?.remove();
            this._previewPane = null;
            if (this._pane)
                this._pane.style.display = '';
            requestAnimationFrame( () => {
                this._cms.forEach( (cm, i) => {
                    cm.refresh();
                    rebuildDecorations(cm);
                    if (lines[i] != null) {   // else keep the editor's own position
                        this._scrollToLine(cm, lines[i]);
                        // CodeMirror only measures the lines it displays; the first scroll has now shown some,
                        // so the target's pixel position is better known. Settle on it.
                        requestAnimationFrame( () => this._scrollToLine(cm, lines[i]));
                    }
                }
                );
                this.focusActive();
            }
            );
        }
    }

    /** Build a multi-column preview pane that mirrors the live layout */
    _buildPreviewPane(lines = []) {
        const preview = document.createElement('div');
        preview.className = 'preview-only-pane active';
        this.appendChild(preview);

        const footnotes = mdNewFootnotes();   // one footnote numbering sequence across all columns
        let lastContent = null;
        this._cms.forEach( (cm, i) => {
            if (i > 0) {
                const div = document.createElement('div');
                div.className = 'col-divider';
                preview.appendChild(div);
            }
            const col = document.createElement('div');
            col.className = 'preview-col-pane';
            // renderMarkdown is a global function defined in markdown.js
            col.innerHTML = `<div class="preview-content">${renderMarkdown(cm.getValue(), { footnotes, sourceLines: true })}</div>`;
            preview.appendChild(col);
            lastContent = col.firstElementChild;
        }
        );
        // All footnotes, in order, at the bottom of the last column
        lastContent?.insertAdjacentHTML('beforeend', mdFootnoteList(footnotes));

        // Bubble link clicks up as a custom event so App can handle navigation
        preview.addEventListener('click', e => {
            // Copy button on rendered code blocks
            const copyBtn = e.target.closest('.copy-btn');
            if (copyBtn) {
                const code = copyBtn.closest('.code-block')?.querySelector('pre code')?.textContent ?? '';
                navigator.clipboard.writeText(code).then(() => {
                    copyBtn.classList.add('copied');
                    setTimeout(() => copyBtn.classList.remove('copied'), 1200);
                });
                return;
            }
            // Footnote number / back-arrow: scroll within the preview instead of navigating
            const fnLink = e.target.closest('a.fn-link, a.fn-back');
            if (fnLink) {
                e.preventDefault();
                preview.querySelector('#' + CSS.escape(fnLink.dataset.fn))
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            const a = e.target.closest('a');
            if (!a)
                return;
            e.preventDefault();
            this._dispatch('link-click', {
                href: a.classList.contains('wikilink') ? a.dataset.target : a.href,
                isWiki: a.classList.contains('wikilink')
            });
        }
        );

        this._previewPane = preview;

        // Start where the editor was, not at the top
        requestAnimationFrame( () => preview.querySelectorAll('.preview-col-pane').forEach( (col, i) => {
            col.scrollTop = lines[i] != null ? this._previewScroll(col, lines[i], this._cms[i].lineCount()) : 0;
        }
        ));
    }

    /** When the user types <!column> and presses Enter, split at that line */
    _splitColumnAtDelimiter(cm) {
        if (this._cms.length >= 4) {
            // Already at the column limit — erase the delimiter and toast
            const lineNo = cm.getCursor().line;
            const lineCount = cm.lineCount();
            cm.operation( () => {
                const from = {
                    line: lineNo,
                    ch: 0
                };
                const to = lineNo < lineCount - 1 ? {
                    line: lineNo + 1,
                    ch: 0
                } : {
                    line: lineNo,
                    ch: cm.getLine(lineNo).length
                };
                cm.replaceRange('', from, to);
            }
            );
            this._dispatch('max-columns-reached');
            return;
        }

        const cursorLine = cm.getCursor().line;
        const lineCount = cm.lineCount();

        // Collect content above and below the delimiter line
        const above = Array.from({
            length: cursorLine
        }, (_, i) => cm.getLine(i)).join('\n');
        const below = Array.from({
            length: lineCount - cursorLine - 1
        }, (_, i) => cm.getLine(cursorLine + 1 + i)).join('\n');

        cm.setValue(above);
        cm.clearHistory();       // a column split can't be undone with Ctrl+Z
        // update current CM in place

        // Insert divider + new col-pane immediately after the current col-pane
        const curColPane = cm.getWrapperElement().closest('.col-pane');
        const editorPane = curColPane?.parentElement;
        if (!curColPane || !editorPane)
            return;

        const divider = document.createElement('div');
        divider.className = 'col-divider';
        curColPane.insertAdjacentElement('afterend', divider);

        const newColPane = document.createElement('div');
        newColPane.className = 'col-pane';
        divider.insertAdjacentElement('afterend', newColPane);

        const insertAt = this._cms.indexOf(cm) + 1;
        // _mountColumnEditor pushes to the end of _cms
        this._mountColumnEditor(newColPane, below, insertAt, {
            scrollTop: 0,
            cursorPos: {
                line: 0,
                ch: 0
            }
        });

        // Splice the newly pushed CM into the correct position in the array
        if (this._cms.length > insertAt + 1) {
            const newCm = this._cms.pop();
            this._cms.splice(insertAt, 0, newCm);
        }

        requestAnimationFrame( () => {
            this._cms[insertAt]?.focus();
            this._focusedColIdx = insertAt;
        }
        );

        this._dispatch('column-count-change', {
            count: this._cms.length
        });
        this._dispatch('content-change');
    }

    /** Helper: fire a CustomEvent that bubbles through the composed DOM tree */
    _dispatch(name, detail={}) {
        emit(this, name, detail);
    }
}
customElements.define('cento-editor', CentoEditor);

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// app.js defines App but does NOT call App.init() — we do it here, after all
// custom elements are registered, so element queries in init() always resolve.
// ─────────────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
