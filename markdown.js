"use strict";
/*
 * Small, dependency-free Markdown renderer.
 * All text is HTML-escaped before any markup is added, so nothing in a note
 * can inject HTML or scripts into the page.
 *
 * Supports: fenced code blocks, inline code, headings, bold/italic/strikethrough,
 * links, ordered/unordered/nested lists, blockquotes, tables, horizontal rules,
 * maths written between $$ ... $$ or $ ... $ (rendered with the bundled KaTeX)
 * and JavaScript/Python code highlighting (bundled highlight.js). Both work offline.
 *
 * ── Changes made for Cento (search for "CENTO" to find every one) ─────────────
 *  1. Cento rules in mdInline(): [[wikilinks]], ==highlight==, ^sup^, ~sub~,
 *     plus zotero:// and relative-path links (in addition to http/https).
 *  2. Links: the whole <a> opening tag is lifted out before bold/italic run, so
 *     underscores or asterisks in a URL (or in target="_blank") can't be turned
 *     into <em>/<strong> and corrupt the HTML.
 *  3. Blank lines: every blank source line becomes one <div class="md-blank">,
 *     which CSS makes exactly one text line tall. This keeps Preview Mode
 *     vertically aligned with Live Preview.
 *  4. Lists no longer swallow blank lines between items (so those blank lines
 *     are drawn, as in the editor). Numbering still continues via start="n".
 *  5. Inline footnotes ^[text]: each becomes a numbered, linked superscript, and
 *     the notes are listed in order under a rule at the end. Numbering is held in
 *     a "footnote state" so several renderMarkdown() calls (Cento's columns) can
 *     share one sequence: create it with mdNewFootnotes(), pass it as
 *     options.footnotes, then append mdFootnoteList(state) after the last call.
 *     Without options.footnotes, renderMarkdown() appends the list itself.
 */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Extra commands LLMs often use in economics/econometrics that KaTeX doesn't define.
const MD_MACROS = {
    "\\argmax": "\\operatorname*{arg\\,max}",
    "\\argmin": "\\operatorname*{arg\\,min}",
    "\\plim": "\\operatorname*{plim}",
};

const MD_MATH_CACHE = new Map();

/** TeX -> HTML. Cached, because re-rendering the same formulas is common. */
function mdMath(tex, display) {
    const key = (display ? "D" : "I") + tex;
    let html = MD_MATH_CACHE.get(key);
    if (html !== undefined) return html;
    const source = escapeHtml("$$" + tex + "$$");
    if (typeof katex === "undefined" || !tex.trim()) {
        html = '<code class="math-fallback">' + source + "</code>";
    } else {
        try {
            html = katex.renderToString(tex, {
                displayMode: display,
                throwOnError: false,   // bad TeX shows up in red instead of breaking the page
                output: "html",
                strict: "ignore",
                trust: false,          // no \href, \url, \includegraphics ...
                macros: Object.assign({}, MD_MACROS), // KaTeX may modify this object
            });
        } catch (_) {
            html = '<code class="math-fallback">' + source + "</code>";
        }
    }
    if (MD_MATH_CACHE.size >= 500) MD_MATH_CACHE.delete(MD_MATH_CACHE.keys().next().value);
    MD_MATH_CACHE.set(key, html);
    return html;
}

/**
 * Single-dollar inline maths, e.g. $u$ or $\beta$.
 *
 * Money has a $ on one side only, so the usual rule (Pandoc / GitHub) tells them apart:
 *   - the opening $ must be followed by a non-space character,
 *   - the closing $ must be preceded by a non-space character,
 *   - the closing $ must not be followed by a digit,
 *   - the first unescaped $ after the opening one decides: if it can't close, this is not maths.
 * "costs $5 and $10" and "$5-$10" therefore stay as text. A backslash-escaped \$ is shown as a plain $.
 */
