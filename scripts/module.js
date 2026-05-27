/**
 * SWADE Damage Effects — main entry point
 *
 * Phase A (this build): keyword fields on items + custom AE config tab.
 * Phase B (next):       damage roll interception and chat prompts.
 */

import { registerSettings }  from './settings.js';
import { initItemSheet }      from './item-sheet.js';
import { initEffectConfig }   from './effect-config.js';
import { initDamageIntercept } from './damage-intercept.js';

const MODULE_ID = 'swade-damage-effects';

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initialising`);

  registerSettings();
  initItemSheet();
  initEffectConfig();
  initDamageIntercept();

  // Pre-load all our Handlebars templates so they're cached and ready.
  // loadTemplates() is deprecated in v14; use the namespaced version.
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/partials/keyword-input.hbs`,
    `modules/${MODULE_ID}/templates/effect-config.hbs`,
  ]);
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Ready — Foundry v${game.version}, SWADE ${game.system.version}`);

  if (game.system.id !== 'swade') {
    console.warn(`${MODULE_ID} | This module requires the SWADE system.`);
  }
});
