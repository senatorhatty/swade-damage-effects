/**
 * damage-intercept.js  — Phase B
 *
 * Hooks into swade-targeted-damage's TargetedDamageApplicator to apply
 * keyword-based damage modifiers before wounds are calculated.
 *
 * Flow:
 *  1. swadeRollDamage       → store item keywords on roll.options
 *  2. renderChatMessageHTML → intercept "Resolve Damage" button click;
 *                             pre-compute per-token modifiers into _pending Map
 *  3. preRenderTargetedDamageApplicator → modify app.object.damage BEFORE
 *                             _prepareContext → calcWounds() runs
 *  4. renderTargetedDamageApplicator    → inject banner with revert button
 *
 * Note: modifier application is limited to the local client (GM-owned tokens).
 * Player-owned tokens open the applicator on the player's client via a socket
 * query; cross-client modifier delivery requires a socketlib extension (future).
 */

import { parseItemKeywords, resolveBestEffect } from './keywords.js';

const MODULE_ID = 'swade-damage-effects';

/**
 * Map<tokenUuid, PendingModifier>
 * Populated when the GM clicks "Resolve Damage"; consumed when the applicator opens.
 * Cleared at the start of each new click so stale data never bleeds across rolls.
 *
 * @typedef {{ originalDamage: number, modifiedDamage: number,
 *             effectName: string, operator: string, value: number }} PendingModifier
 */
const _pending = new Map();

// ── Public init ──────────────────────────────────────────────────────────────

export function initDamageIntercept() {
  Hooks.once('ready', () => {
    if (!game.modules.get('swade-targeted-damage')?.active) {
      console.warn(`${MODULE_ID} | swade-targeted-damage is not active — damage intercept disabled.`);
      return;
    }
    console.log(`${MODULE_ID} | swade-targeted-damage detected — damage intercept active.`);
    _registerHooks();
  });
}

// ── Hook registration ────────────────────────────────────────────────────────

function _registerHooks() {

  // 1. Tag the roll with item keywords so we can retrieve them from the message.
  Hooks.on('swadeRollDamage', (_actor, item, roll) => {
    const raw = item?.getFlag?.(MODULE_ID, 'keywords') ?? '';
    if (raw) roll.options._sdeItemKeywords = raw;
  });

  // 2. When a damage chat card renders, wire our pre-processor into the button.
  Hooks.on('renderChatMessageHTML', (message, html, context) => {
    const roll = message.significantRoll;
    if (!roll || roll.constructor.name !== 'DamageRoll') return;
    if (roll.options?.rollType !== 'damage') return;

    const btn = html.querySelector('.swade-roll-message button.calculate-wounds');
    if (!btn) return;

    // Our listener runs ALONGSIDE swade-targeted-damage's listener.
    // Both fire on click; ours stores data synchronously before the first
    // `await` in triggerFlow() yields control, so _pending is populated
    // before the TargetedDamageApplicator is rendered.
    btn.addEventListener('click', () => {
      _storePending(roll, context.user?.targets ?? game.user.targets);
    });
  });

  // 3. Modify app.object.damage BEFORE _prepareContext → calcWounds() runs.
  //    preRender fires before context preparation in the AppV2 lifecycle.
  Hooks.on('preRenderTargetedDamageApplicator', (app, _context, _options) => {
    _applyPendingDamage(app);
  });

  // 4. Inject the keyword banner into the rendered dialog.
  Hooks.on('renderTargetedDamageApplicator', (app, html) => {
    _injectBanner(app, html);
  });
}

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Compute keyword modifiers for every targeted token and store in _pending.
 * Called synchronously when the Resolve Damage button is clicked.
 */
function _storePending(roll, targets) {
  _pending.clear();

  const keywords = parseItemKeywords(roll.options?._sdeItemKeywords ?? '');
  const damage   = roll.total;

  for (const token of targets) {
    if (!token.actor) continue;
    const best = resolveBestEffect(damage, keywords, token.actor);
    if (!best) continue;

    _pending.set(token.document.uuid, {
      originalDamage: damage,
      modifiedDamage: Math.round(best.result),
      effectName:     best.effect.name,
      operator:       best.operator,
      value:          best.value,
    });
  }
}

/**
 * If this token has a pending modifier, update app.object.damage before
 * calcWounds() runs.  Called from preRenderTargetedDamageApplicator.
 */
function _applyPendingDamage(app) {
  const tokenUuid = app.options?.token?.uuid ?? app.object?.tokenUuid;
  const pending   = _pending.get(tokenUuid);
  if (!pending) return;

  app.object.damage = pending.modifiedDamage;
}

/**
 * Inject a banner into the TargetedDamageApplicator showing the active
 * keyword modifier and offering a "Revert" button to undo it.
 * Called from renderTargetedDamageApplicator.
 */
function _injectBanner(app, html) {
  const tokenUuid = app.options?.token?.uuid ?? app.object?.tokenUuid;
  const pending   = _pending.get(tokenUuid);
  if (!pending) return;

  // Don't double-inject on partial re-renders (soak rolls etc.).
  if (html.querySelector('.sde-damage-prompt')) return;

  const modText = pending.operator === 'multiply'
    ? `×${pending.value}`
    : (pending.value >= 0 ? `+${pending.value}` : `${pending.value}`);

  const banner = document.createElement('div');
  banner.className = 'sde-damage-prompt';
  banner.innerHTML = `
    <h4>${game.i18n.localize('SDE.Prompt.Title')}</h4>
    <div class="sde-effect-row">
      <span class="sde-effect-label">${pending.effectName} (${modText})</span>
      <span class="sde-original">${pending.originalDamage}</span>
      <span>→</span>
      <span class="sde-modified">${pending.modifiedDamage}</span>
      <button class="sde-skip-btn" type="button">
        ${game.i18n.localize('SDE.Prompt.Skip')}
      </button>
    </div>`;

  // Inject before all parts so it sits at the top of the dialog body.
  const content = html.querySelector('.window-content') ?? html;
  content.insertAdjacentElement('afterbegin', banner);

  // Revert: restore original damage and clear the pending entry so the
  // next re-render (e.g. after a soak roll) recalculates from scratch.
  banner.querySelector('.sde-skip-btn')?.addEventListener('click', async () => {
    app.object.damage = pending.originalDamage;
    _pending.delete(tokenUuid);
    banner.remove();
    await app.render({ parts: ['fieldset', 'buttons'], force: true });
  });
}
