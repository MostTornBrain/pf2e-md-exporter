import "./lib/jszip.min.js";
import { TurndownService } from "./lib/turndown.js";
import { turndownPluginGfm } from "./lib/turndown-plugin-gfm.js";

const MODULE_NAME = "export-markdown";
const FRONTMATTER = "---\n";

const destForImages = "zz_asset-files";

let zip;

class DOCUMENT_ICON {
    // indexed by CONST.DOCUMENT_TYPES
    static table = {
        Actor: "user",
        Cards: "space",
        ChatMessage: "messages-square",
        Combat: "swords",
        Item: "luggage",
        Folder: "folder",
        JournalEntry: "book-open",
        JournalEntryPage: "sticky-note",   // my own addition
        //Macro: "",
        Playlist: "music",
        RollTable: "list",
        Scene: "map"
    };

    //User: ""
    static lookup(document) {
        return DOCUMENT_ICON.table?.[document.documentName] || "file-question";
    }
}

/**
 * 
 * @param {Object} from Either a folder or a Journal, selected from the sidebar
 */

function validFilename(name) {
    const regexp = /[<>:"/\\|?*]/g;
    return name.replaceAll(regexp, '_');
}

function formpath(dir,file) {
    return dir ? (dir + "/" + file) : file;
}

/**
 * Export data content to be saved to a local file
 * @param {string} blob       The Blob of data
 * @param {string} filename   The filename of the resulting download
 */
function saveDataToFile(blob, filename) {
    // Create an element to trigger the download
    let a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = filename;

    // Dispatch a click event to the element
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return new Promise(resolve => setTimeout(() => { window.URL.revokeObjectURL(a.href); resolve()}, 100));
}

function folderpath(journal) {
    let result = "";
    let folder = journal.folder;
    while (folder) {
        const foldername = validFilename(folder.name);
        result = result ? formpath(foldername, result) : foldername;
        folder = folder.folder;
    }
    return result;
}

function fileconvert(str, filename) {
    // See if we can grab the file.
    //console.log(`fileconvert for '${filename}'`);
    if (filename.startsWith("data:image") || filename.startsWith(":")) {
        // e.g.
        // http://URL
        // https://URL
        // data:image;inline binary
        console.log(`Ignoring image file/external URL in '${str}':\n${filename}`);
        return str;
    }
    filename = decodeURIComponent(filename);
    let basefilename = filename.slice(filename.lastIndexOf("/") + 1);

    zip.folder(destForImages).file(basefilename, 
        // Provide a Promise which JSZIP will wait for before saving the file
        fetch(filename).then(resp => {
            if (resp.status !== 200) {
                console.error(`Failed to fetch image from '${filename}' (response ${resp.status})`)
                return new Blob();
            } else {
                console.debug(`Adding image file ${basefilename}`);
                return resp.blob();
            }
        }).catch(e => { 
            console.log(e);
            return new Blob();
        }),
    {binary:true});
    return `![[${basefilename}]]`;
}

function notefilename(doc) {
    let docname;
    if (doc instanceof JournalEntryPage)
        docname = (doc.parent.pages.size === 1) ? doc.parent.name : docname = doc.name;
    else 
        docname = doc.name;
    return validFilename(docname);
}

let turndownService, gfm;

function pathify(id) {
    return id.replaceAll('.','/').replaceAll('|','¬');
}

function convertLinks(markdown, doc) {

    // Needs to be nested so that we have access to 'doc'
    function replaceLink(str, type, id, section, label, offset, string, groups) {

        function dummyLink() {
            // Make sure that "|" in the ID don't start the label early (e.g. @PDF[whatever|page=name]{label})
            return `[[${type}/${pathify(id)}|${label}]]`
        }
        if (id.startsWith("Compendium.") || type === "Compendium") return dummyLink();
    
        let linkdoc = (type === 'UUID') ? fromUuidSync(id, { relative: doc }) : game.journal.get(id);
        if (!linkdoc) return dummyLink();
    
        // A journal with only one page is put into a Note using the name of the Journal, not the only Page.
        let filename = notefilename(linkdoc);
    
        let result = filename;
        // Not a link to a Journal or JournalPage, so just put in the link directly
        if (result.length === 0) return dummyLink();
    
        // FOUNDRY uses slugified section names, rather than the actual text of the HTML header.
        // We need to add an Obsidian block note marker to all section headers to contain that slug.
        if (section && linkdoc instanceof JournalEntryPage) {
            const toc = linkdoc.toc;
            if (toc[section]) 
                result += `#${toc[section].text}`;
        }
        if (label !== filename) result += `|${label}`;
        return `[[${result}]]`;
    }
    
    // Convert all the links
    // Replace Journal Links
    if (markdown.includes('@JournalEntry')) {
        // The square brackets in @JournalEntry will already have been escaped! if text was converted to markdown
        const pattern1 = /@([a-zA-Z]+)\\\[([^\]]*)\\\]{([^\}]*)}/g;
        markdown = markdown.replaceAll(pattern1, replaceLink);
        // Foundry V10 allows markdown, which won't have escaped markers
        const pattern2 = /@([a-zA-Z]+)\[([^\]]*)\]{([^\}]*)}/g;
        markdown = markdown.replaceAll(pattern2, replaceLink);
    }
    // Converted text has the first [ escaped
    if (markdown.includes('@UUID\\[')) {
        // The square brackets in @JournalEntry will already have been escaped!
        const pattern = /@(UUID)\\\[([^#\\]+)(?:#([^\\]+))?\\\](?:{([^}]+)})?/g;
        //cst pattern = /@UUID\\\[([a-zA-Z]*)\.([^\]]*)\\\]{([^\}]*)}/g;
        markdown = markdown.replaceAll(pattern, replaceLink);
    }
    // Converted markdown does NOT include the escape flag
    if (markdown.includes('@UUID[')) {
        const pattern = new RegExp(`@(UUID)\\[([^#\\]]+)(?:#([^\\]]+))?](?:{([^}]+)})?`, "g");
        //const pattern = /@UUID\[([a-zA-Z]*)\.([^\]]*)\]{([^\}]*)}/g;
        markdown = markdown.replaceAll(pattern, replaceLink);
    }
    // Convert other types of links into "undocumented" links, rather than displaying the full raw.
    if (markdown.match(/@[A-Za-z]+\\\[/)) {
        const pattern = /@([A-Za-z]+)\\\[([^#\\]+)(?:#([^\\]+))?\\\](?:{([^}]+)})?/g;
        markdown = markdown.replaceAll(pattern, replaceLink);
    }
    if (markdown.match(/@[A-Za-z]+\[/)) {
        const pattern = new RegExp(`@([A-Za-z]+)\\[([^#\\]]+)(?:#([^\\]]+))?](?:{([^}]+)})?`, "g");
        markdown = markdown.replaceAll(pattern, replaceLink);
    }
    
    // Replace file references
    if (markdown.includes('![](')) {
        //console.log(`File ${item.filename} has images`);
        const filepattern = /!\[\]\(([^)]*)\)/g;
        markdown = markdown.replaceAll(filepattern, fileconvert);
    }

    return markdown;
}

function convertHtml(doc, html) {
    if (!turndownService) {
        // Setup Turndown service to use GFM for tables
        turndownService = new TurndownService({ headingStyle: "atx" });
        gfm = turndownPluginGfm.gfm;
        turndownService.use(gfm);
    }
    let markdown;
    try {
        markdown = turndownService.turndown(html);
    } catch (error) {
        console.warn(`Error: failed to decode html:`, html)
    }

    markdown = convertLinks(markdown, doc);

    return markdown;
}

function frontmatter(doc) {
    return FRONTMATTER + 
        `title: "${doc.name}"\n` + 
        `icon: ${DOCUMENT_ICON.lookup(doc)}\n` +
        `aliases: "${doc.name}"\n` + 
        `foundryId: ${doc.uuid}\n` + 
        FRONTMATTER;
}

function oneJournal(path, journal) {
    let subpath = path;
    if (journal.pages.size > 1) {
        const jnlname = validFilename(journal.name);
        // Put all the notes in a sub-folder
        subpath = formpath(path, jnlname);
        // TOC page 
        // This is a Folder note, so goes INSIDE the folder for this journal entry
        let markdown = "## Table of Contents\n" + frontmatter(journal);
        for (let page of journal.pages) {
            markdown += `\n- [[${validFilename(page.name)}]]`;
        }
        zip.folder(subpath).file(`${jnlname}.md`, markdown, { binary: false });
    }

    for (const page of journal.pages) {
        let markdown;
        switch (page.type) {
            case "text":
                switch (page.text.format) {
                    case 1: // HTML
                        markdown = convertHtml(page, page.text.content);
                        break;
                    case 2: // MARKDOWN
                        markdown = page.text.markdown;
                        break;
                }
                break;
            case "image": case "pdf": case "video":
                if (page.src) markdown = fileconvert(`![](${page.src})`, page.src);
                if (page.image?.caption) markdown += `\n\n${page.image.caption}`;
                break;
        }
        if (markdown) {
            markdown = frontmatter(page) + markdown;
            zip.folder(subpath).file(`${notefilename(page)}.md`, markdown, { binary: false });
        }
    }
}

function oneRollTable(path, table) {
    let markdown = frontmatter(table);
    
    if (table.description) markdown += table.description + "\n\n";

    markdown += 
        `| ${table.formula || Roll} | result |\n` +
        `|------|--------|\n`;

    for (const tableresult of table.results) {
        const range  = (tableresult.range[0] == tableresult.range[1]) ? tableresult.range[0] : `${tableresult.range[0]}-${tableresult.range[1]}`;
        // Escape the "|" in any links
        markdown += `| ${range} | ${convertLinks(tableresult.getChatText(), table).replaceAll("|","\\|")} |\n`;
    }

    // No path for tables
    zip.folder(path).file(`${notefilename(table)}.md`, markdown, { binary: false });
}

function oneDocument(path, doc) {
    if (doc instanceof JournalEntry)
        oneJournal(path, doc);
    else if (doc instanceof RollTable)
        oneRollTable(path, doc);
}

function oneFolder(path, folder) {
    let subpath = formpath(path, validFilename(folder.name));
    for (const journal of folder.contents) {
        oneDocument(subpath, journal);
    }
    for (const childfolder of folder.getSubfolders(/*recursive*/false)) {
        oneFolder(subpath, childfolder);
    }
}

async function onePack(path, pack) {
    let type = pack.metadata.type;
    if (type != 'JournalEntry' && type != 'RollTable') return;
    console.debug(`Collecting pack '${pack.title}'`)
    let subpath = formpath(path, validFilename(pack.title));
    const documents = await pack.getDocuments();
    for (const doc of documents) {
        oneDocument(subpath, doc);
    }
}

async function onePackFolder(path, folder) {
    let subpath = formpath(path, validFilename(folder.name));
    for (const pack of game.packs.filter(pack => pack.folder === folder)) {
        await onePack(subpath, pack);
    }
}

export async function exportMarkdown(from, zipname) {
    let noteid = ui.notifications.info(`${MODULE_NAME}.ProgressNotification`, {permanent: true, localize: true})
    // Wait for the notification to get drawn
    await new Promise(resolve => setTimeout(resolve, 100));

    zip = new JSZip();

    const TOP_PATH = "";

    if (from instanceof JournalEntry) {
        oneJournal(TOP_PATH, from);
    } else if (from instanceof RollTable) {
        oneRollTable(TOP_PATH, from);
    } else if (from instanceof Folder) {
        console.debug(`Processing one Folder`)
        // Do we put in the full hierarchy that might be ABOVE the indicated folder
        if (from.type === "Compendium")
            await onePackFolder(TOP_PATH, from);
        else
            oneFolder(TOP_PATH, from);
    }
    else if (from instanceof DocumentDirectory) {
        for (const doc of from.collection) {
            oneDocument(folderpath(doc), doc);
        }
    } else if (from instanceof CompendiumDirectory) {
        for (const doc of from.collection) {
            await onePack(folderpath(doc), doc);
        }
    } else if (from instanceof CompendiumCollection) {
        await onePack(TOP_PATH, from);
    } else {
        ui.notifications.error(`Invalid object '${from.applicationClass.name}' passed to exportMarkdown`)
        ui.notifications.remove(noteid);
        return;
    }

    let blob = await zip.generateAsync({ type: "blob" });
    await saveDataToFile(blob, `${validFilename(zipname)}.zip`);
    ui.notifications.remove(noteid);
}

Hooks.once('init', async () => {
    // Only available to GMs
    if (!game.user.isGM) return;

    // If not done during "init" hook, then the journal entry context menu doesn't work

    // JOURNAL ENTRY context menu
    function addEntryMenu(wrapped, ...args) {
        return wrapped(...args).concat({
            name: `${MODULE_NAME}.exportToMarkdown`,
            icon: '<i class="fas fa-file-zip"></i>',
            condition: game.user.isGM,
            callback: async header => {
                const li = header.closest(".directory-item");
                const entry = this.collection.get(li.data("entryId"));
                if (!entry) return;
                exportMarkdown(entry, entry.name)
            },
        });
    }
    libWrapper.register(MODULE_NAME, "JournalDirectory.prototype._getEntryContextOptions", addEntryMenu, libWrapper.WRAPPER);
    libWrapper.register(MODULE_NAME, "RollTableDirectory.prototype._getEntryContextOptions", addEntryMenu, libWrapper.WRAPPER);

    function supportedDocType(docname) {
        return docname === 'JournalEntry' || docname === 'RollTable';
    }

    function addCompendiumEntryMenu(wrapped, ...args) {
        return wrapped(...args).concat({
            name: `${MODULE_NAME}.exportToMarkdown`,
            icon: '<i class="fas fa-file-zip"></i>',
            condition: li => game.user.isGM && supportedDocType(game.packs.get(li.data("pack"))?.documentName),
            callback: async li => {
                const pack = game.packs.get(li.data("pack"));
                exportMarkdown(pack, pack.title)
            },
        });
    }
    libWrapper.register(MODULE_NAME, "CompendiumDirectory.prototype._getEntryContextOptions", addCompendiumEntryMenu, libWrapper.WRAPPER);

    // FOLDER context menu: needs 
    function addFolderMenu(wrapped, ...args) {
        return wrapped(...args).concat({
            name: `${MODULE_NAME}.exportToMarkdown`,
            icon: '<i class="fas fa-file-zip"></i>',
            condition: game.user.isGM,
            callback: async header => {
                const li = header.closest(".directory-item")[0];
                const folder = await fromUuid(li.dataset.uuid);
                if (!folder) return;
                exportMarkdown(folder, folder.name)
            },
        });
    }
    libWrapper.register(MODULE_NAME, "JournalDirectory.prototype._getFolderContextOptions", addFolderMenu, libWrapper.WRAPPER);
    libWrapper.register(MODULE_NAME, "RollTableDirectory.prototype._getFolderContextOptions", addFolderMenu, libWrapper.WRAPPER);
    libWrapper.register(MODULE_NAME, "CompendiumDirectory.prototype._getFolderContextOptions", addFolderMenu, libWrapper.WRAPPER);
})

Hooks.on("renderSidebarTab", async (app, html) => {
    if (!game.user.isGM) return;

    if (app instanceof JournalDirectory   ||
        app instanceof RollTableDirectory || 
        app instanceof CompendiumDirectory) {
        const label = game.i18n.localize(`${MODULE_NAME}.exportToMarkdown`);
        let button = $(`<button class='import-cd'><i class='fas fa-file-zip'></i>${label}</button>`)
        button.click(function () {
            exportMarkdown(app, app.constructor.name);
        });

        let anchor = html.find(".directory-footer");
        anchor.append(button);
    }
})