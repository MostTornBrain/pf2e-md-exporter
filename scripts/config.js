export const MODULE_NAME = "pf2e-md-exporter";
export const OPTION_DUMP = "dataType";
export const OPTION_LEAFLET = "leaflet";
export const OPTION_FOLDER_AS_UUID = "folderIsUuid";
export const OPTION_NOTENAME_IS_UUID = "notenameIsUuid";
export const OPTION_EXPORT_TOKENS = "exportTokens";
export const OPTION_INCLUDE_INITIATIVE = "includeInitiative";
export const OPTION_EXPORT_TRAITS = "exportTraits";
export const OPTION_USE_PF2E_ACTION_ICONS_PLUGIN = "usePf2eActionsPluginIconFormat";

export function actionIcon(icon, settings) {
  if (!icon) return "";
  const usePluginIcons = settings.get(MODULE_NAME, OPTION_USE_PF2E_ACTION_ICONS_PLUGIN)
  switch (icon.toString().toLowerCase()) {
    // One action - some Foundry entries use 1 (such as most spells), others use 'a'
    case "a":  // used in some Foundry entries
    case "1":
      return usePluginIcons ? "`pf2:1`" : "⬻";
    // Two actions
    case "2":
      return usePluginIcons ? "`pf2:2`" : "⬺";
    // Three actions
    case "3":
      return usePluginIcons ? "`pf2:3`" : "⬽";
    // Free Action
    case "free":
    case "f":
    case "0":
      return usePluginIcons ? "`pf2:0`" : "⭓";
    // Reaction
    case "reaction":
    case "r":
      return usePluginIcons ? "`pf2:r`" : "⬲";
    // 1 to 3 actions
    case "1 to 3":
      return actionIcon("1", settings) + " to " + actionIcon("3", settings);
    // 2 to 3 actions
    case "2 to 3":
      return actionIcon("2", settings) + " to " + actionIcon("3", settings);
    // 1 to 2 actions
    case "1 to 2":
      return actionIcon("1", settings) + " to " + actionIcon("2", settings);
  }
  return "";
}
