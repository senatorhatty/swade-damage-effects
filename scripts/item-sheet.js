/**
 * item-sheet.js
 * Injects the Damage Keywords field into SWADE item sheets.
 *
 * We store keywords in item flags so we never touch the system's data schema.
 * Flag path: item.flags["swade-damage-effects"].keywords  (plain string)
 */

const MODULE_ID = 'swade-damage-effects';

// Item types that deal damage and should show the keyword field.
// 'gear' is included because some settings use gear as improvised weapons.
const KEYWORD_TYPES = new Set(['weapon', 'power', 'gear', 'shield', 'consumable']);

export function initItemSheet() {
  Hooks.on('renderItemSheet', _onRenderItemSheet);
}

async function _onRenderItemSheet(sheet, html, _data) {
  // sheet.document is AppV2; sheet.item is AppV1 legacy — handle both.
  const item = sheet.document ?? sheet.item;
  if (!item) return;
  if (!KEYWORD_TYPES.has(item.type)) return;

  const keywords = item.getFlag(MODULE_ID, 'keywords') ?? '';
  const editable = sheet.isEditable;

  const rendered = await renderTemplate(
    `modules/${MODULE_ID}/templates/partials/keyword-input.hbs`,
    { keywords, editable }
  );

  // Normalise html to a jQuery object — AppV2 passes a plain HTMLElement.
  const $html = (html instanceof jQuery) ? html : $(html);

  // Try injection points in order of preference.
  // SWADE's Properties tab uses data-tab="properties" — that's our primary target.
  // Fallbacks handle other item types or future sheet changes.
  const $target =
    $html.find('[data-tab="properties"]').first()   ||
    $html.find('[data-tab="description"]').first()  ||
    $html.find('[data-tab="details"]').first()      ||
    $html.find('.sheet-body').first()               ||
    $html.find('form').first();

  $target.append(rendered);

  // Wire up save-on-change.  We call setFlag directly rather than relying on
  // Foundry's form submission so the injected field is always captured.
  $html.find('.sde-keywords-input').on('change', async (event) => {
    const value = event.currentTarget.value.trim();
    await item.setFlag(MODULE_ID, 'keywords', value);
  });
}