function mdFindMathClose(s, from) {
    for (let j = from; j < s.length; j++) {
        const c = s[j];
        if (c === "\\") { j++; continue; }
        if (c === "\n") return -1;                      // inline maths stays on one line
        if (c === "$") {
            const prev = s[j - 1];
            const next = s[j + 1];
            if (/\s/.test(prev) || (next !== undefined && /\d/.test(next))) return -1;
            return j;
        }
    }
    return -1;
}

function mdSingleDollarMath(s, maths) {
    let out = "";
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === "\\" && i + 1 < s.length) {
            out += s[i + 1] === "$" ? "$" : ch + s[i + 1];
            i += 2;
            continue;
        }
        if (ch === "$" && i + 1 < s.length && !/[\s$]/.test(s[i + 1])) {
            const end = mdFindMathClose(s, i + 1);
            if (end > 0) {
                maths.push(mdMath(s.slice(i + 1, end), false));
                out += "\u0001" + (maths.length - 1) + "\u0001";
                i = end + 1;
                continue;
            }
        }
        out += ch;
        i++;
    }
    return out;
}

function mdInline(s, fn) {
    const codes = [];
    const maths = [];   // pre-rendered HTML chunks: maths, and (CENTO) wikilinks
    const tags  = [];   // (CENTO) lifted <a ...> opening tags, kept away from bold/italic
    // 1. inline code, kept raw so it is never touched by anything below
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
        codes.push(c);
        return "\u0000" + (codes.length - 1) + "\u0000";
    });
    // 2. $$ ... $$ maths. The TeX must NOT be HTML-escaped or seen by the
    //    bold/italic rules (x_i * y_j would be mangled), so it is lifted out first.
    //    Alone on its own line(s) it is shown as a display equation, otherwise inline.
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (match, tex, offset, whole) => {
        const before = whole.slice(0, offset);
        const after = whole.slice(offset + match.length);
        const alone = /(^|\n)[ \t]*$/.test(before) && /^[ \t]*(\n|$)/.test(after);
        maths.push(mdMath(tex, alone));
        return "\u0001" + (maths.length - 1) + "\u0001";
    });
    // 3. single-dollar inline maths (after $$ so that pairs of $$ are never split)
    s = mdSingleDollarMath(s, maths);

    // ── CENTO RULES (1/3): [[wikilinks]] ─────────────────────────────────────
    // Lifted out whole, so the title can't be altered by bold/italic rules.
    // Same markup the old renderer produced; the click handler reads data-target.
    s = s.replace(/\[\[([^\]\n]+)\]\]/g, (_, title) => {
        const t = escapeHtml(title);
        maths.push('<a href="#" class="wikilink" data-target="' + t + '">' + t + "</a>");
        return "\u0001" + (maths.length - 1) + "\u0001";
    });

    // ── CENTO RULES (footnotes) ──────────────────────────────────────────────
    // finish() turns raw text into final HTML (escape, links, emphasis, restore
    // placeholders). A footnote body is finished right here, while the code /
    // maths / wikilink placeholders it may contain are still in scope; the main
    // text then carries just a numbered marker, swapped for the superscript last.
    const finish = (s) => {
        s = escapeHtml(s);

        // ── CENTO RULES (2/3): links ─────────────────────────────────────────────
        // Allowed: http(s)://, zotero://, and relative paths (no scheme at all).
        // Anything else (javascript:, data:, file: ...) is left as plain text.
        // The opening tag is lifted out so URL characters can't trigger emphasis rules.
        s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (whole, text, url) => {
            url = url.trim();
            const ok = url !== "" && (
                /^https?:\/\/\S+$/i.test(url) ||
                /^zotero:\/\/\S+$/i.test(url) ||
                !/^[a-z][a-z0-9+.-]*:/i.test(url)
            );
            if (!ok) return whole;
            tags.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">');
            return "\u0002" + (tags.length - 1) + "\u0002" + text + "</a>";
        });

        s = s.replace(/\*\*([^\n*][^\n]*?)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/__([^\n_][^\n]*?)__/g, "<strong>$1</strong>");
        s = s.replace(/(^|[^*\w])\*([^\s*][^\n*]*?)\*(?!\*)/g, "$1<em>$2</em>");
        s = s.replace(/(^|[^_\w])_([^\s_][^\n_]*?)_(?![_\w])/g, "$1<em>$2</em>");
        s = s.replace(/~~([^\n~]+)~~/g, "<del>$1</del>");

        // ── CENTO RULES (3/3): ==highlight==, ^superscript^, ~subscript~ ─────────
        // Deliberately the same patterns the Live Preview editor decorates, so the
        // two modes always agree on what counts as highlight / sup / sub.
        // (Runs after ~~strike~~ so a double tilde is never read as two subscripts.)
        s = s.replace(/==(.+?)==/g, "<mark>$1</mark>");
        s = s.replace(/\^(.+?)\^/g, "<sup>$1</sup>");
        s = s.replace(/~(.+?)~/g, "<sub>$1</sub>");

        s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => maths[Number(n)]);
        s = s.replace(/\u0002(\d+)\u0002/g, (_, n) => tags[Number(n)]);
        s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => "<code>" + escapeHtml(codes[Number(n)]) + "</code>");
        return s;
    };

    if (fn) {
        s = mdExtractFootnotes(s, (body) => {
            const n = fn.notes.length + 1;
            fn.notes.push(finish(body));
            return "\u0003" + n + "\u0003";
        });
    }
    s = finish(s);
    return s.replace(/\u0003(\d+)\u0003/g, (_, n) => mdFootnoteRef(n));
}

