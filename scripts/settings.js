const MODULE_ID = 'swade-damage-effects';

export function registerSettings() {
  game.settings.register(MODULE_ID, 'promptMode', {
    name: 'SDE.Settings.PromptMode.Name',
    hint: 'SDE.Settings.PromptMode.Hint',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      auto:   'SDE.Settings.PromptMode.Auto',
      manual: 'SDE.Settings.PromptMode.Manual',
    },
    default: 'auto',
  });

  game.settings.register(MODULE_ID, 'playerVisible', {
    name: 'SDE.Settings.PlayerVisible.Name',
    hint: 'SDE.Settings.PlayerVisible.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
}

export function getSetting(key) {
  return game.settings.get('swade-damage-effects', key);
}
