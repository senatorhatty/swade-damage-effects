/**
 * damage-intercept.js — Phase B (swade-tools integration)
 *
 * Intercepts clicks on swade-tools "Apply Damage" buttons (.swadetools-applydamage)
 * to inject keyword-based damage modifiers before wounds are applied.
 *
 * Flow:
 *  1. A capture-phase click listener fires before swade-tools' jQuery handler.
 *  2. If the attacking item has keywords AND the target actor has a matching
 *     damage-effect active effect, stopImmediatePropagation() and show a DialogV2.
 *  3. GM picks "Apply Modified" or "Apply Original".
 *  4. "Apply Modified": compute the modified raise count, patch data-swadetools-raise
 *     on the button, then synthetically click it (bypass flag) so swade-tools handles
 *     all status/wound application natively.
 *  5. "Apply Original": synthetic click with bypass flag; swade-tools proceeds normally.
 *  6. Dismiss / close: button remains clickable — the GM can try again.
 *
 * Toughness formula (mirrors swade-tools RollControl.damageTarget):
 *   toughness      = actor.system.stats.toughness.value (total, includes default armor)
 *   armor          = getArmorArea(actor, area) — torso or called-shot location
 *   toughness adj  = toughness - defaultArmor + locationArmor (= toughness for torso)
 *   ap             = min(item.system.ap [+ action override + global mods], armor)
 *   raisecount     = floor((damage - (toughness - ap)) / 4)
 */

import { parseItemKeywords, resolveBestEffect } from './keywords.js';

const MODULE_ID = 'swade-damage-effects';

// ── Public init ───────────────────────────────────────────────────────────────

export function initDamageIntercept() {
  Hooks.once('ready', () => {
    if (!game.modules.get('swade-tools')?.active) {
      console.warn(`${MODULE_ID} | swade-tools is not active — damage intercept disabled.`);
      return;
    }
    console.log(`${MODULE_ID} | swade-tools detected — keyword damage intercept active.`);
    document.addEventListener('click', _onApplyDamageClick, true); // capture phase
  });
}

// ── Click interceptor ─────────────────────────────────────────────────────────

async function _onApplyDamageClick(event) {
  const btn = event.target.closest('a.swadetools-applydamage');
  if (!btn) return;

  // Bypass flag: set on synthetic clicks so this handler ignores them.
  if (btn.hasAttribute('data-sde-bypass')) {
    btn.removeAttribute('data-sde-bypass');
    return;
  }

  // Only act for the GM (players let swade-tools run its own soak dialog).
  if (!game.user.isGM) return;

  // ── Identify the message ──────────────────────────────────────────────────
  const li = btn.closest('[data-message-id]');
  const messageId = li?.dataset.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const flags = message?.flags?.['swade-tools'];
  if (!flags || flags.rolltype !== 'damage') return;

  // ── Get attacker and item ─────────────────────────────────────────────────
  const { itemroll: itemId, useactor: actorId, usetoken: tokenId,
          usecalled: calledArea, useaction: actionKey } = flags;

  const attacker = (tokenId ? canvas.tokens.get(tokenId)?.actor : null)
                ?? game.actors.get(actorId);
  const item = attacker?.items.get(itemId);

  const keywords = parseItemKeywords(item?.getFlag?.(MODULE_ID, 'keywords') ?? '');

  // NOTE: do NOT early-return on empty keywords — negation conditions like
  // `!iron !metal` are designed to match weapons that have NO keywords.

  // ── Get target actor ──────────────────────────────────────────────────────
  const targetTokenId = btn.getAttribute('data-swadetools-targetid');
  const targetToken   = canvas.tokens.get(targetTokenId);
  const actor         = targetToken?.actor;
  if (!actor) return;

  // ── Raw damage ────────────────────────────────────────────────────────────
  const rawDamage = message.rolls?.[0]?.total;
  if (rawDamage == null) return;

  // ── Resolve best keyword modifier ────────────────────────────────────────
  const best = resolveBestEffect(rawDamage, keywords, actor);
  if (!best) return; // No matching effect on this target → let swade-tools proceed.

  // We have a modifier — take over the click.
  event.stopImmediatePropagation();
  event.preventDefault();

  // ── Compute raise counts ──────────────────────────────────────────────────
  const origRaise = Number(btn.getAttribute('data-swadetools-raise') ?? 0);
  const modDamage = Math.round(best.result);
  const modRaise  = _computeRaise(modDamage, actor, item, attacker, calledArea, actionKey);

  // ── Build dialog content ──────────────────────────────────────────────────
  const modText = best.operator === 'multiply'
    ? `×${best.value}`
    : (Number(best.value) >= 0 ? `+${best.value}` : `${best.value}`);

  const origDesc = _raiseLabel(origRaise);
  const modDesc  = _raiseLabel(modRaise);
  const targetName = targetToken.name ?? actor.name;

  // ── Show prompt ───────────────────────────────────────────────────────────
  const choice = await _showPrompt({
    effectName: best.effect.name,
    modText,
    rawDamage,
    modDamage,
    origDesc,
    modDesc,
    targetName,
  });

  if (choice === 'modified') {
    const savedRaise = btn.getAttribute('data-swadetools-raise');
    btn.setAttribute('data-swadetools-raise', String(modRaise));
    btn.setAttribute('data-sde-bypass', '');
    btn.click();
    btn.setAttribute('data-swadetools-raise', savedRaise ?? origRaise);
    _postChatNote({ targetName, effectName: best.effect.name, modText,
                    rawDamage, modDamage, origDesc, modDesc, applied: true });

  } else if (choice === 'soak_modified') {
    // Patch the soak button's raise count and let swade-tools run its full
    // Benny-spend → Vigor roll → result card flow on the modified wound count.
    const soakBtn = li.querySelector(
      `a.swadetools-soakdamage[data-swadetools-targetid="${targetTokenId}"]`
    );
    if (soakBtn) {
      const savedSoakRaise = soakBtn.getAttribute('data-swadetools-raise');
      soakBtn.setAttribute('data-swadetools-raise', String(modRaise));
      soakBtn.click(); // swade-tools handles everything from here
      soakBtn.setAttribute('data-swadetools-raise', savedSoakRaise ?? origRaise);
    } else {
      // No soak button (already used or not available) — fall back to apply.
      const savedRaise = btn.getAttribute('data-swadetools-raise');
      btn.setAttribute('data-swadetools-raise', String(modRaise));
      btn.setAttribute('data-sde-bypass', '');
      btn.click();
      btn.setAttribute('data-swadetools-raise', savedRaise ?? origRaise);
    }
    _postChatNote({ targetName, effectName: best.effect.name, modText,
                    rawDamage, modDamage, origDesc, modDesc, applied: true, soaking: true });

  } else if (choice === 'original') {
    btn.setAttribute('data-sde-bypass', '');
    btn.click();
    _postChatNote({ targetName, effectName: best.effect.name, modText,
                    rawDamage, modDamage, origDesc, modDesc, applied: false });
  }
  // choice === null (closed/dismissed): do nothing; button stays active for retry.
}