/** Inline footnotes. Footnote numbers/notes live in a state object so that several
 *  renderMarkdown() calls (e.g. Cento's columns) can share one numbering sequence. */
function mdNewFootnotes() {
    return { notes: [] };
}

function mdFootnoteRef(n) {
    return '<sup class="fn-ref" id="fnref-' + n + '"><a class="fn-link" href="#fn-' + n +
        '" data-fn="fn-' + n + '">' + n + "</a></sup>";
}

/** The numbered list of notes, under a rule, each with an arrow back to its reference. */
function mdFootnoteList(fn) {
    if (!fn || !fn.notes.length) return "";
    return '<section class="footnotes"><hr class="fn-rule"><ol class="fn-list">' +
        fn.notes.map((html, k) => {
            const n = k + 1;
            return '<li id="fn-' + n + '">' + html +
                ' <a class="fn-back" href="#fnref-' + n + '" data-fn="fnref-' + n +
                '" title="Back to text" aria-label="Back to text">\u2191</a></li>';
        }).join("") + "</ol></section>";
}

/**
 * Finds ^[ ... ] on one line, matching nested [ ] (so [links](url) inside work),
 * and calls onNote(body) for each. Returns the text with each footnote replaced by
 * whatever onNote returned. Empty or unclosed ^[ ... is left as ordinary text.
 */
function mdExtractFootnotes(s, onNote) {
    let out = "";
    let i = 0;
    while (i < s.length) {
        if (s[i] === "^" && s[i + 1] === "[") {
            let depth = 0;
            let end = -1;
            for (let j = i + 1; j < s.length; j++) {
                const c = s[j];
                if (c === "\n") break;
                if (c === "\\") { j++; continue; }
                if (c === "[") depth++;
                else if (c === "]" && --depth === 0) { end = j; break; }
            }
            if (end > i + 2 && s.slice(i + 2, end).trim() !== "") {
                out += onNote(s.slice(i + 2, end));
                i = end + 1;
                continue;
            }
        }
        out += s[i];
        i++;
    }
    return out;
}


/**
 * Syntax highlighting (bundled highlight.js, JavaScript and Python only). Only blocks
 * labelled with a known language are coloured; anything else is shown as plain text.
 * highlight.js escapes the code itself, so the result is safe HTML.
 */
