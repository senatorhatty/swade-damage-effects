/**
 * keywords.js
 * Shared utilities for parsing, normalising, and matching damage keywords.
 *
 * Keyword string format (same on items AND on effect conditions):
 *
 *   "fire"               – matches when damage has the 'fire' keyword
 *   "fire | cold"        – matches when damage has 'fire' OR 'cold'
 *   "fire cold"          – matches when damage has BOTH 'fire' AND 'cold'
 *   "!silver"            – matches when damage does NOT have 'silver'
 *   "fire | cold !magic" – matches (fire OR cold) AND (NOT magic)
 *
 * Multiple space-separated tokens = AND logic.
 * Pipe-separated tokens within one "word" = OR logic.
 * Leading ! = negation.
 *
 * Examples:
 *   Weapon keywords: "fire, magical"      → item has both fire and magical
 *   Effect condition: "fire | cold"        → resist fire or cold
 *   Effect condition: "!silver"            → immune to everything that isn't silver
 */

/**
 * Parse a comma-separated keyword string from an Item into a flat normalised array.
 * "Fire, Magical, " → ["fire", "magical"]
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parseItemKeywords(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0);
}

/**
 * Parse an effect condition keyword string into a structured token array.
 * Each token is either a literal string or a { negate: true, term: string }.
 * Space separation → AND; pipe separation within a word → OR group.
 *
 * @param {string} raw  e.g. "fire | cold !magic"
 * @returns {Array<string|string[]|{negate:boolean,terms:string[]}>}
 *   Each element of the outer array must be satisfied (AND).
 *   An inner string[] is an OR group.
 *   {negate, terms} means NOT (any of terms).
 */
export function parseEffectKeywords(raw) {
  if (!raw || !raw.trim()) return []; // empty = match everything

  return raw.trim().split(/\s+/).map(token => {
    const negated = token.startsWith('!');
    const clean = negated ? token.slice(1) : token;
    const terms = clean.split('|').map(t => t.trim().toLowerCase()).filter(Boolean);
    return { negate: negated, terms };
  });
}

/**
 * Test whether a set of incoming weapon keywords satisfies an effect's condition.
 *
 * @param {string[]} weaponKeywords   Normalised keywords from the weapon/power.
 * @param {string}   effectCondition  The effect's raw keyword condition string.
 * @returns {boolean}
 */
export function conditionMatches(weaponKeywords, effectCondition) {
  const tokens = parseEffectKeywords(effectCondition);

  // Empty condition → matches all damage (no keyword restriction).
  if (tokens.length === 0) return true;

  const wkSet = new Set(weaponKeywords);

  for (const { negate, terms } of tokens) {
    // OR group: at least one term must match (or not match, if negated).
    const anyMatch = terms.some(t => wkSet.has(t));
    if (negate && anyMatch) return false;   // !keyword present → no match
    if (!negate && !anyMatch) return false; // keyword absent → no match
  }

  return true;
}

/**
 * Given a raw damage value and a matching effect, compute the modified damage.
 * Clamps to 0.
 *
 * @param {number} damage
 * @param {{operator: string, value: number}} effect
 * @returns {number}
 */
export function applyModifier(damage, { operator, value }) {
  let result;
  if (operator === 'multiply') {
    result = damage * value;
  } else { // 'add'
    result = damage + value;
  }
  return Math.max(0, result);
}

/**
 * From all matching effects on an actor, return the one that produces
 * the least damage (best for the target). Returns null if none match.
 *
 * @param {number}   damage          The raw damage value.
 * @param {string[]} weaponKeywords  Normalised keywords from the weapon.
 * @param {Actor}    actor           The target actor.
 * @returns {{ effect: ActiveEffect, result: number }|null}
 */
export function resolveBestEffect(damage, weaponKeywords, actor) {
  const MODULE_ID = 'swade-damage-effects';
  let best = null;

  // allApplicableEffects() yields both actor-own effects AND item-transferred
  // effects (transfer:true on items). In Foundry v14, actor.effects only
  // contains the actor's own embedded documents — item effects are not cloned.
  for (const effect of actor.allApplicableEffects()) {
    if (effect.disabled) continue;

    const flags = effect.flags?.[MODULE_ID];
    if (!flags?.enabled) continue;

    const { condition = '', operator = 'multiply', value = 1 } = flags;

    if (!conditionMatches(weaponKeywords, condition)) continue;

    const result = applyModifier(damage, { operator, value: Number(value) });

    if (best === null || result < best.result) {
      best = { effect, result, operator, value: Number(value), condition };
    }
  }

  return best;
}