// ── Wound calculation ─────────────────────────────────────────────────────────

/**
 * Compute the swade-tools raise count for a given damage value, mirroring
 * RollControl.damageTarget() as closely as possible.
 *
 * Raise semantics:
 *   < 0  → no damage (glancing blow or heavy armour)
 *   = 0  → Shaken only
 *   ≥ 1  → Shaken + that many Wounds
 *
 * @param {number}     damage
 * @param {Actor}      actor      Target actor
 * @param {Item|null}  item       Attacking item (for AP)
 * @param {Actor|null} attacker   Attacking actor (for global AP mods)
 * @param {string}     [area]     Called-shot area, e.g. 'head' (default 'torso')
 * @param {string}     [action]   Item action key for AP override
 * @returns {number}
 */
function _computeRaise(damage, actor, item, attacker, area = 'torso', action = '') {
  // Toughness = total value already including armor bonus.
  const baseToughness  = actor.system.stats.toughness.value ?? 0;
  const defaultArmor   = actor.system.stats.toughness.armor ?? 0;

  // Armor for the struck location (torso = defaultArmor; elsewhere = armorPerLocation).
  const locationArmor = (!area || area.toLowerCase() === 'torso')
    ? defaultArmor
    : (actor.armorPerLocation?.[area.toLowerCase()] ?? defaultArmor);

  // Adjust toughness if a non-torso location was hit.
  const toughness = baseToughness - defaultArmor + locationArmor;

  // AP: base from item, then check action override, then apply global attacker mods.
  let ap = Number(item?.system?.ap ?? 0);

  if (action && item?.system?.actions?.additional?.[action]?.ap != null) {
    ap = Number(item.system.actions.additional[action].ap);
  }

  if (attacker?.system?.stats?.globalMods?.ap?.length > 0) {
    attacker.system.stats.globalMods.ap.forEach(mod => { ap += Number(mod.value ?? 0); });
    if (ap < 0) ap = 0;
  }

  // AP is capped at armor value (can't negate more than the armor present).
  const apReduction = Math.min(ap, locationArmor);
  const effectiveToughness = toughness - apReduction;

  const raise = Math.floor((damage - effectiveToughness) / 4);

  // Mirror swade-tools wound cap (configurable, default on for most tables).
  // We apply it conservatively: only if Wound Cap is in effect.
  // swade-tools checks: gb.settingKeyName('Wound Cap') || gb.systemSetting('woundCap')
  // We don't have access to those helpers, so we just apply the cap at 4.
  // (swade-tools applies this cap before writing data-swadetools-raise, so the value
  //  we patch in should also respect the cap to stay consistent.)
  return raise > 4 ? 4 : raise;
}

