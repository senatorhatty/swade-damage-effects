/**
 * item-sheet.js
 * Adds a "Keywords" tab to SWADE item sheets.
 *
 * We inject a full new tab rather than trying to append to an existing one,
 * which avoids fragile selector guessing and gives the field its own clean space.
 *
 * Keywords are stored in item flags so we never touch the system's data schema:
 *   item.flags["swade-damage-effects"].keywords  (plain comma-separated string)
 */

const MODULE_ID = 'swade-damage-effects';

// Item types that deal damage and should carry keyword tags.
const KEYWORD_TYPES = new Set(['weapon', 'power', 'gear', 'shield', 'consumable']);

export function initItemSheet() {
  Hooks.on('renderItemSheet', _onRenderItemSheet);
}

async function _onRenderItemSheet(sheet, html, _data) {
  // Support both AppV2 (sheet.document) and AppV1 (sheet.item).
  const item = sheet.document ?? sheet.item;

  console.log(`${MODULE_ID} | renderItemSheet fired`, {
    sheetClass: sheet.constructor.name,
    itemType: item?.type,
    htmlType: html?.constructor?.name,
  });

  if (!item) return;
  if (!KEYWORD_TYPES.has(item.type)) {
    console.log(`${MODULE_ID} | skipping item type: ${item.type}`);
    return;
  }

  const keywords = item.getFlag(MODULE_ID, 'keywords') ?? '';
  const editable  = sheet.isEditable;

  const rendered = await renderTemplate(
    `modules/${MODULE_ID}/templates/partials/keyword-input.hbs`,
    { keywords, editable }
  );

  // Normalise to jQuery — AppV2 passes a plain HTMLElement.
  const $html = (html instanceof jQuery) ? html : $(html);

  // ── 1. Find the tab nav and read the data-group from existing tabs ──────
  const $nav = $html.find('nav.sheet-tabs, nav.tabs').first();

  console.log(`${MODULE_ID} | nav found:`, $nav.length, '| html outerHTML snippet:', $html[0]?.outerHTML?.slice(0, 200));

  if (!$nav.length) {
    // No tab nav found — fall back to appending directly to the form.
    console.log(`${MODULE_ID} | no nav — falling back to form append`);
    $html.find('form').append(rendered);
    _wireChangeHandler($html, item);
    return;
  }

  // Get the group name from the first existing tab anchor.
  const group = $nav.find('[data-tab]').first().attr('data-group') ?? 'primary';

  // ── 2. Inject the tab nav entry ─────────────────────────────────────────
  $nav.append(`
    <a data-action="tab"
       data-group="${group}"
       data-tab="sde-keywords"
       data-tooltip="${game.i18n.localize('SDE.Keywords.Label')}">
      <i class="fas fa-tags" inert></i>
      <span>${game.i18n.localize('SDE.Keywords.Label')}</span>
    </a>
  `);

  // ── 3. Inject the tab panel ─────────────────────────────────────────────
  const $body = $html.find('.sheet-body').first();
  $body.append(`
    <section class="tab sde-keywords-tab"
             data-group="${group}"
             data-tab="sde-keywords">
      ${rendered}
    </section>
  `);

  // ── 4. Wire up tab switching ────────────────────────────────────────────
  // Foundry's Tabs instance was already initialised before we injected,
  // so we handle clicks on our tab manually.
  $nav.find('[data-tab="sde-keywords"]').on('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    // Deactivate every tab in this group.
    $nav.find(`[data-group="${group}"]`).removeClass('active');
    $body.find(`.tab[data-group="${group}"]`).removeClass('active');

    // Activate ours.
    $(this).addClass('active');
    $body.find('.tab[data-tab="sde-keywords"]').addClass('active');
  });

  // ── 5. Save on change ───────────────────────────────────────────────────
  _wireChangeHandler($html, item);
}

function _wireChangeHandler($html, item) {
  $html.find('.sde-keywords-input').on('change', async (event) => {
    const value = event.currentTarget.value.trim();
    await item.setFlag(MODULE_ID, 'keywords', value);
  });
}
