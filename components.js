// ─────────────────────────────────────────────────────────────────────────────
// components.js — Cento Web Components
//
// Load order: codemirror → markdown → typo → app.js → components.js
// app.js defines the global App object and helpers (rebuildDecorations, mdToHtml).
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
        return ['name', 'active'];
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
            this.dispatchEvent(new CustomEvent('notebook-activate',{
                bubbles: true,
                composed: true,
                detail: {
                    id: Number(this.getAttribute('notebook-id'))
                }
            }));
        }
        );

        this.shadowRoot.querySelector('.close').addEventListener('click', e => {
            e.stopPropagation();
            this.dispatchEvent(new CustomEvent('notebook-close',{
                bubbles: true,
                composed: true,
                detail: {
                    id: Number(this.getAttribute('notebook-id'))
                }
            }));
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
// Fires       : section-change { detail: { section: name } }
// ─────────────────────────────────────────────────────────────────────────────
class SectionTabs extends HTMLElement {
    static get observedAttributes() {
        return ['sections', 'active-section'];
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
        </style>
        <div class="bar" part="bar"></div>`;
    }

    connectedCallback() {
        this._render();
    }
    attributeChangedCallback() {
        this._render();
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
            tab.textContent = sec.name;
            tab.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('section-change',{
                    bubbles: true,
                    composed: true,
                    detail: {
                        section: sec.name
                    }
                }));
            }
            );
            bar.appendChild(tab);
        }
        );

        // Add-section button always sits after the last tab
        const addBtn = document.createElement('button');
        addBtn.className = 'add-section-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Add Section';
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

        const input = document.createElement('input');
        input.className = 'new-tab-input';
        input.value = 'Untitled';
        input.spellcheck = false;
        tempTab.appendChild(input);

        // Slot it in before the + button
        const addBtn = bar.querySelector('.add-section-btn');
        bar.insertBefore(tempTab, addBtn);

        let committed = false;
        const commit = () => {
            if (committed)
                return;
            committed = true;
            const name = input.value.trim() || 'Untitled';
            tempTab.remove();
            this.dispatchEvent(new CustomEvent('section-add',{
                bubbles: true,
                composed: true,
                detail: {
                    name
                }
            }));
        }
        ;
        const cancel = () => {
            committed = true;
            tempTab.remove();
        }
        ;

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        }
        );
        input.addEventListener('blur', commit);

        setTimeout( () => {
            input.select();
            input.focus();
        }
        , 30);
    }
}
customElements.define('section-tabs', SectionTabs);

// ─────────────────────────────────────────────────────────────────────────────
// <page-list>
//
// Scrollable container for the page list panel. Acts as a styled host for
// <page-list-item> children placed by the App in its light DOM slot.
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
// A single page (or sub-page group) row in the page list panel.
// Child <page-list-item> elements are placed as light DOM children by the App
// and appear via the <slot> — so nesting happens naturally in the DOM tree.
//
// Attributes:
//   title         — display name
//   page-path     — relative path within notebook (absent for groups)
//   depth         — 0, 1, 2 … controls left-padding
//   has-children  — presence attr; shows the ▶ triangle
//   expanded      — presence attr; rotates triangle, reveals <slot>
//   active        — presence attr; highlights this row
//   is-group      — presence attr; unclickable group header style
//   renaming      — presence attr; switches label to inline input
//
// Fires (bubbles=true, composed=true so they cross shadow boundaries):
//   page-select      { detail: { path } }
//   item-toggle      { detail: { path, expanded } }
//   page-contextmenu { detail: { path, title } }
//   page-rename      { detail: { path, newTitle } }
// ─────────────────────────────────────────────────────────────────────────────
class PageListItem extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'depth', 'has-children', 'expanded', 'active', 'is-group', 'renaming'];
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
            :host([is-group]) .item { cursor: default; }
            :host([is-group]) .item:hover { background: transparent; }
            :host([active]) .item { background: var(--accent-glow); color: var(--accent); }
            .toggle {
                width: 14px; height: 14px;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
                color: var(--text-dim);
                font-size: 9px;
                transition: transform var(--transition);
            }
            :host([expanded]) .toggle { transform: rotate(90deg); }
            .label {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1;
            }
            :host([is-group]) .label {
                font-size: 10.5px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.7px;
                color: var(--text-dim);
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
            /* Children slot is hidden when not expanded */
            .children { display: none; }
            :host([expanded]) .children { display: block; }
        </style>
        <div class="item">
            <span class="toggle"></span>
            <span class="label"></span>
        </div>
        <div class="children"><slot></slot></div>`;

        const item = this.shadowRoot.querySelector('.item');

        item.addEventListener('click', () => {
            // Toggle expansion on items that have children
            if (this.hasAttribute('has-children') || this.hasAttribute('is-group')) {
                const willExpand = !this.hasAttribute('expanded');
                willExpand ? this.setAttribute('expanded', '') : this.removeAttribute('expanded');
                this.dispatchEvent(new CustomEvent('item-toggle',{
                    bubbles: true,
                    composed: true,
                    detail: {
                        path: this.getAttribute('page-path'),
                        expanded: willExpand
                    }
                }));
            }
            // Navigate only for real pages (not group headers)
            if (!this.hasAttribute('is-group') && this.getAttribute('page-path')) {
                this.dispatchEvent(new CustomEvent('page-select',{
                    bubbles: true,
                    composed: true,
                    detail: {
                        path: this.getAttribute('page-path')
                    }
                }));
            }
        }
        );

        item.addEventListener('contextmenu', e => {
            e.preventDefault();
            const path = this.getAttribute('page-path');
            if (!path) return;
            this.dispatchEvent(new CustomEvent('page-contextmenu', {
                bubbles: true, composed: true,
                detail: { path, title: this.getAttribute('title') || '', x: e.clientX, y: e.clientY }
            }));
        });
    }

    connectedCallback() {
        this._sync();
    }

    attributeChangedCallback(name, _old, val) {
        if (name === 'title') {
            const el = this.shadowRoot.querySelector('.label');
            if (el)
                el.textContent = val || '';
        }
        if (name === 'depth') {
            this._updateDepth(parseInt(val) || 0);
        }
        if (name === 'has-children') {
            const t = this.shadowRoot.querySelector('.toggle');
            if (t)
                t.textContent = val !== null ? '▶' : '';
        }
        if (name === 'renaming') {
            if (val !== null)
                this._showRenameInput();
        }
    }

    _sync() {
        const depth = parseInt(this.getAttribute('depth')) || 0;
        this._updateDepth(depth);
        const toggle = this.shadowRoot.querySelector('.toggle');
        if (toggle)
            toggle.textContent = this.hasAttribute('has-children') ? '▶' : '';
        const label = this.shadowRoot.querySelector('.label');
        if (label)
            label.textContent = this.getAttribute('title') || '';
    }

    _updateDepth(depth) {
        const item = this.shadowRoot.querySelector('.item');
        // Indent: base 8px + 16px per nesting level
        if (item)
            item.style.paddingLeft = (8 + depth * 16) + 'px';
    }

    _showRenameInput() {
        const label = this.shadowRoot.querySelector('.label');
        if (!label)
            return;
        label.style.display = 'none';

        const input = document.createElement('input');
        input.className = 'rename-input';
        input.value = this.getAttribute('title') || '';
        this.shadowRoot.querySelector('.item').appendChild(input);

        let committed = false;
        const commit = () => {
            if (committed)
                return;
            committed = true;
            const newTitle = input.value.trim();
            input.remove();
            label.style.display = '';
            this.removeAttribute('renaming');
            if (newTitle && newTitle !== this.getAttribute('title')) {
                this.dispatchEvent(new CustomEvent('page-rename',{
                    bubbles: true,
                    composed: true,
                    detail: {
                        path: this.getAttribute('page-path'),
                        newTitle
                    }
                }));
            }
        }
        ;

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
            }
            if (e.key === 'Escape') {
                committed = true;
                input.remove();
                label.style.display = '';
                this.removeAttribute('renaming');
            }
        }
        );
        input.addEventListener('blur', commit);
        setTimeout( () => {
            input.select();
            input.focus();
        }
        , 30);
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
//   save-request     — user pressed Ctrl/Cmd+S, App saves immediately
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
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Load new content. Destroys existing CMs and rebuilds. */
    load(rawContent, columnsData=[]) {
        this._clearEditor();
        this._buildEditorPane(rawContent || '', columnsData);
        // If we were in preview mode, rebuild the preview with new content
        if (this._editorMode === 'preview') {
            this._previewPane?.remove();
            this._previewPane = null;
            this._pane.style.display = 'none';
            this._buildPreviewPane();
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
                'Cmd-S': () => this._dispatch('save-request'),
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
                }
                ,
                // Enter — detect if the current line is the <!column> delimiter
                'Enter': () => {
                    const lineText = cm.getLine(cm.getCursor().line) || '';
                    if (lineText.trim() === '<!column>') {
                        this._splitColumnAtDelimiter(cm);
                    } else {
                        return CodeMirror.Pass;
                        // normal Enter behaviour
                    }
                }
                ,
            },
        });

        cm.setValue(content);
        cm.setCursor(colData.cursorPos || {
            line: 0,
            ch: 0
        });
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
            this._dispatch('cursor-change');
        }
        );

        cm.on('change', (_, change) => {
            onCursorOrChange();
            if (change.origin !== 'setValue') {
                this._dispatch('content-change');
            }
        }
        );

        this._cms.push(cm);

        requestAnimationFrame( () => {
            cm.scrollTo(null, colData.scrollTop || 0);
            cm.refresh();
        }
        );
    }

    /** Switch between live-edit and rendered-preview modes */
    _applyEditorMode() {
        if (this._editorMode === 'preview') {
            // Hide (don't destroy) the editor pane so switching back is instant
            if (this._pane)
                this._pane.style.display = 'none';
            this._buildPreviewPane();
        } else {
            // Remove preview, restore editor
            this._previewPane?.remove();
            this._previewPane = null;
            if (this._pane)
                this._pane.style.display = '';
            requestAnimationFrame( () => {
                this._cms.forEach(cm => {
                    cm.refresh();
                    rebuildDecorations(cm);
                }
                );
                this.focusActive();
            }
            );
        }
    }

    /** Build a multi-column preview pane that mirrors the live layout */
    _buildPreviewPane() {
        const preview = document.createElement('div');
        preview.className = 'preview-only-pane active';
        this.appendChild(preview);

        this._cms.forEach( (cm, i) => {
            if (i > 0) {
                const div = document.createElement('div');
                div.className = 'col-divider';
                preview.appendChild(div);
            }
            const col = document.createElement('div');
            col.className = 'preview-col-pane';
            // mdToHtml is a global function defined in app.js
            col.innerHTML = `<div class="preview-content">${mdToHtml(cm.getValue())}</div>`;
            preview.appendChild(col);
        }
        );

        // Bubble link clicks up as a custom event so App can handle navigation
        preview.addEventListener('click', e => {
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
        this.dispatchEvent(new CustomEvent(name,{
            bubbles: true,
            composed: true,
            detail
        }));
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