// ── Label helpers ─────────────────────────────────────────────────────────────

function _raiseLabel(raise) {
  if (raise < 0)   return game.i18n.localize('SDE.Result.NoDamage');
  if (raise === 0) return game.i18n.localize('SDE.Result.Shaken');
  if (raise === 1) return game.i18n.localize('SDE.Result.OneWound');
  return game.i18n.format('SDE.Result.Wounds', { count: raise });
}

// ── GM chat note ──────────────────────────────────────────────────────────────

/**
 * Post a GM-only whispered chat note recording what the keyword modifier did.
 *
 * @param {object} opts
 * @param {boolean} opts.applied  true = modifier was applied, false = overridden
 */
function _postChatNote({ targetName, effectName, modText, rawDamage, modDamage,
                          origDesc, modDesc, applied, soaking = false }) {
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

  const header = !applied
    ? `<strong>Effect overridden</strong> — ${effectName} (${modText}) ignored`
    : soaking
      ? `<strong>Soak initiated</strong> — ${effectName} (${modText})`
      : `<strong>Effect applied</strong> — ${effectName} (${modText})`;

  const content = `
    <div class="sde-chat-note">
      <div class="sde-chat-note-header"><i class="fa-solid fa-shield-halved"></i> ${header}</div>
      <table class="sde-damage-table">
        <tr><th>Target</th><td>${targetName}</td></tr>
        <tr><th>Original</th><td>${rawDamage} dmg → ${origDesc}</td></tr>
        ${applied
          ? `<tr><th>Applied</th><td>${modDamage} dmg → <strong>${modDesc}</strong></td></tr>`
          : `<tr><th>Skipped</th><td>original damage applied (${rawDamage} → ${origDesc})</td></tr>`
        }
      </table>
    </div>`;

  ChatMessage.create({
    content,
    whisper: gmIds,
    speaker: { alias: game.i18n.localize('SDE.ModuleTitle') },
    flags:   { [MODULE_ID]: { type: 'damage-note' } },
  });
}

// ── Dialog ────────────────────────────────────────────────────────────────────

/**
 * Show a DialogV2 asking the GM to choose "Apply Modified" or "Apply Original".
 * Resolves with 'modified', 'original', or null (dismissed).
 *
 * @param {object} opts
 * @returns {Promise<'modified'|'original'|null>}
 */
async function _showPrompt({ effectName, modText, rawDamage, modDamage,
                              origDesc, modDesc, targetName }) {
  try {
    return await foundry.applications.api.DialogV2.wait({
      window:      { title: game.i18n.localize('SDE.Prompt.Title') },
      rejectClose: false,
      content: `
        <div class="sde-damage-prompt">
          <p class="sde-target-name">
            <strong>${game.i18n.format('SDE.Prompt.Applying', { name: targetName })}</strong>
          </p>
          <table class="sde-damage-table">
            <tr>
              <th>${game.i18n.localize('SDE.Prompt.Effect')}</th>
              <td>${effectName} <em>(${modText})</em></td>
            </tr>
            <tr>
              <th>${game.i18n.localize('SDE.Prompt.Original')}</th>
              <td>${rawDamage} dmg → <strong>${origDesc}</strong></td>
            </tr>
            <tr>
              <th>${game.i18n.localize('SDE.Prompt.Modified')}</th>
              <td>${modDamage} dmg → <strong>${modDesc}</strong></td>
            </tr>
          </table>
        </div>`,
      buttons: [
        {
          action:   'modified',
          label:    game.i18n.localize('SDE.Prompt.ApplyModified'),
          icon:     'fa-solid fa-shield-halved',
          callback: () => 'modified',
        },
        {
          action:   'soak_modified',
          label:    game.i18n.localize('SDE.Prompt.SoakModified'),
          icon:     'fa-solid fa-droplet-slash',
          callback: () => 'soak_modified',
        },
        {
          action:   'original',
          label:    game.i18n.localize('SDE.Prompt.ApplyOriginal'),
          icon:     'fa-solid fa-fire',
          callback: () => 'original',
        },
      ],
    });
  } catch {
    return null;
  }
}