function mdHighlight(code, lang) {
    const name = String(lang || "").toLowerCase();
    if (name && typeof hljs !== "undefined" && hljs.getLanguage(name)) {
        try {
            return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
        } catch (_) { /* fall through to plain text */ }
    }
    return escapeHtml(code);
}

function mdCodeBlock(code, lang) {
    return (
        '<div class="code-block"><div class="code-head"><span>' +
        escapeHtml(lang || "") +
        '</span><button class="copy-btn" type="button" title="Copy code" aria-label="Copy code"></button></div><pre><code>' +
        mdHighlight(code, lang) +
        "</code></pre></div>"
    );
}

const MD_FENCE = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)/;
const MD_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const MD_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const MD_LIST = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
const MD_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A line that opens a display equation: starts with $$ and is either unclosed or closed with nothing after it. */
function mdIsMathStart(line) {
    const m = line.match(/^\s*\$\$(.*)$/);
    if (!m) return false;
    const close = m[1].indexOf("$$");
    return close < 0 || m[1].slice(close + 2).trim() === "";
}

function mdStartsBlock(line, next) {
    return (
        mdIsMathStart(line) ||
        MD_FENCE.test(line) ||
        MD_HEADING.test(line) ||
        MD_HR.test(line) ||
        MD_LIST.test(line) ||
        /^\s*>/.test(line) ||
        (line.includes("|") && next !== undefined && MD_TABLE_SEP.test(next))
    );
}

function mdIndent(s) {
    return s.replace(/\t/g, "    ").length;
}

function mdRenderList(items, fn) {
    const stack = [];
    let html = "";
    for (const it of items) {
        while (stack.length && it.indent < stack[stack.length - 1].indent) {
            html += "</li></" + stack.pop().tag + ">";
        }
        const top = stack[stack.length - 1];
        const body = mdInline(it.text, fn).replace(/\n/g, "<br>");
        if (!top || it.indent > top.indent) {
            const tag = it.ordered ? "ol" : "ul";
            const start = it.ordered && it.num !== 1 ? ' start="' + it.num + '"' : "";
            html += "<" + tag + start + "><li>" + body;
            stack.push({ indent: it.indent, tag });
        } else {
            html += "</li><li>" + body;
        }
    }
    while (stack.length) html += "</li></" + stack.pop().tag + ">";
    return html;
}

/**
 * options.streaming: the text is still arriving, so an unclosed $$ block is shown
 * as a placeholder instead of being treated as plain text.
 */
