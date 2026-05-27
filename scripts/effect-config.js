/**
 * effect-config.js
 * Adds a "Damage Keywords" tab to the ActiveEffect config sheet (Foundry v14).
 *
 * In v14, ActiveEffectConfig extends HandlebarsApplicationMixin(DocumentSheetV2).
 * Hook: renderActiveEffectConfig  — html is a plain HTMLElement.
 * Tab group: "sheet"  (tabs: details, duration, changes — we add sde-keywords).
 *
 * Flag shape on each ActiveEffect:
 *   flags["swade-damage-effects"] = {
 *     enabled:   boolean
 *     condition: string   — keyword condition (see keywords.js for syntax)
 *     operator:  "multiply" | "add"
 *     value:     number
 *   }
 */

const MODULE_ID = 'swade-damage-effects';

export function initEffectConfig() {
  Hooks.on('renderActiveEffectConfig', _onRender);
}

async function _onRender(app, html, _context, _options) {
  const effect = app.document;
  if (!effect) return;

  const flags = effect.flags?.[MODULE_ID] ?? {};
  const data = {
    enabled:   flags.enabled   ?? false,
    condition: flags.condition  ?? '',
    operator:  flags.operator   ?? 'multiply',
    value:     flags.value      ?? 0.5,
  };

  const rendered = await renderTemplate(
    `modules/${MODULE_ID}/templates/effect-config.hbs`,
    data
  );

  // In Foundry v14, ActiveEffectConfig uses AppV2 PARTS-based rendering.
  // The tab nav is rendered as <nav class="sheet-tabs ..."> (the "tabs" part).
  // Tab sections are direct children of .window-content — there is no .sheet-body wrapper.
  const nav = html.querySelector('nav.sheet-tabs');
  if (!nav) {
    console.warn(`${MODULE_ID} | Could not find tab nav on ActiveEffect config`);
    return;
  }

  const group = nav.querySelector('[data-tab]')?.dataset.group ?? 'sheet';

  // ── Tab nav entry ───────────────────────────────────────────────────────────
  // Remove stale link in case the "tabs" part was re-rendered since last injection.
  nav.querySelector('[data-tab="sde-keywords"]')?.remove();
  const link = document.createElement('a');
  link.dataset.action  = 'tab';
  link.dataset.group   = group;
  link.dataset.tab     = 'sde-keywords';
  link.dataset.tooltip = game.i18n.localize('SDE.Effect.TabLabel');
  link.innerHTML = `<i class="fas fa-tags" inert></i><span>${game.i18n.localize('SDE.Effect.TabLabel')}</span>`;
  nav.appendChild(link);

  // ── Tab panel ───────────────────────────────────────────────────────────────
  // In AppV2 PARTS layout the tab sections are siblings in .window-content.
  // Inject our panel just before the footer part so it sits alongside the
  // core details/duration/changes sections.
  const footer    = html.querySelector('[data-application-part="footer"]');
  const container = footer?.parentElement
    ?? html.querySelector('.window-content')
    ?? html;

  // Skip re-injecting the panel if it survived the last partial re-render.
  let panel = container.querySelector('section[data-tab="sde-keywords"]');
  if (!panel) {
    panel = document.createElement('section');
    panel.className     = 'tab';
    panel.dataset.group = group;
    panel.dataset.tab   = 'sde-keywords';
    panel.innerHTML     = rendered;

    if (footer) container.insertBefore(panel, footer);
    else        container.appendChild(panel);

    // Save on any change within our panel so data isn't lost on close.
    panel.addEventListener('change', async () => {
      await _saveFlags(effect, panel);
    });
  }

  // ── Save when the form submits ──────────────────────────────────────────────
  // html IS the <form> element for ActiveEffectConfig (tag: "form" in AppV2).
  const form = html.matches?.('form') ? html : html.querySelector('form');
  form?.addEventListener('submit', async () => {
    await _saveFlags(effect, panel);
  }, { once: true });
}

async function _saveFlags(effect, panel) {
  const enabled   = panel.querySelector('[name="sde-enabled"]')?.checked ?? false;
  const condition = panel.querySelector('[name="sde-condition"]')?.value.trim() ?? '';
  const operator  = panel.querySelector('[name="sde-operator"]')?.value ?? 'multiply';
  const value     = parseFloat(panel.querySelector('[name="sde-value"]')?.value) || 0;

  await effect.setFlag(MODULE_ID, 'enabled',   enabled);
  await effect.setFlag(MODULE_ID, 'condition',  condition);
  await effect.setFlag(MODULE_ID, 'operator',   operator);
  await effect.setFlag(MODULE_ID, 'value',      value);
}
