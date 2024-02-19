import * as MOD_CONFIG from "./config.js"
import { convertHtml } from './export-markdown.js';

/*
 * MODULE OPTIONS
 */

Hooks.once('ready', () => {
    game.settings.register(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_DUMP, {
		name: "Format for non-decoded data",
		hint: "For document types not otherwise decoded, use this format for the data dump.",
		scope: "world",
		type:  String,
		choices: { 
            "YAML": "YAML",
            "JSON": "JSON"
        },
		default: "YAML",
		config: true,
	});

    game.settings.register(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_LEAFLET, {
		name: "Format Scenes for Leaflet plugin",
		hint: "Create Notes in a format suitable for use with Obsidian's Leaflet plugin",
		scope: "world",
		type:  Boolean,
		default: true,
		config: true,
	});

    game.settings.register(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_FOLDER_AS_UUID, {
		name: "JournalEntry folders use UUID instead of Journal name",
		hint: "When checked, Journals will be placed into a folder based on the UUID of the JournalEntry (if unchecked, the folder will be the Journal's name, but links to that journal will not work)",
		scope: "world",
		type:  Boolean,
		default: true,
		config: true,
	});

    game.settings.register(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_NOTENAME_IS_UUID, {
		name: "Use UUID of each document as the Note name",
		hint: "When checked, the created notes will have a name that matches the UUID of the document allowing for easy unique linking from other documents (when unchecked, the notes will use the name of the document, which might not be unique for linking purposes)",
		scope: "world",
		type:  Boolean,
		default: true,
		config: true,
	});

    // Allow handlebars template to be specified for Actors and Items
    game.settings.register(MOD_CONFIG.MODULE_NAME, `template.Actor`, {
        name: "Actor (generic)",
        hint: "Choose a handlebars template file to be used if a template isn't specified for a specific type of actor",
        scope: "world",
        type:  String,
        default: "",
        config: true,
        filePicker: "text"
    })

    for (const type of game.template.Actor.types) {
        const label = CONFIG.Actor.typeLabels[type];
        const actorname = game.i18n.has(label) ? game.i18n.localize(label) : type;
        game.settings.register(MOD_CONFIG.MODULE_NAME, `template.Actor.${type}`, {
            name: game.i18n.format(`${MOD_CONFIG.MODULE_NAME}.actorTemplate.Name`, {name: actorname}),
            hint: game.i18n.format(`${MOD_CONFIG.MODULE_NAME}.actorTemplate.Hint`, {name: actorname}),
            scope: "world",
            type:  String,
            default: "",
            config: true,
            filePicker: "text"
        })
    }

    // Global Item
    game.settings.register(MOD_CONFIG.MODULE_NAME, `template.Item`, {
        name: "Item (generic)",
        hint: "Choose a handlebars template file to be used if a template isn't specified for a specific type of Item",
        scope: "world",
        type:  String,
        default: "",
        config: true,
        filePicker: "text"
    })

    for (const type of game.template.Item.types) {
        const label = CONFIG.Item.typeLabels[type];
        const itemname = game.i18n.has(label) ? game.i18n.localize(label) : type;
        game.settings.register(MOD_CONFIG.MODULE_NAME, `template.Item.${type}`, {
		    name: game.i18n.format(`${MOD_CONFIG.MODULE_NAME}.itemTemplate.Name`, {name: itemname}),
		    hint: game.i18n.format(`${MOD_CONFIG.MODULE_NAME}.itemTemplate.Hint`, {name: itemname}),
		    scope: "world",
		    type:  String,
		    default: "",
            config: true,
            filePicker: "text"
        })
    }
    
  Handlebars.registerHelper('me-trait', function (value) {
    // Convert a sluggified trait into its localized human-readable text
    let lookUpText = CONFIG.PF2E.npcAttackTraits[value];
    if (lookUpText) {
      return game.i18n.localize(lookUpText)
    } else {
      return value;
    }
  });

  Handlebars.registerHelper('me-spellLevels', function (items, id, spellType) {
    // Return the high-to-low sorted list of spell levels for the given spellCastingAbility ID.
    // If cantrips = true, return the list of cantrip levels, otherwise return the list
    // of non-cantrip levels.
    let item;
    let level_list = {};
    if (items) {
      for (item of items) {
        if (item.type === 'spell' && item.system.location.value == id) {
          const level = item.system.location.heightenedLevel || item.level || item.system.level.value;
          if (spellType == 'cantrips') {
            if (item.isCantrip) {
              level_list[level] = true;
            }
          } else {
            if (!(item.isCantrip)) {
              if (spellType == 'constant' && item.name.includes('(Constant)')){
                level_list[level] = true;
              } else if (spellType == 'spells' && !(item.name.includes('(Constant)'))){
                level_list[level] = true;
              }
            }
          }
        }
      }
    }
    const keys = Object.keys(level_list);
    var collator = new Intl.Collator([], {numeric: true});
    keys.sort((a, b) => collator.compare(b, a));
    return keys;
  });

  Handlebars.registerHelper('me-getSpellSlotCount', function (item, level) {
    // Return the the spell slot count for the given level in the 
    // form "(# slots) if it is non-zero.

    const slotKey = "slot" + String(level);
    let value = "";
    if (item.system.slots[slotKey]) {
      if (item.system.slots[slotKey].value != 0) {
        value = "(" + String(item.system.slots[slotKey].value) + " slots)";
      }
    }
    return value;
  });

  Handlebars.registerHelper('me-equipmentList', function (items) {
    // Return the list of items with the system.equipped property present.
    let equipmentList = [];
    for (const item of items) {
      if (item.system.equipped) {
        let quantity = item.system.quantity ? item.system.quantity : 1;

        let linkName = item?.flags?.core?.sourceId;
        if (!linkName) {
          linkName = item.name;
        } else {
          linkName = `[[${item.flags.core.sourceId}|${item.name}]]`;
        }

        // If quantity is 1, don't show it.
        if (quantity > 1) {
          linkName = `${quantity}x ${linkName}`;
        }        
        equipmentList.push(linkName);
      }
    }
    return equipmentList;
  });

  Handlebars.registerHelper('me-getRituals', function (items, ) {
    // Return the list of ritual spells.
    let item;
    let spell_list = [];
    if (items) {
      for (const item of items) {
        if (item.isRitual) {
          spell_list.push(item);
        }
      }
    }

    // We now have a list of rituals, as their full JSON item. 
    // Alphabetize the list based on name.
    spell_list.sort((a, b) => a.name.localeCompare(b.name));

    let spell_names = [];
    for (const spell of spell_list) {
      if (spell?.flags?.core?.sourceId) {
        // Revise the ritual names so they are links to the referenced spells.
        const fullName = `[[${spell.flags.core.sourceId}|${spell.name}]]`;
        spell_names.push(fullName);
      } else {
        spell_names.push(spell.name);
      }
    }
    
    return spell_names;
  });

  Handlebars.registerHelper('me-getSpellList', function (items, id, level, spellType) {
    // Return the list of spells for a level for the given spellCastingAbility ID.
    // If cantrips = true, return the list of cantrip spells, otherwise return the list
    // of non-cantrip spells.
    let item;
    let spell_list = [];
    if (items) {
      for (const item of items) {
        if (item.type === 'spell' && item.system.location.value == id) {
          const spell_level = item.system.location.heightenedLevel || item.level || item.system.level.value;
          if (level == spell_level) {
            if (spellType == 'cantrips') {
              if (item.isCantrip) {
                spell_list.push(item);
              }
            } else {
              if (!(item.isCantrip)) {
                if (spellType == 'constant' && item.name.includes('(Constant)')){
                  spell_list.push(item);
                } else if (spellType == 'spells' && !(item.name.includes('(Constant)'))){
                  spell_list.push(item);
                }
              }
            }
          }
        }
      }
    }

    // We now have a list of spells, as their full JSON item. 
    // Alphabetize the list based on name.
    spell_list.sort((a, b) => a.name.localeCompare(b.name));

    let spell_names = [];
    for (const spell of spell_list) {
      // We don't want the 'constant' label on spells.
      let newName = spell.name.replace(' (Constant)', '');

      // Append the number of uses to the spell name if it exists.
      const uses = spell.system?.location?.uses?.value;

      if (uses && uses > 1) {
        newName = newName + ` (x${uses})`;
      }
      
      // Revise the spell names so they are links to the referenced spells.
      const fullName = `[[${spell.flags.core.sourceId}|${newName}]]`;
      spell_names.push(fullName);
    }
    
    return spell_names;
  });

  Handlebars.registerHelper('me-HTMLtoYAML', function (text, context, options) {
    if (text) {

      // First, check if this item is a reference to another entry. 
      // If it is, remove any localize tags as it is redundent text
      // from the reference.
      if (context?.flags?.core?.sourceId) {
        const localizePattern = /@(Localize)\[([^#\]]+)(?:#([^\]]+))?](?:{([^}]+)})?/g;
        text = text.replace(localizePattern, '');
      }

      text = convertHtml(context, text)
        .replaceAll('\n', '\\n')       // Replace all \n with "\\n" so YAML in the Statblock doesn't break.
        .replaceAll('\\n* * *', '\\n') // Replace Markdown "* * *" HR.  It will not work there.
        .replace(/(\\n)\1+/g, '\\n')   // Compress repeated newlines into a single one.
        .replaceAll('"', '\\"')        // Escape all double quotes.
        .replace(/^\w+$/g, '');        // If we end up with only whitespace, return ''

    }
    return text;
  });

  Handlebars.registerHelper('me-HTMLtoMarkdown', function (text, context) {
     if (text) {
      text = convertHtml(context, text);
    }
    return text;
  });

  Handlebars.registerHelper('me-debugDumpObject', function (msg, options) {
    // Simple debug console dump of the current object being used by the handlebar. 
    // This is much better than the text file JSON dump you can get from Foundry 
    // as the debug console view lets you drill down and see normally hidden items 
    // that can still be referenced via the handlebar.
    console.log(msg, options);
  });


    // End of Hooks Once Ready
})

// Add headers for the Actor and Item settings
Hooks.on('renderSettingsConfig', (app, html, options) => {

    const actorModuleTab = $(app.form).find(`.tab[data-tab=${MOD_CONFIG.MODULE_NAME}]`);
    actorModuleTab
      .find(`input[name=${MOD_CONFIG.MODULE_NAME}\\.template\\.Actor]`)
      .closest('div.form-group')
      .before(
        '<h2 class="setting-header">' +
          game.i18n.localize(`${MOD_CONFIG.MODULE_NAME}.titleActorTemplates`) +
          '</h2>'
      )      

    const itemModuleTab = $(app.form).find(`.tab[data-tab=${MOD_CONFIG.MODULE_NAME}]`);
    itemModuleTab
      .find(`input[name=${MOD_CONFIG.MODULE_NAME}\\.template\\.Item]`)
      .closest('div.form-group')
      .before(
        '<h2 class="setting-header">' +
          game.i18n.localize(`${MOD_CONFIG.MODULE_NAME}.titleItemTemplates`) +
          '</h2>'          
      )

})