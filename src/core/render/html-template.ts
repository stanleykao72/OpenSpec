/**
 * spec-viewer design tokens & skeleton (ported from odoo-claude-code's
 * `deploy/templates/html/{conventions.md,skeleton.html}`, the skill-side
 * source of truth for the `spec-html` viewer).
 *
 * This fork must stay self-contained (no cross-repo reference at render
 * time, per design.md Decision 1), so the CSS variables/classes and the
 * vanilla navigation script are re-declared here as TS constants. The
 * comment layer (`.spec-comment-*` / `.spec-review-*`, the three
 * `BLOCK: 評論層 ...` sections in skeleton.html) is a Non-Goal for the CLI
 * renderer and is intentionally NOT ported — it depends on
 * `localStorage`/selection APIs that only make sense in an interactive
 * Artifact viewer, not a deterministic file the CLI writes to disk.
 *
 * Sync discipline: when odoo-claude-code's conventions change, a human
 * updates this file to match. Drift is caught by the renderer's own
 * fixture/determinism tests (design.md "Risks").
 */

/** Full `<style>...</style>` block: CSS variables + every class the
 * renderer emits. Deliberately excludes the comment-layer CSS block. */
export const SPEC_VIEWER_STYLE = `<style>
  :root {
    color-scheme: light dark;
    scroll-behavior: smooth;

    --spec-bg: #f8f9fa;
    --spec-bg-card: #ffffff;
    --spec-fg: #1a1a1a;
    --spec-fg-muted: #6b7280;
    --spec-border: #e2e2e2;
    --spec-accent: #4c6ef5;
    --spec-accent-fg: #ffffff;

    --spec-sev-critical: #ff6b6b;
    --spec-sev-high: #ff922b;
    --spec-sev-medium: #ffd43b;
    --spec-sev-low: #868e96;
    --spec-info: #339af0;

    --spec-gate-pass: #51cf66;
    --spec-gate-fail: #ff6b6b;
    --spec-gate-pending: #ffd43b;
    --spec-gate-missing: #868e96;

    --spec-pill-shall-bg: #4c6ef5;
    --spec-pill-shall-fg: #ffffff;
    --spec-pill-must-bg: #0ca678;
    --spec-pill-must-fg: #ffffff;

    --spec-engine-claude: #c96442;
    --spec-engine-codex: #4c9f70;
    --spec-engine-grok: #5865a3;
    --spec-engine-gemini: #8e6fce;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --spec-bg: #14161a;
      --spec-bg-card: #1c1f26;
      --spec-fg: #e8e8e8;
      --spec-fg-muted: #9aa0a6;
      --spec-border: #33363c;
      --spec-accent: #7c93ff;
      --spec-accent-fg: #0d0d0f;
    }
  }

  :root[data-theme="dark"] {
    --spec-bg: #14161a;
    --spec-bg-card: #1c1f26;
    --spec-fg: #e8e8e8;
    --spec-fg-muted: #9aa0a6;
    --spec-border: #33363c;
    --spec-accent: #7c93ff;
    --spec-accent-fg: #0d0d0f;
  }
  :root[data-theme="light"] {
    --spec-bg: #f8f9fa;
    --spec-bg-card: #ffffff;
    --spec-fg: #1a1a1a;
    --spec-fg-muted: #6b7280;
    --spec-border: #e2e2e2;
    --spec-accent: #4c6ef5;
    --spec-accent-fg: #ffffff;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 1.5rem clamp(1rem, 4vw, 3rem) 3rem;
    background: var(--spec-bg);
    color: var(--spec-fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;
    line-height: 1.55;
    overflow-x: hidden;
  }
  .spec-scroll-x { overflow-x: auto; }
  h1, h2, h3 { line-height: 1.3; }
  a { color: var(--spec-accent); }

  .spec-header {
    display: flex; flex-wrap: wrap; gap: .75rem 1.25rem;
    align-items: center; justify-content: space-between;
    padding-bottom: 1rem; margin-bottom: 1rem;
    border-bottom: 1px solid var(--spec-border);
  }
  .spec-header h1 { margin: 0; font-size: 1.4rem; }
  .spec-gate-row { display: flex; flex-wrap: wrap; gap: .5rem; }

  .spec-gate {
    display: inline-flex; align-items: center; gap: .4rem;
    padding: .3rem .7rem; border-radius: 999px;
    background: var(--spec-bg-card); border: 1px solid var(--spec-border);
    font-size: .82rem; white-space: nowrap;
  }
  .spec-gate .dot { width: .6rem; height: .6rem; border-radius: 50%; flex: none; }
  .spec-gate.pass .dot { background: var(--spec-gate-pass); }
  .spec-gate.fail .dot { background: var(--spec-gate-fail); }
  .spec-gate.pending .dot { background: var(--spec-gate-pending); }
  .spec-gate.missing .dot { background: var(--spec-gate-missing); }
  .spec-gate.missing { border-style: dashed; color: var(--spec-fg-muted); }

  .spec-route {
    margin: 0 0 1.5rem; padding: .75rem 1rem; overflow-x: auto;
    background: var(--spec-bg-card); border: 1px solid var(--spec-border); border-radius: 10px;
  }
  .spec-route-line {
    display: flex; align-items: center; list-style: none; margin: 0; padding: 0;
    min-width: max-content;
  }
  .spec-route-line .station {
    display: flex; align-items: center; gap: .4rem;
    font-size: .82rem; color: var(--spec-fg-muted); white-space: nowrap;
  }
  .spec-route-line .station::before {
    content: ""; width: .7rem; height: .7rem; border-radius: 50%;
    background: var(--spec-border); flex: none;
  }
  .spec-route-line .station.done::before { background: var(--spec-gate-pass); }
  .spec-route-line .station.current::before { background: var(--spec-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--spec-accent) 25%, transparent); }
  .spec-route-line .station.current { color: var(--spec-fg); font-weight: 700; }
  .spec-route-line .station.done { color: var(--spec-fg); }
  .spec-route-line .connector {
    flex: 1 0 1.75rem; height: 2px; background: var(--spec-border); margin: 0 .25rem;
    min-width: 1.75rem;
  }
  .spec-route-line .connector.done { background: var(--spec-gate-pass); }

  .spec-shell { display: flex; align-items: flex-start; gap: 1.5rem; }
  .spec-drawer-toggle {
    display: none; position: sticky; top: .5rem; z-index: 5;
    background: var(--spec-bg-card); color: var(--spec-fg);
    border: 1px solid var(--spec-border); border-radius: 8px;
    padding: .4rem .7rem; font-size: .85rem; cursor: pointer;
  }
  .spec-sidebar {
    flex: 0 0 15rem; width: 15rem;
    position: sticky; top: 1rem; max-height: calc(100vh - 2rem);
    overflow-y: auto; overflow-x: hidden;
    background: var(--spec-bg-card); border: 1px solid var(--spec-border); border-radius: 10px;
    padding: .75rem .9rem; font-size: .85rem;
  }
  .spec-sidebar .spec-tree-title { margin: 0 0 .35rem; font-weight: 700; font-size: .9rem; }

  .spec-tree-legend {
    margin: 0 0 .6rem; padding-bottom: .5rem; font-size: .7rem; color: var(--spec-fg-muted);
    border-bottom: 1px dashed var(--spec-border);
  }

  .spec-tier {
    display: inline-block; flex: none; margin-right: .35rem;
    padding: 0 .3rem; border-radius: 3px;
    font-size: .62rem; font-weight: 700; letter-spacing: .04em;
    vertical-align: .08em;
  }
  .spec-tier.cap { background: var(--spec-accent); color: var(--spec-accent-fg); }
  .spec-tier.req { background: color-mix(in srgb, var(--spec-accent) 22%, transparent); color: var(--spec-accent); }
  .spec-tier.scn { background: transparent; color: var(--spec-fg-muted); border: 1px solid var(--spec-border); }

  .spec-tree-node { margin: .1rem 0 .45rem; }
  .spec-tree-node summary { cursor: pointer; font-weight: 600; margin: .3rem 0; }
  .spec-tree-node summary .spec-tree-cap-name { font-size: .86rem; }
  .spec-tree-cap-slug {
    display: block; margin: 0 0 .2rem 1.9rem;
    font-size: .68rem; color: var(--spec-fg-muted); word-break: break-all;
  }
  .spec-tree-node ul { list-style: none; margin: .25rem 0 .5rem; padding-left: .55rem; }
  .spec-tree-node li { margin: .15rem 0; }
  .spec-tree-node > ul > li { border-left: 2px solid color-mix(in srgb, var(--spec-accent) 35%, transparent); padding-left: .35rem; }
  .spec-tree-node > ul > li > ul { padding-left: .5rem; }
  .spec-tree-node > ul > li > ul .spec-tree-link { font-size: .78rem; font-weight: 400; }
  .spec-tree-link {
    display: flex; align-items: baseline; padding: .15rem .4rem; border-radius: 6px;
    color: var(--spec-fg-muted); text-decoration: none; line-height: 1.35;
  }
  .spec-tree-node > ul > li > .spec-tree-link { font-weight: 600; color: var(--spec-fg); }
  .spec-tree-link:hover { background: var(--spec-bg); color: var(--spec-fg); }
  .spec-tree-link.active {
    background: color-mix(in srgb, var(--spec-accent) 15%, transparent);
    color: var(--spec-accent); font-weight: 700;
  }
  .spec-main { flex: 1 1 auto; min-width: 0; }

  @media (max-width: 46rem) {
    .spec-drawer-toggle { display: inline-block; margin-bottom: .75rem; }
    .spec-shell { position: relative; }
    .spec-sidebar {
      position: fixed; top: 0; left: 0; height: 100vh; max-height: 100vh;
      transform: translateX(-100%); transition: transform .2s ease;
      z-index: 20; border-radius: 0; width: 16rem;
      box-shadow: 2px 0 12px rgba(0, 0, 0, .25);
    }
    .spec-sidebar.open { transform: translateX(0); }
  }

  .spec-card {
    background: var(--spec-bg-card); border: 1px solid var(--spec-border);
    border-radius: 10px; padding: 1rem 1.25rem; margin: 0 0 1rem;
    scroll-margin-top: 1rem;
  }
  .spec-card > h3 { margin-top: 0; }

  .spec-missing {
    border: 1px dashed var(--spec-border); border-radius: 10px;
    padding: .9rem 1.1rem; color: var(--spec-fg-muted);
    font-style: italic; margin: 0 0 1rem;
  }

  .spec-pill {
    display: inline-block; padding: .05rem .55rem; border-radius: 999px;
    font-size: .72rem; font-weight: 700; letter-spacing: .03em;
    vertical-align: middle;
  }
  .spec-pill.shall { background: var(--spec-pill-shall-bg); color: var(--spec-pill-shall-fg); }
  .spec-pill.must  { background: var(--spec-pill-must-bg); color: var(--spec-pill-must-fg); }

  .spec-req-table { width: 100%; border-collapse: collapse; margin: .35rem 0 1.25rem; font-size: .9rem; }
  .spec-req-table caption { text-align: left; font-size: .8rem; color: var(--spec-fg-muted); padding-bottom: .35rem; }
  .spec-req-table th, .spec-req-table td {
    text-align: left; vertical-align: top; padding: .45rem .6rem;
    border-bottom: 1px solid var(--spec-border);
  }
  .spec-req-table th { font-size: .78rem; font-weight: 700; color: var(--spec-fg-muted); white-space: nowrap; }
  .spec-req-table td.pills { white-space: nowrap; }
  .spec-req-table td.count { text-align: right; white-space: nowrap; color: var(--spec-fg-muted); }
  .spec-req-table a { text-decoration: none; }
  .spec-req-table a:hover { text-decoration: underline; }

  .spec-requirement {
    border-left: 3px solid var(--spec-accent); padding-left: .9rem; margin: 0 0 1rem;
    scroll-margin-top: 1rem;
  }
  .spec-requirement:last-child { margin-bottom: 0; }
  .spec-requirement > h4 { margin: 0 0 .35rem; font-size: .95rem; }

  .spec-scenario {
    background: var(--spec-bg); border: 1px solid var(--spec-border);
    border-radius: 8px; padding: .7rem .9rem; margin: .6rem 0;
    scroll-margin-top: 1rem;
  }
  .spec-scenario .name { font-weight: 600; margin-bottom: .4rem; }
  .spec-scenario dl { display: grid; grid-template-columns: 4.5rem 1fr; gap: .25rem .6rem; margin: 0; }
  .spec-scenario dt { font-weight: 700; color: var(--spec-fg-muted); }
  .spec-scenario dd { margin: 0; }

  .spec-severity {
    display: inline-flex; align-items: center; gap: .35rem;
    padding: .15rem .6rem; border-radius: 6px; font-size: .78rem; font-weight: 600;
    color: #1a1a1a;
  }
  .spec-severity.critical { background: var(--spec-sev-critical); }
  .spec-severity.high     { background: var(--spec-sev-high); }
  .spec-severity.medium   { background: var(--spec-sev-medium); }
  .spec-severity.low      { background: var(--spec-sev-low); color: #fff; }

  .spec-engine {
    display: inline-flex; align-items: center; gap: .3rem;
    padding: .15rem .55rem; border-radius: 6px; font-size: .76rem; font-weight: 600;
    color: #fff;
  }
  .spec-engine.claude { background: var(--spec-engine-claude); }
  .spec-engine.codex  { background: var(--spec-engine-codex); }
  .spec-engine.grok   { background: var(--spec-engine-grok); }
  .spec-engine.gemini { background: var(--spec-engine-gemini); }

  .spec-progress-wrap { display: flex; align-items: center; gap: .75rem; margin: .5rem 0 1.25rem; }
  .spec-progress { flex: 1; height: .6rem; border-radius: 999px; background: var(--spec-border); overflow: hidden; }
  .spec-progress > span { display: block; height: 100%; background: var(--spec-gate-pass); }
  .spec-progress-label { font-size: .85rem; color: var(--spec-fg-muted); white-space: nowrap; }
  .spec-progress-wrap.sm { margin: .2rem 0 .6rem; gap: .5rem; }
  .spec-progress-wrap.sm .spec-progress { height: .3rem; }
  .spec-progress-wrap.sm .spec-progress-label { font-size: .76rem; }

  .spec-task-group { margin: .5rem 0; }
  .spec-task-group > summary .spec-task-group-name { flex: none; font-weight: 700; }
  .spec-task-group > summary .spec-progress {
    flex: 1 1 6rem; max-width: 14rem; min-width: 3rem; height: .35rem;
  }
  .spec-task-group > summary .spec-progress-label { flex: none; font-size: .78rem; }

  .spec-task-table { width: 100%; border-collapse: collapse; margin: .4rem 0 .2rem; font-size: .88rem; }
  .spec-task-table th, .spec-task-table td {
    text-align: left; vertical-align: top; padding: .4rem .6rem;
    border-bottom: 1px solid var(--spec-border);
  }
  .spec-task-table th { font-size: .76rem; font-weight: 700; color: var(--spec-fg-muted); white-space: nowrap; }
  .spec-task-table td.check { width: 2.2rem; text-align: center; }
  .spec-task-table td.no { width: 3.2rem; white-space: nowrap; color: var(--spec-fg-muted); font-variant-numeric: tabular-nums; }
  .spec-task-table tr.done td.check { color: var(--spec-gate-pass); }
  .spec-task-table tr.todo td.check { color: var(--spec-fg-muted); }

  details.spec-collapse {
    border: 1px solid var(--spec-border); border-radius: 8px;
    padding: .5rem .8rem; margin: .5rem 0; background: var(--spec-bg-card);
  }
  details.spec-collapse > summary {
    cursor: pointer; font-weight: 600; list-style: none;
    display: flex; flex-wrap: wrap; align-items: center; gap: .5rem;
  }
  details.spec-collapse > summary::-webkit-details-marker { display: none; }
  details.spec-collapse > summary::before { content: "\\25B8"; }
  details.spec-collapse[open] > summary::before { content: "\\25BE"; }
  .spec-raw {
    margin: .6rem 0 0; padding: .7rem .9rem; border-radius: 6px;
    background: var(--spec-bg); border: 1px solid var(--spec-border);
    font-size: .8rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .spec-mermaid-lg {
    width: 100%; margin: .75rem 0 1rem; padding: .9rem 1rem;
    background: var(--spec-bg); border: 1px solid var(--spec-border); border-radius: 8px;
    font-size: 1.05rem; line-height: 1.45; overflow-x: auto;
  }
  .spec-mermaid-lg svg { width: 100%; max-width: 100%; height: auto; }

  /* Global [hidden] protection: author styles that declare their own display
     (e.g. flex/grid on a modal-like element) would otherwise beat the UA's
     default [hidden]{display:none} rule. Load-bearing — do not remove. */
  [hidden] { display: none !important; }
</style>`;

