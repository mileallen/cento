# Cento

Cento is a minimal, offline-first markdown notes app that runs in the browser as a PWA. It combines the best of two tools that approach notes from opposite directions.

---

<img src="/images/screenshot-2026-06-30.png" width="100%">

---

## The best of Obsidian and OneNote

**Obsidian** got the file format right. Your notes live as plain `.md` files in ordinary folders on your drive — no proprietary database, no lock-in. They are entirely portably and work in any text or markdown editor. Wikilinks let you build a web of connected thoughts. But its interface isn't ideal: a flat file tree scales poorly.

**OneNote** has much better organisation. The Notebooks → Sections → Pages hierarchy maps naturally to how people think in mental classification trees. Also, a spatially structured layout complements memory. Think 'Mind Palaces'.

**Cento** combines those features. Your notes are plain `.md` files in nested folders — fully portable, fully open. Conversely, you can bring over an existing Obsidian vault and it works out of the box. But the interface is organised like OneNote: open multiple notebooks side by side, navigate between sections as tabs, browse pages in a dedicated sidebar. You get the freedom of plain text and the clarity of a structured interface. It's your digital 2-D mind palace on a screen.

---

## Organisation

Cento maps a standard folder structure onto the OneNote model:

```
Notebook folder/         ← a folder you open as a notebook
  Research/              ← a section (top-level subfolder)
    Overview.md          ← a page
    Projects.md          ← a parent page
    Projects/            ← sub-pages of Projects.md
      Alpha.md
      Beta.md
  Daily Notes/           ← another section
    2026-06-01.md
  Loose note.md          ← appears in a virtual "Unfiled" section
```

- **Notebooks** — any folder on your drive. Multiple notebooks can be open simultaneously; they appear in the left sidebar and are seamlessly restored on next launch (no re-picking required).
- **Sections** — top-level subfolders, shown as horizontal tabs across the top of the editor. Click the `+` button at the right edge of the tab strip to add a new section.
- **Pages** — `.md` files inside sections, listed in the right-hand panel. Pages can have sub-pages: a file named `Topic.md` paired with a folder named `Topic/` creates a parent page with children inside.
- **Unfiled** — a virtual section that collects any `.md` files sitting directly in the notebook's root folder.

---

## Features

### Editor

- **Live preview mode** — markdown syntax renders inline; markers appear only near the cursor, keeping the text clean and readable at all times
- **Preview mode** — full rendered HTML view
- **Autosave** — notes save automatically as you type
- **Columns** — split a single note into up to four side-by-side columns (see below)
- **Outline panel** — a toggleable right sidebar showing the heading structure of the current page, with click-to-jump navigation
- Syntax: bold, italic, bold+italic, inline code, code blocks, highlight (`==text==`), superscript (`^text^`), subscript (`~text~`), blockquotes, horizontal rules, headings H1–H6, unordered and ordered lists

### Columns

One other thing Obsidian does not offer natively: comparing or composing content side by side within a single document. Again, in service of spatial organization, Cento lets you split any note into up to four columns. The columns are recorded in the `.md` file itself using a simple HTML comment delimiter (`<!column>`) that other markdown renderers silently ignore — so the file degrades gracefully outside Cento.

To add a column: click the `+` column button in the toolbar (splits at the cursor position), or type `<!column>` anywhere in the note and press Enter. To remove the last column: click the `−` column button (content is merged back into the previous column).

### Navigation

- **Back / Forward** buttons in the toolbar for in-session navigation history
- `[[Wikilinks]]` navigate between pages in the active notebook
- **Cento links** — right-click in the editor to copy a `web+cento://` deep link to the current page. Clicking the link from any other app focuses Cento and opens that page directly.
- Outgoing Markdown links open in a new browser tab
- Zotero citation links are styled in Zotero's brand colour[^*]

### Search

Full-text search across all pages in the active notebook, with inline context snippets and match highlighting.

### Drawer

A panel at the bottom of the left sidebar for individually opened `.md` files from outside any notebook — useful for reference files, quick drafts, or anything you want open without it being part of a notebook. Entries can be dismissed with an inline × button. The Drawer is ephemeral and is not persisted between sessions.

When Cento is installed as a PWA, it registers as a handler for `.md` files on Windows, so double-clicking any markdown file in Explorer opens it directly in the Drawer without disturbing your active notebook.

### Session

Each notebook stores its own session file (`.cento-notebook.json`) in its root folder, tracking the last-active section, last-active page per section, scroll and cursor positions, sidebar widths, and outline visibility. Everything is restored exactly where you left off on next launch.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + S` | Save |
| `Ctrl + K` | Wrap selection as hyperlink `[text]()` |

---

## Installation

### Simple (bookmark)

Visit [Cento](https://mileallen.github.io/cento) or serve the files from any static HTTP server. Open in Chrome or Edge and bookmark the page. The app runs entirely in the browser — no server, no account, no dependencies.

### Recommended (PWA — native app features)

Open Cento in Chrome or Edge and click **Install app** in the address bar (or right-click the tab). Once installed, Cento appears in the Start Menu and taskbar, launches without a browser window, and registers as the default handler for `.md` files so that double-clicking any markdown file in Explorer opens it in the Drawer.

Cento is fully offline-capable. All assets — fonts, scripts, styles — are cached by the service worker on first load. It launches and runs without a network connection.

---

## Stack

Vanilla JavaScript, [CodeMirror 5](https://codemirror.net/5/), Web Components (custom elements with Shadow DOM), IndexedDB for notebook persistence, File System Access API, no framework, no build step.

---

## Caution

> [!CAUTION]
> Cento has not been extensively tested. Before switching a large Obsidian vault to it cold turkey, try it for a few days with a backup first.

---

## Credits

Cento was built with generous help from Claude Sonnet 4.6, a little advice from Gemini 3.x and some houskeeping tasks by GLM 5.2. Each was recruited to fix parts of the code where the other went off track or did not cooperate. Sach's contribution was primarily combining their work, testing and reporting bugs, researching alternatives to the LLM's first instinct, and fact-checking (e.g. whether a library is outdated or how widely an API is supported).

[^*]: When reviewing older notes, I like to see at a glance how many references are web links versus Zotero citations versus internal links. You can modify that line of code to style links for any other app.