function renderMarkdown(src, options) {
    const streaming = Boolean(options && options.streaming);
    // Footnotes: use the caller's shared state (columns) or make our own and list it at the end.
    const ownNotes = !(options && options.footnotes);
    const fn = ownNotes ? mdNewFootnotes() : options.footnotes;
    if (ownNotes) options = Object.assign({}, options, { footnotes: fn });
    const lines = String(src).replace(/[\u0000-\u0003]/g, "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // CENTO: each blank source line = one blank line-height of space (see .md-blank in looks.css)
        if (/^\s*$/.test(line)) { out.push('<div class="md-blank"></div>'); i++; continue; }

        // Fenced code block (an unclosed fence, as while streaming, runs to the end)
        let m = line.match(MD_FENCE);
        if (m) {
            const indent = m[1].length;
            const fence = m[2];
            const buf = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith(fence)) {
                buf.push(lines[i].replace(new RegExp("^\\s{0," + indent + "}"), ""));
                i++;
            }
            i++;
            out.push(mdCodeBlock(buf.join("\n"), m[3]));
            continue;
        }

        // Display equation: $$ ... $$ on one line, or spread over several lines
        if (mdIsMathStart(line)) {
            const first = line.replace(/^\s*\$\$/, "");
            const closeAt = first.indexOf("$$");
            if (closeAt >= 0) {
                out.push('<div class="math-block">' + mdMath(first.slice(0, closeAt), true) + "</div>");
                i++;
                continue;
            }
            const buf = [first];
            let j = i + 1;
            let rest = null;
            while (j < lines.length) {
                const k = lines[j].indexOf("$$");
                if (k >= 0) {
                    buf.push(lines[j].slice(0, k));
                    rest = lines[j].slice(k + 2);
                    break;
                }
                buf.push(lines[j]);
                j++;
            }
            if (rest !== null) {
                out.push('<div class="math-block">' + mdMath(buf.join("\n"), true) + "</div>");
                if (rest.trim()) { lines[j] = rest; i = j; } else { i = j + 1; }
                continue;
            }
            if (streaming) {
                // Not finished arriving yet: show the TeX quietly until the closing $$ comes.
                out.push('<div class="math-pending">' + escapeHtml("$$" + buf.join("\n")) + "</div>");
                break;
            }
            // Finished text with a stray, never-closed $$: leave it as ordinary text.
            out.push("<p>" + mdInline(line, fn).replace(/\n/g, "<br>") + "</p>");
            i++;
            continue;
        }

        m = line.match(MD_HEADING);
        if (m) {
            out.push("<h" + m[1].length + ">" + mdInline(m[2], fn) + "</h" + m[1].length + ">");
            i++;
            continue;
        }

        if (MD_HR.test(line)) { out.push("<hr>"); i++; continue; }

        // Blockquote
        if (/^\s*>/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s*>\s?/, ""));
                i++;
            }
            out.push("<blockquote>" + renderMarkdown(buf.join("\n"), options) + "</blockquote>");
            continue;
        }

        // Table
        if (line.includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
            const split = (l) =>
                l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
            const head = split(line);
            const aligns = split(lines[i + 1]).map((c) =>
                c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""
            );
            i += 2;
            const cell = (tag, text, k) =>
                "<" + tag + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : "") + ">" +
                mdInline(text, fn) + "</" + tag + ">";
            let html = '<div class="table-wrap"><table><thead><tr>' +
                head.map((c, k) => cell("th", c, k)).join("") + "</tr></thead><tbody>";
            while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
                html += "<tr>" + split(lines[i]).map((c, k) => cell("td", c, k)).join("") + "</tr>";
                i++;
            }
            out.push(html + "</tbody></table></div>");
            continue;
        }

        // List
        m = line.match(MD_LIST);
        if (m) {
            const items = [];
            while (i < lines.length) {
                const l = lines[i];
                const lm = l.match(MD_LIST);
                if (lm && !MD_HR.test(l)) {
                    items.push({
                        indent: mdIndent(lm[1]),
                        ordered: lm[3] !== undefined,
                        num: lm[3] !== undefined ? parseInt(lm[3], 10) : 0,
                        text: lm[4],
                    });
                    i++;
                } else if (/^\s{2,}\S/.test(l) && items.length && !MD_FENCE.test(l)) {
                    items[items.length - 1].text += "\n" + l.trim();
                    i++;
                } else {
                    // CENTO: a blank line ends the list here; the main loop then draws
                    // the blank line(s), and a following item starts a new list
                    // (ordered lists keep counting through start="n").
                    break;
                }
            }
            out.push(mdRenderList(items, fn));
            continue;
        }

        // Paragraph
        const buf = [line];
        i++;
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !mdStartsBlock(lines[i], lines[i + 1])) {
            buf.push(lines[i]);
            i++;
        }
        out.push("<p>" + mdInline(buf.join("\n"), fn).replace(/\n/g, "<br>") + "</p>");
    }
    return out.join("\n") + (ownNotes ? mdFootnoteList(fn) : "");
}

if (typeof module !== "undefined") module.exports = { renderMarkdown, escapeHtml, mdNewFootnotes, mdFootnoteList };