/** Vanilla-JS navigation behavior ported verbatim in spirit from skeleton.html:
 * drawer toggle (narrow-screen sidebar), revealTarget() (expand ancestor
 * `details` before jumping to an anchor — the progressive-disclosure
 * counterpart), and scrollspy via IntersectionObserver. No external deps,
 * no comment-layer coupling. */
export const SPEC_VIEWER_NAV_SCRIPT = `<script>
  (function () {
    "use strict";

    var toggle = document.querySelector(".spec-drawer-toggle");
    var sidebar = document.getElementById("spec-sidebar");

    function revealTarget(id) {
      var el = id ? document.getElementById(id) : null;
      if (!el) return false;
      var node = el.parentNode;
      while (node && node.nodeType === 1) {
        if (node.tagName === "DETAILS") node.open = true;
        node = node.parentNode;
      }
      if (el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" });
      return true;
    }

    if (toggle && sidebar) {
      toggle.addEventListener("click", function () {
        var open = sidebar.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      sidebar.querySelectorAll(".spec-tree-link").forEach(function (link) {
        link.addEventListener("click", function (ev) {
          if (revealTarget(link.getAttribute("data-target"))) ev.preventDefault();
          if (window.matchMedia("(max-width: 46rem)").matches) {
            sidebar.classList.remove("open");
            toggle.setAttribute("aria-expanded", "false");
          }
        });
      });
    }

    document.querySelectorAll(".spec-req-table a[href^='#']").forEach(function (link) {
      link.addEventListener("click", function (ev) {
        if (revealTarget(link.getAttribute("href").slice(1))) ev.preventDefault();
      });
    });

    var links = Array.prototype.slice.call(document.querySelectorAll(".spec-tree-link"));
    var targets = links
      .map(function (a) { return document.getElementById(a.getAttribute("data-target")); })
      .filter(Boolean);

    if ("IntersectionObserver" in window && targets.length) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            links.forEach(function (l) { l.classList.remove("active"); });
            var active = links.filter(function (l) {
              return l.getAttribute("data-target") === entry.target.id;
            })[0];
            if (active) active.classList.add("active");
          });
        },
        { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
      );
      targets.forEach(function (t) { observer.observe(t); });
    }
  })();
</script>`;

/** The 5 fixed lifecycle stations, in order. */
export const LIFECYCLE_STATIONS = ['explore', 'propose', 'apply', 'verify', 'archive'] as const;
export type LifecycleStation = (typeof LIFECYCLE_STATIONS)[number];

/** Sidebar legend text (規格 › 需求 › 情境). */
export const TREE_LEGEND_TEXT = '規格 › 需求 › 情境';
