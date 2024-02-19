
# Markdown Exporter, changes for PF2E

# Process Overview

**NOTE** This is a modification of the [Markdown Exporter](https://github.com/farling42/fvtt-export-markdown) module so it produces more usable Pathfinder 2E Remaster content in markdown format for Obisidian.

Detailed instructions are in the next section.  What follows here is a quick overview of the process:

First, install this module in your Foundry world.

When exporting the Pathfinder compendium, use the included `handlebars/spell_handlebar.hbs` for Spells, `monster_handlebar.hbs` as the general handlebar for Actors, `hazard_handlebar.hbs` as the handlebar for Hazard actors, and `generic_handlebar.hbs` for generic items.  These handlebars will already be selected by default, but you can override them in the settings if you have your own custom handlebars.

Included in this project is a new file `pf2e-spell.css` which is an 
Obsidian CSS snippet which can be installed in your `.obsidian/snippets` directory so the spells resemble the new style used in the Player Core and GM Core books.

# Detailed Installation Instructions

This process requires you have a Foundry account with a World with the **Pathfinder Second Edition** package selected as the Game System.
![Game System](Screenshots/GameSystem.png)

## 1. Install the following required modules:
* libWrapper
* PF2E Exporter
* More Handlebars Helpers

## 2. Enable modules
Launch your world in Foundry, and log in as the Gamemaster account.   If you already had your world running when you performed the above steps, you will need to log out and log back in as Gamemaster for the changes to take effect.

Choose `Manage Modules` in your logged into Foundry world.  Enable these three modules you installed in step 1. 
![Required Modules](Screenshots/RequiredModules.png)

## 3. Configure Markdown Exporter
Choose `Configure Settings` and pick Markdown Exporter. Ensure the following options are checked.   _NOTE:_ It is recommended to **NOT** use the UUID of each document as the note name as doing so will populate your vault with a lot of random file names.
![Markdown Exporter](Screenshots/MarkdownExporterSettings.png)

Click on `Save Changes`.

## 4. Export the Compendium
You are now ready to export any items from your world, including Pathfinder Compendium items.  If you want to do a quick test, choose to view a monster or spell, then choose to "import" it into your saved items.   Then, right click on that item and choose the last option in the pop-up menu named `Export to Markdown`. If everything is installed correctly, you should see a pop-up message saying it is exporting the data and then a file will be saved named after the item. If the file has multiple items associated with it will be created as a `.zip` file.

If you want to export the whole Compendium, you can go to the compendium menu and at the bottom of the screen choose `Export to Markdown`.  This will take several minutes.  If you'd like to see progress as you wait, you can open the browser debug window and the console will show messages of the items it is exporting.

![Compendium](Screenshots/Compendium.png)

## 6. Customize your Vault
The exported data requires a few extra plugins in Obsidian to be viewed in the best format.
### Install and enable the following plugins. 
* Fantasy Statblocks
* Pathfinder 2E Action Icons

For the Fantasy Statblocks, you can go into its settings and disable the built-in D&D 5e SRD monsters if you aren't using D&D.

![FantasyStatblocks](Screenshots/FantasyStatblocksPlugin.png)

### Install ITS
It is also recommended to install the ITS Theme so the spells look their best. Choose Obsidian Settings, `Appearance` and in the `Themes` section pick manage, search for ITS and install and use it.

![ITS](Screenshots/InstallITS.png)

### Install custom snippet
In addition, copy the `pf2e-spell.css` from this github project into your `.obsidian/snippets` folder.  (If you don't already have a snippets folder, you will need to create it.)   After you copy the snippet file, go into the Obsidian settings, choose `Appearance` and scroll down to the `Snippets` section and enable this `pf2e-spell.css` snippet.

![Snippet](Screenshots/EnableSnippet.png)

### Unzip the exported Compendium and add it to your vault.
You can install the compendium in any sub-folder in your vault.  The links it uses between items only reference the direct unique filenames without paths, so you should be able to even re-organize the directories however you might prefer.

### Reload Obsisian for plugin and CSS changes to take effect
At this point, it is recommended to reload Obsidian to ensure all the plugins and theme changes take effect, although it may not be 100% necessary in all cases.
![Reload](Screenshots/ReloadApp.png)

## Enjoy!
At this point, you should have a vault with the compendium fully linked files.  Monsters should look like this:

![GoblinPyro](Screenshots/GoblinPyro.png)

And spells should look like this:

![Aberrant Form](Screenshots/AberrantForm.png)

# TODO

## Currently in process:
* spot checking the data for Spells, Monsters, and Hazards comparing to the published PDFs to ensure the handlebars are not missing important data for the export.

## Future:
Convert the rest of the document types, such as Glossary, Actions, equipment (to include cost, weight, etc.).
