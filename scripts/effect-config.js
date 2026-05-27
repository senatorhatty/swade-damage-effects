/**
 * effect-config.js
 * Injects a "Damage Keywords" tab into the standard ActiveEffect config sheet.
 *
 * We store the keyword-effect data entirely in flags so we don't conflict
 * with Foundry's or SWADE's built-in active effect handling.
 *
 * Flag shape on each ActiveEffect:
 *   flags["swade-damage-effects"] = {
 *     enabled:   boolean  – whether this effect participates in keyword matching
 *     condition: string   – keyword condition string (see keywords.js for syntax)
 *     operator:  "multiply" | "add"
 *     value:     number   – multiplier or addend
 *   }
 */

const MODULE_ID = 'swade-damage-effects';

export function initEffectConfig() {
  Hooks.on('renderActiveEffectConfig', _onRenderActiveEffectConfig);
}

async function _onRenderActiveEffectConfig(sheet, html, _data) {
  const effect = sheet.document ?? sheet.object;
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

  const $html = (html instanceof jQuery) ? html : $(html);

  // The AE config sheet has a tab strip — add our tab to it.
  const $nav = $html.find('nav.sheet-tabs');
  if ($nav.length) {
    $nav.append(
      `<a class="item" data-tab="sde-keywords">
        <i class="fas fa-tags"></i>
        ${game.i18n.localize('SDE.Effect.TabLabel')}
      </a>`
    );
  }

  // Append the tab panel.
  const $body = $html.find('.sheet-body');
  $body.append(rendered);

  // Activate the Foundry tab system for our new tab.
  // The AE config sheet manages its own Tabs instance — we just need the DOM.
  $html.find('.sde-effect-tab a.item').on('click', function () {
    $html.find('.tab[data-tab]').removeClass('active');
    $html.find('.tab[data-tab="sde-keywords"]').addClass('active');
    $html.find('nav.sheet-tabs .item').removeClass('active');
    $(this).addClass('active');
  });

  // Save on submit — hook into the sheet's update handler.
  const originalUpdate = sheet._updateObject?.bind(sheet);
  if (originalUpdate) {
    sheet._updateObject = async function (event, formData) {
      await _saveSdeFlags(effect, $html);
      return originalUpdate(event, formData);
    };
  } else {
    // AppV2 path — listen for the form submit.
    $html.find('form').on('submit', async () => {
      await _saveSdeFlags(effect, $html);
    });
  }
}

async function _saveSdeFlags(effect, $html) {
  const enabled   = $html.find('[name="sde-enabled"]').prop('checked');
  const condition = $html.find('[name="sde-condition"]').val().trim();
  const operator  = $html.find('[name="sde-operator"]').val();
  const value     = parseFloat($html.find('[name="sde-value"]').val()) || 0;

  await effect.setFlag(MODULE_ID, 'enabled',   enabled);
  await effect.setFlag(MODULE_ID, 'condition',  condition);
  await effect.setFlag(MODULE_ID, 'operator',   operator);
  await effect.setFlag(MODULE_ID, 'value',      value);
}
