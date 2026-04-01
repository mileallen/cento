# Cento

Cento is a minimal, offline-first markdown notes app that runs in the browser as a PWA. It covers the basic everyday features of Obsidian in a far lighter package — no Electron, no plugins, no account — while adding one capability Obsidian lacks: the ability to open isolated markdown files from anywhere on your local filesystem into a dedicated **Drawer** section, independently of whatever vault you have open. Once installed as a PWA (recommended via Microsoft Edge or Google Chrome), Cento registers itself as a handler for `.md` files in Windows Explorer, so double-clicking any markdown file opens it directly in the Drawer without disturbing your vault session.


---

## Features

### Vault
Open any local folder as a vault. Cento scans it recursively and displays your notes as a collapsible file tree in the sidebar. Your session — open tabs, scroll positions, cursor positions, expanded folders, sidebar view — is saved automatically and restored on next launch.

### Editor
- **Live preview mode** — markdown syntax is rendered inline and syntax markers appear only when relevant, keeping long notes clean and readable
- **Preview mode** — full rendered HTML view with styled headings, code blocks, blockquotes, and more
- **Autosave** — notes are saved automatically as you type
- Syntax support: bold, italic, bold+italic, inline code, code blocks, highlight, superscript, subscript, blockquotes, horizontal rules, headings H1–H6, unordered and ordered lists

### Links
- `[[Note Title]]` wikilinks navigate between notes in the vault. That means you could bring over your Obsidian vault and start working in it out of the box!
- **Cento links** — generate a `web+cento://` deep link to any note via the right-click context menu and paste it into any other app. Clicking the link focuses Cento and opens the note directly.
- Outgoing protocol links: as a bonus (bit of a personal preference)[^1], Zotero links are styled in Zotero's brand color. You can modify that line of code to handle some other app links.

> [!CAUTION]
> Cento has not been extensively tested for bugs. Before switching an Obsidian vault to it cold turkey, try it for a few days with a backup first.

### Drawer
A separate section at the bottom of the sidebar that holds individually opened `.md` files from outside the vault. Each entry can be removed with an inline × button. The Drawer is ephemeral — it is not persisted across sessions.

### Search
Full-text search across all notes in the vault, with inline context previews and match highlighting.

### Context Menu
Right-click in the editor for quick formatting actions (bold, italic, highlight, superscript, subscript, blockquote, code block, copy, cut, paste) and to copy a Cento deep link to the current note.

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl + S` | Save |
| `Ctrl + K` | Wrap selection as hyperlink `[text]()` |

### PWA / Offline
Cento is a fully offline Progressive Web App. All assets — fonts, scripts, styles — are cached by the service worker on first load. It launches and runs without a network connection or a local server.

---

## Installation

Either visit [Cento](https://mileallen.github.io/cento) online or serve the files from any static HTTP server or localhost. Open in Chrome or Edge and install via the browser's **Install app** prompt in the address bar (or right click the tab). After installation, Cento will appear in the Start Menu and taskbar.

---

## Stack

Vanilla JavaScript, [CodeMirror 5](https://codemirror.net/5/), no framework, no build step.


[^1]: When visiting older notes, I like to get a sense at a glance of how many instances there are where I link to the web, versus a Zotero citation or another note.
