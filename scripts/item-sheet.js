/**
 * item-sheet.js
 * Adds a "Keywords" tab to SWADE item sheets (Foundry v14 / SWADE 6+).
 *
 * Foundry v14 uses AppV2 exclusively. The correct hook is renderSwadeItemSheetV2,
 * which passes a plain HTMLElement (not jQuery). AppV2's built-in data-action="tab"
 * handler manages tab switching automatically once our tab is in the DOM.
 *
 * Keywords stored in flags — never touches the system data schema:
 *   item.flags["swade-damage-effects"].keywords  (comma-separated string)
 */

const MODULE_ID = 'swade-damage-effects';

const KEYWORD_TYPES = new Set(['weapon', 'power', 'gear', 'shield', 'consumable']);

export function initItemSheet() {
  Hooks.on('renderSwadeItemSheetV2', _onRender);
}

async function _onRender(app, html, _context, _options) {
  const item = app.document;
  if (!item || !KEYWORD_TYPES.has(item.type)) return;

  const keywords = item.getFlag(MODULE_ID, 'keywords') ?? '';
  const editable  = app.isEditable;

  const rendered = await renderTemplate(
    `modules/${MODULE_ID}/templates/partials/keyword-input.hbs`,
    { keywords, editable }
  );

  // html is a plain HTMLElement in v14 — no jQuery needed.
  const nav  = html.querySelector('nav.sheet-tabs');
  const body = html.querySelector('.sheet-body');
  if (!nav || !body) {
    console.warn(`${MODULE_ID} | Could not find nav or body on ${item.name}`);
    return;
  }

  // Read the tab group name from whatever tab already exists.
  const group = nav.querySelector('[data-tab]')?.dataset.group ?? 'main';

  // ── Tab nav entry ───────────────────────────────────────────────────────────
  // data-action="tab" is picked up by AppV2's built-in event delegation,
  // so tab switching works without any extra JS from us.
  const link = document.createElement('a');
  link.dataset.action  = 'tab';
  link.dataset.group   = group;
  link.dataset.tab     = 'sde-keywords';
  link.dataset.tooltip = game.i18n.localize('SDE.Keywords.Label');
  link.innerHTML = `<i class="fas fa-tags" inert></i><span>${game.i18n.localize('SDE.Keywords.Label')}</span>`;
  nav.appendChild(link);

  // ── Tab panel ───────────────────────────────────────────────────────────────
  const panel = document.createElement('section');
  panel.className       = 'tab';
  panel.dataset.group   = group;
  panel.dataset.tab     = 'sde-keywords';
  panel.innerHTML       = rendered;
  body.appendChild(panel);

  // ── Save on change ──────────────────────────────────────────────────────────
  panel.querySelector('.sde-keywords-input')?.addEventListener('change', async (e) => {
    await item.setFlag(MODULE_ID, 'keywords', e.currentTarget.value.trim());
  });
}
