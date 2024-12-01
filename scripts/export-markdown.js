import "./lib/jszip.min.js";
import { TurndownService } from "./lib/turndown.js";
import { TurndownPluginGfmService } from "./lib/turndown-plugin-gfm.js";
import "./lib/js-yaml.min.js";
import replaceAsync from "./lib/string-replace-async.js";
import * as MOD_CONFIG from "./config.js";
import { myRenderTemplate, clearTemplateCache } from "./render-template.js"

const MODULE_NAME = "pf2e-md-exporter";
const FRONTMATTER = "---\n";
const EOL = "\n";
const MARKER = "```";

// These conditions all have a numeric level and they get created with a file name with a 1 appended to the end.
const SPECIAL_CONDITIONS = ["Clumsy", "Doomed", "Drained", "Dying", "Enfeebled", "Frightened", "Sickened", "Slowed", "Stunned", "Stupefied", "Wounded"];

const destForImages = "zz_asset-files";

let zip;



const IMG_SIZE = "150";

let use_uuid_for_journal_folder=true;
let use_uuid_for_notename=true;
let export_tokens = false;
let include_initiative_tracker = false;
let export_traits = false;

class DOCUMENT_ICON {
    // indexed by CONST.DOCUMENT_TYPES
    static table = {
        Actor: ":user:",
        Cards: ":spade:",
        ChatMessage: ":messages-square:",
        Combat: ":swords:",
        Item: ":luggage:",
        Folder: ":folder:",
        JournalEntry: ":book:",
        JournalEntryPage: ":sticky-note:",   // my own addition
        //Macro: "",
        Playlist: ":music:",
        RollTable: ":list:",
        Scene: ":map:"
    };

    //User: ""
    static lookup(document) {
        return DOCUMENT_ICON.table?.[document.documentName] || ":file-question:";
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

function docfilename(doc) {
    return use_uuid_for_notename ? doc.uuid : validFilename(doc.name);
}

function zipfilename(doc) {
    return `${docfilename(doc)}.md`;
}

function formpath(dir,file) {
    return dir ? (dir + "/" + file) : file;
}

function templateFile(doc) {
    // Look for a specific template, otherwise use the generic template
    let base = (doc instanceof Actor) ? "Actor" : (doc instanceof Item) ? "Item" : undefined;
    if (!base) return undefined;
    return game.settings.get(MODULE_NAME, `template.${base}.${doc.type}`) || game.settings.get(MODULE_NAME, `template.${base}`);
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

function folderpath(doc) {
    let result = "";
    let folder = doc.folder;
    while (folder) {
        const foldername = validFilename(folder.name);
        result = result ? formpath(foldername, result) : foldername;
        folder = folder.folder;
    }
    return result;
}

function formatLink(link, label=null, inline=false) {
    let body = link;
    if (label && label != link) body += `|${label}`;
    let result = `[[${body}]]`;
    if (inline) result = "!" + result;
    result = result.replaceAll("\\_", "_");
    return result;
}

function fileconvert(filename, label_or_size=null, inline=true) {
    filename = decodeURIComponent(filename);

    zip.folder(destForImages).file(filename, 
        // Provide a Promise which JSZIP will wait for before saving the file.
        // (Note that a CORS request will fail at this point.)
        fetch(filename).then(resp => {
            if (resp.status !== 200) {
                console.error(`Failed to fetch file from '${filename}' (response ${resp.status})`)
                return new Blob();
            } else {
                console.debug(`Adding file ${filename}`);
                return resp.blob();
            }
        }).catch(e => { 
            console.log(e);
            return new Blob();
        }),
    {binary:true});

    return formatLink(filename, label_or_size, inline);
}

function replaceLinkedFile(str, label, filename) {
    // For use by String().replaceAll,
    // Ensure we DON'T set the third parameter from a markdown link
    // See if we can grab the file.
    //console.log(`fileconvert for '${filename}'`);
    if (filename.startsWith("data:image") || filename.startsWith(":")) {
        // e.g.
        // http://URL
        // https://URL
        // data:image;inline binary
        console.log(`Ignoring file/external URL in '${str}':\n${filename}`);
        return str;
    }
    return fileconvert(filename, label);
}

function notefilename(doc) {
    return docfilename((doc instanceof JournalEntryPage && doc.parent.pages.size === 1) ? doc.parent : doc);
}

let turndownService, gfm;

function expandOneLocalize(str, type, target, hash, label, offset, string, groups) {
    if (type == "Localize"){
        return game.i18n.localize(target);
    } else {
        return str;
    }
}

function dummyLink(target, label) {
    // Make sure that "|" in the ID don't start the label early (e.g. @PDF[whatever|page=name]{label})
    return formatLink(target, label);
}

function uuidFailSafe(target, label) {
    //console.debug("Considering:", target);
    if (/[/]/.test(target)) {
        //console.debug("Target contains slashes - not a UUID. Skipping.");
    } else if (!use_uuid_for_notename) {
        // Foundry's fromUuidSync() will thrown an error if the UUID 
        // document is only available via an async operation.
        // We can't resolve async function calls via a handlebar, so let's try another approach...
        
        // I discovered this function mentioned in foundry.js:
        // let {collection, documentId, documentType, embedded, doc} = foundry.utils.parseUuid(target);

        try {
            // Get the UUID parts for the target - that can always be done synchronously.
            let uuidParts = foundry.utils.parseUuid(target);

            // Using the UUID parts information from the target, get the UUID of the target's parent
            let parentUuid = uuidParts.collection.getUuid(uuidParts.documentId);
            
            // Now that we have the parent's UUID, get it in document form.
            // In testing, it appears the parent can be fetched via a synchronoous operation, which is what we need.
            let parentDoc = fromUuidSync(parentUuid);

            if (parentDoc) {
                // Lookup the friendly name of the path, so we can use it as a prefix for the link to make it more unique.
                let pack = game.packs.get(parentDoc.pack);
                if (pack) {
                    // Slashes in the title aren't real paths and as part of the export become underscores
                    let fixed_title = pack.title.replaceAll('/', '_');
                    let doc_name = label.replaceAll('/', '_');
                    let result = `${fixed_title}/${parentDoc.name}/${doc_name}`;
                    //console.log("Resolved URL:", result);
                    return formatLink(result, label, /*inline*/false);
                }
            }
        } catch (error) {
            // If we caught an error from the UUID lookup, just fall through and use the raw link.
            // console.log("Welp...");
        }
        console.log("Ooops.... we fell through.  Unresolved URL: ", target, ":", label);
    }
    return dummyLink(target, label);
}

// Unfortunately, we need two "convertLinks" functions, one Async and one Sync.
// In order to process @Embed tags properly where we pull in the text from the 
// @Embed referenced document, we need to perform this asynchronously as embedded
// documents in PF2E are only available via async APIs. 
// But, handlebars are always synchronous, hence the need for a second implementation.
async function convertLinksAsync(markdown, doc) {

    async function getDocumentDescription(target) {
        const uuid = await fromUuid(target);
        return uuid.system.description.value;
    }

    // Needs to be nested so that we have access to 'doc'
    async function replaceOneLink(str, type, target, hash, label, offset, string, groups) {

        // Some Foundry modules introduced adding "inline" to the start of type.
        let inline = type.startsWith("inline");
        if (inline) type = type.slice("inline".length);
        // Maybe handle `@PDF` links properly too

        // Ignore link if it isn't one that we can parse.
        const documentTypes = new Set(CONST.DOCUMENT_LINK_TYPES.concat(["Compendium", "UUID", "Embed"]));
        if (!documentTypes.has(type)) {
            console.log("Unhandled link type of: ", type, str);
            return str;
        }

        // Ensure the target is in a UUID or Embed format.
        if (type !== "UUID" && type != "Embed") {
            // console.log("Not a UUID nor an Embed:", type, target);
            target = `${type}.${target}`
        }

        // Omit the trailing " inline..." stuff and just get the Embedded UUID path
        if (type == "Embed") {
            //console.log("target: ", target);
            const compendiumPath = target.split(" inline")[0];
            if (compendiumPath) {
                //console.log("Embed compendium:", compendiumPath);
                target = compendiumPath;
            }
        }
        // If the UUID is a "relative path" UUID, get the parent UUID path of the existing doc and than append this UUID to it.
        if (target.startsWith('.')) {
            const lastIndex = doc.uuid.lastIndexOf('.');
            let parentUUID = doc.uuid;  // If we don't get a match (which is unlikely to happen), use the current UUID as the parent as a last resort
            if (lastIndex !== -1) {
                parentUUID = doc.uuid.substring(0, lastIndex);
            } 
            target = parentUUID + target;
        }

        let linkdoc;
        try {
            //if (!label && !hash) label = doc.name;
            linkdoc = fromUuidSync(target);
            //console.log("Tried fromUuidSync:", target);
        } catch (error) {
            //console.log(`Unable to fetch label from Compendium for ${target}:${label}`, error);
            return uuidFailSafe(target, label);
        }

        if (!linkdoc) return dummyLink();

        // Embeded tags need to be expanded inside the note.  
        // Grab the text description and return it instead of returning a link.
        if (type == "Embed") {
            // Use the async function to get the resolved value
            const description = await getDocumentDescription(target);
        
            if (!description) {
                console.log("Failed to fetch embedded doc: ", target);
            }

            // Now you can use the resolved description
            const taggedDesc = convertPF2ETags(doc, description);
            const newDesc = convertLinks(taggedDesc, doc);
            //console.log("NewDesc:", newDesc);
            return newDesc;        
        }

        // A journal with only one page is put into a Note using the name of the Journal, not the only Page.
        let filename = notefilename(linkdoc);
    
        // FOUNDRY uses slugified section names, rather than the actual text of the HTML header.
        // So we need to look up the slug in the Journal Page's TOC.
        let result = filename;
        if (hash && linkdoc instanceof JournalEntryPage) {
            const toc = linkdoc.toc;
            if (toc[hash]) {
                result += `#${toc[hash].text}`;
                if (!label) label = toc[hash].text;
            }
        }

        // If the target has a slash in the name, change it to an underscore since it isn't a real path.
        result = result.replaceAll('/', '_');

        if (!use_uuid_for_notename) {
            /* This appears to no longer be the case - the files don't have a 1 appended.
            // Append a 1 to the condition since the filename will have a 1 appended to it.
            if (SPECIAL_CONDITIONS.includes(result)) {
                result = `${result} 1`;
            }
            */

            if (linkdoc) {
                // Lookup the friendly name of the path, so we can use it as a prefix for the link to make it more unique.
                let pack = game.packs.get(linkdoc.pack);
                if (pack) {
                    // Slashes in the title aren't real paths and as part of the export become underscores
                    let fixed_title = pack.title.replaceAll('/', '_');
                    result = `${fixed_title}/${result}`;
                }
            }
        }
        //console.log("Format Link: ", result, "label:", label);
        return formatLink(result, label, /*inline*/false);  // TODO: maybe pass inline if we really want inline inclusion
    }

    async function replaceAllLinks(markdown) {
        // Convert all the links
        const pattern = /@([A-Za-z]+)\[([^#\]]+)(?:#([^\]]+))?](?:{([^}]+)})?/g;

        // Find all matches
        const matches = [...markdown.matchAll(pattern)];

        // Replace each match asynchronously
        for (const match of matches) {
            const [fullMatch, type, link, hash, label] = match;
            const replacement = await replaceOneLink(fullMatch, type, link, hash, label);
            markdown = markdown.replace(fullMatch, replacement);
        }
        return markdown
    }

    // First, localize any @Localize tags - as these might end up containing links, which need to get handled in the next step.
    const localizePattern = /@(Localize)\[([^#\]]+)(?:#([^\]]+))?](?:{([^}]+)})?/g;
    markdown = markdown.replace(localizePattern, expandOneLocalize);
 
    markdown = await replaceAllLinks(markdown);
    
    // Replace file references (TBD AFTER HTML conversion)
    const filepattern = /!\[([^\]]*)\]\(([^)]*)\)/g;
    markdown = markdown.replaceAll(filepattern, replaceLinkedFile);

    return markdown;
}

function convertLinks(markdown, doc) {

    // Needs to be nested so that we have access to 'doc'
    function replaceOneLink(str, type, target, hash, label, offset, string, groups) {

        // Some Foundry modules introduced adding "inline" to the start of type.
        let inline = type.startsWith("inline");
        if (inline) type = type.slice("inline".length);
        // Maybe handle `@PDF` links properly too

        // Ignore link if it isn't one that we can parse.
        const documentTypes = new Set(CONST.DOCUMENT_LINK_TYPES.concat(["Compendium", "UUID", "Embed"]));
        if (!documentTypes.has(type)) {
            console.log("Unhandled link type of: ", type, str);
            return str;
        }

        // Ensure the target is in a UUID or Embed format.
        if (type !== "UUID" && type != "Embed") {
            // console.log("Not a UUID nor an Embed:", type, target);
            target = `${type}.${target}`
        }

        // Omit the trailing " inline..." stuff and just get the Embedded UUID path
        if (type == "Embed") {
            //console.log("target: ", target);
            const compendiumPath = target.split(" inline")[0];
            if (compendiumPath) {
                //console.log("Embed compendium:", compendiumPath);
                target = compendiumPath;
            }
        }
        // If the UUID is a "relative path" UUID, get the parent UUID path of the existing doc and than append this UUID to it.
        if (target.startsWith('.')) {
            const lastIndex = doc.uuid.lastIndexOf('.');
            let parentUUID = doc.uuid;  // If we don't get a match (which is unlikely to happen), use the current UUID as the parent as a last resort
            if (lastIndex !== -1) {
                parentUUID = doc.uuid.substring(0, lastIndex);
            } 
            target = parentUUID + target;
        }

        let linkdoc;
        try {
            //if (!label && !hash) label = doc.name;
            linkdoc = fromUuidSync(target);
            //console.log("Tried fromUuidSync:", target);
        } catch (error) {
            //console.log(`Unable to fetch label from Compendium for ${target}:${label}`, error);
            return uuidFailSafe(target, label);
        }

        if (!linkdoc) return dummyLink();

        // A journal with only one page is put into a Note using the name of the Journal, not the only Page.
        let filename = notefilename(linkdoc);
    
        // FOUNDRY uses slugified section names, rather than the actual text of the HTML header.
        // So we need to look up the slug in the Journal Page's TOC.
        let result = filename;
        if (hash && linkdoc instanceof JournalEntryPage) {
            const toc = linkdoc.toc;
            if (toc[hash]) {
                result += `#${toc[hash].text}`;
                if (!label) label = toc[hash].text;
            }
        }

        // If the target has a slash in the name, change it to an underscore since it isn't a real path.
        result = result.replaceAll('/', '_');

        if (!use_uuid_for_notename) {
            /* This appears to no longer be the case - the files don't have a 1 appended.
            // Append a 1 to the condition since the filename will have a 1 appended to it.
            if (SPECIAL_CONDITIONS.includes(result)) {
                result = `${result} 1`;
            }
            */

            if (linkdoc) {
                // Lookup the friendly name of the path, so we can use it as a prefix for the link to make it more unique.
                let pack = game.packs.get(linkdoc.pack);
                if (pack) {
                    // Slashes in the title aren't real paths and as part of the export become underscores
                    let fixed_title = pack.title.replaceAll('/', '_');
                    result = `${fixed_title}/${result}`;
                }
            }
        }
        //console.log("Format Link: ", result, "label:", label);
        return formatLink(result, label, /*inline*/false);  // TODO: maybe pass inline if we really want inline inclusion
    }

    // First, localize any @Localize tags - as these might end up containing links, which need to get handled in the next step.
    const localizePattern = /@(Localize)\[([^#\]]+)(?:#([^\]]+))?](?:{([^}]+)})?/g;
    markdown = markdown.replace(localizePattern, expandOneLocalize);
 
    // Convert all the links
    const pattern = /@([A-Za-z]+)\[([^#\]]+)(?:#([^\]]+))?](?:{([^}]+)})?/g;
    markdown = markdown.replace(pattern, replaceOneLink);

    // Replace file references (TBD AFTER HTML conversion)
    const filepattern = /!\[([^\]]*)\]\(([^)]*)\)/g;
    markdown = markdown.replaceAll(filepattern, replaceLinkedFile);

    return markdown;
}


function convertMarkdownLinks(markdown, relativeTo) {

    // Needs to be nested so that we have access to 'relativeTo'
    function replaceOneLink(str, target, label) {

        let linkdoc;
        try {
            if (!label) label = doc.name;

            // If it might be a UUID, try to look it up
            if (!/[/]/.test(target)) {
                linkdoc = fromUuidSync(target);
            } else {
                return dummyLink(target, label);
            }
        } catch (error) {
            //console.log(`Unable to fetch label from Compendium for [${target}]:[${label}]`, error);
            return uuidFailSafe(target, label);
        }

        //console.log("Linkdoc:", linkdoc, target, label);
        if (linkdoc) {
            target = linkdoc.name;
        }

        // Append a 1 to the condition since the filename will have a 1 appended to it.
        if (SPECIAL_CONDITIONS.includes(target)) {
            target = `${target} 1`;
        }

        if (linkdoc) {
            // Lookup the friendly name of the path, so we can use it as a prefix for the link to make it more unique.
            let pack = game.packs.get(linkdoc.pack);
            if (pack) {
                // Slashes in the title aren't real paths and as part of the export become underscores
                let fixed_title = pack.title.replaceAll('/', '_');
                target = `${fixed_title}/${target}`;
            }
        }

        return formatLink(target, label, /*inline*/false);  // TODO: maybe pass inline if we really want inline inclusion
    }
    
    // Convert all the links with UUIDs to human readable links
    // Look for [[link|label]]
    const pattern = /\[\[([^\]\|]+)\|([^\]]+)\]\]/g;
    markdown = markdown.replace(pattern, replaceOneLink);

    return markdown;
}

function stripUnbalancedLeftParen(input) {
    // Check if the string starts with '(' and is unbalanced
    if (input.startsWith('(') && input.split('(').length > input.split(')').length) {
        return input.slice(1); // Remove the first character
    }
    return input; // Return the original string if no unbalanced '('
}

// Evaluate a math formula to turn it into a number.
// This is designed to resolve things that reference ceil() or floor()
// and an item or spell level, such as @Damage or @Template commands.
/**
 * Performs mathematical calculations based on the given formula.
 * @param {Object} doc - The document object.
 * @param {string} formula - The mathematical formula to be evaluated.
 * @returns {number|string} - The result of the calculation or "MATH_ERROR" if an error occurs.
 */
function doMath(doc, formula) {
    formula = stripUnbalancedLeftParen(formula);
    //console.log(`doMath: ${formula}`);

    let result = ''; 

    // Remove any outermost parens
    formula = formula.replace(/^\((.*)\)$/, '$1');

    // Replace any @item references with the item's level
    // TODO: should I use Roll.replaceFormulaData() instead?
    let level = doc.level;
    formula = formula.replaceAll("(@item.level)", level);
    formula = formula.replaceAll("@item.level", level);
    formula = formula.replaceAll("(@item.rank)", level);
    formula = formula.replaceAll("@item.rank", level);
    formula = formula.replaceAll("(@item.badge.value)", 1);
    formula = formula.replaceAll("@item.badge.value", 1);

    // Replace any @actor references with 1 as that is how the
    // feat descriptions that use this syntax are generally written.
    formula = formula.replaceAll("(@actor.level)", 1);
    formula = formula.replaceAll("@actor.level", 1);

    // Remove any trailing "# comment text" or "|damage type"
    formula = formula.split('#')[0].trim();
    formula = formula.split('|')[0].trim();

    //console.log("   Revised formula:", formula);

    // Remove any outermost braces
    formula = formula.replace(/^\{(.*)\}$/, '$1');

    if (!formula.includes('d') && !formula.includes('D')) {
        // No dice, so just evaluate the expression
        result = Roll.safeEval(formula);
    } else {
        // There be dice in this expression - we need to do special parsing

        // Get the formula preceding the `d`
        let parts = formula.split(/[dD]/);
        formula = parts[0];

        // If we have no preceding number in front of the `d`, make it a 1.
        if (formula == '') {
            formula = '1';
        }

        // Wrap it in parens for easier Roll.safeEval() handling
        if (!formula.startsWith('(')) {
            formula = '(' + formula + ')';
        } 

        let rollTerms = Roll.parse(formula);
        //console.log("Terms:", rollTerms);
        for (let term of rollTerms) {
            //console.log("term: ", term);
            if (isNaN(Number(term))) {
                 result = result + Roll.safeEval(term.formula);
            } else {
                result = result + term.formula;
            }
        }
        result = result + 'd' + parts[1];
    }

    //console.log(`doMath: ${formula} = ${result}`);
    return result;  
}

// Fix some weirdness with @damage rolls that have notation like (2[splash])[sonic]) where
// the "splash" is redundant since it is also in the text description.
function stripUnbalancedLeftBracket(input) {
    // Check if there is an unblaance number of [ in the string
    const leftBracketCount = input.split('[').length - 1;
    if (leftBracketCount % 2 == 1) {
        // Find the position of the right  '['
        const unbalancedIndex = input.indexOf('[');
        if (unbalancedIndex !== -1) {
            return input.slice(unbalancedIndex + 1); // Remove everything up to and including the first '['
        }
    }
    return input; // Return the original string if no unbalanced '[' is found
}

function convertPF2ETags(doc, html) {
    // First, localize any @Localize tags - as these might end up containing links or other @tags, which need to get handled later.
    const localizePattern = /@(Localize)\[([^#\]]+)(?:#([^\]]+))?](?:{([^}]+)})?/g;
    let markdown = html.replace(localizePattern, expandOneLocalize);

    // Convert Foundry roll commands to plain text
    // Format is [[/r (dice formula) description[sometext]]]{plain text}. 
    //     We just want to grab the {plain text}
    const roll2Pattern = /\[\[\/(?:[br]+)\s+(?:.*?)\]\]{(.*?)}/g;
    markdown = markdown.replace(roll2Pattern, function(match, p1) {
                                                return `${p1}`;
                                            });

    // Convert another style Foundry roll commands to plain text
    // Format is [[/r (dice formula) description[sometext]]], 
    //     where the "description" and [sometext] is optional
    // The dice formula can contain a level reference as "@item.level".
    const rollPattern = /\[\[\/(?:[br]+)\s+([^\[\]]+)(?:\]|\[\s*([^\[\]]*)\])*\]\]/g;
    markdown = markdown.replace(rollPattern, function(match, p1, p2) {
                                            let result = doMath(doc, p1);
                                            if (p2 && p2 != 'healing' && !p2.includes('#')){
                                                return `${result} ${p2.replace(/,/g, ' ')}`;
                                            } else {
                                                //  Strip anything after a # to handle this example: [[/br 1d4 #minutes]] 
                                                // It gets matched by the above pattern as part of the die roll and 
                                                // the regex is already hard to read. 
                                                
                                                // If result is a number return it
                                                if (typeof result === 'number') {
                                                    return result;
                                                } else {
                                                    return result.split('#')[0];
                                                }
                                            }
                                            });

    // Match things like: @Check[type:thievery|dc:20]{Thievery Skill Check}
    // and turn it into: Dc 20 Thievery Skill Check
    const checkPatternWithDesc = /@Check\[(?:[^\]]*?\|)?type:([^\|\]]+)\|(?:[^\]]*?)dc:(\d+)(?:\|[^\]]*?)?\]\{([^}]*)\}/g;
    markdown = markdown.replace(checkPatternWithDesc, function(match, p1, p2, p3) {
        return `DC ${p2} ${p3}`;
    });


    // Convert @Embed tags
    const embedPattern = /@Embed\[((?:[^[\]]|\[[^[\]]*\])*)\]/g
    markdown = markdown.replace(embedPattern, function(match, p1, p2) {
                                                    // Let these drop through so they get processed as links later
                                                    return match;
                                                });

    // Convert @"Something" tags to plain text
    // Sample format: @Damage[(2d6+4)[bludgeoning]]{plain text}
    // Could be @Damage, @Template, @Check...
    // Just grab the plain text
    const genericPattern = /@(?:\w+)\[((?:[^[\]]|\[[^[\]]*\])*)\]\{([^}]*)\}/g
    markdown = markdown.replace(genericPattern, function(match, p1, p2) {
                                                    if (match.includes('@UUID') || match.includes('@Actor') || match.includes('@Compendium')
                                                        || match.includes('@Item') || match.includes('@Macro')) {
                                                        // Let these drop through so they get processed as links later
                                                        return match;
                                                    } else {
                                                        return `${p2}`;
                                                    }
                                                });

    // Convert @Damage to plain text
    // Format is @Damage[(2d6+4)[bludgeoning]]
    // or        @Damage[(@item.level+1)d10[vitality]]
    // This one has no descriptive text
    const damagePattern = /@Damage\[([^\[\]]+)\[(.*?)\](?:\|.*?)*\]/g;
    markdown = markdown.replace(damagePattern, function(match, p1, p2) {
                                                    let result = doMath(doc, p1);
                                                    if (result) {
                                                        // Remove any wrapping parens
                                                        result = `${result}`.replace(/^\(|\)$/g, "");
                                                    }
                                                    // If p2 has an @tag of the format "@xxx.flags.pf2e..."
                                                    // remove that part of the string.
                                                    if (p2.includes('@')) {
                                                        p2 = p2.replace(/@.*?\.pf2e\.\S+/g, '');
                                                    } 
                                                    // Look for a list of damage rolls and convert each piece,
                                                    // such as "acid],3d6[persistent,acid],(3[splash])[acid" (which comes from Generate Bomb in Alchemical Golem from Bestiary 1)
                                                    let parts = p2.split('],');
                                                    const subDamagePattern = /([^\[\]]+)(\[.*\])/;
                                                    let damageList = '';
                                                    parts.forEach((part, index) => {
                                                        // console.log("part: ", part, " index:", index);
                                                        if (index == 0) {
                                                            damageList = part;
                                                            damageList = stripUnbalancedLeftBracket(damageList);
                                                        } else {
                                                            let mathyPartIndex = part.indexOf('[');
                                                            let mathyPart = part.substring(0,mathyPartIndex);
                                                            // strip parens if unbalanced. 
                                                            if ((mathyPart.includes('(') && !mathyPart.includes(')')) ||
                                                                (mathyPart.includes(')') && !mathyPart.includes('('))) {
                                                                mathyPart = mathyPart.replace(/[()]/g, ''); 
                                                            }
                                                            mathyPart = doMath(doc, mathyPart); 
                                                            // Remove any more brackets from the remaining description
                                                            let partDescription = part.substring(mathyPartIndex+1).replace(/[\[\]]/g, ' ');
                                                            // strip any remaining parens if unbalanced. 
                                                            if ((partDescription.includes('(') && !partDescription.includes(')')) ||
                                                                (partDescription.includes(')') && !partDescription.includes('('))) {
                                                                    partDescription = partDescription.replace(/[()]/g, ''); 
                                                            }
                                                            damageList = damageList + ' + ' + mathyPart + ' ' + partDescription;
                                                        }
                                                    });
                                                    // console.log("damagelist:", damageList);
                                                    return `${result} ${damageList.replace(/,/g, ' ')}`;
                                                });

    // Convert simple @Damager[2d4] to plain text
    const damage2Pattern = /@Damage\[([^\[\]]+)\]/g;
    markdown = markdown.replace(damage2Pattern, function(match, p1) {
                                                    let result = doMath(doc, p1);
                                                    if (result) {
                                                        // Remove any wrapping parens
                                                        result = `${result}`.replace(/^\(|\)$/g, "");
                                                    }
                                                    return result;
                                                });
                                        
    // Convert @Template with no description to plain text
    // Format is @Template[type:cone|distance:30]
    // or @Template\[type:cone|distance:40|traits:arcane,evocation,fire,damaging-effect\]
    const templatePattern = /@Template\[type:([^\|\]]+)\|distance:(\d+)(?:\|.*?)*\]/g;
    markdown = markdown.replace(templatePattern, function(match, p1, p2) {
                                                    return `${p2}-foot ${p1}`;
                                                });

    // Convert @Template without the label "type" and with no description to plain text
    // Format is @Template[cone|distance:30]
    // or @Template\[cone|distance:40|traits:arcane,evocation,fire,damaging-effect\]
    const templatePattern2 = /@Template\[([^\|\]]+)\|distance:(\d+)(?:\|.*?)*\]/g;
    markdown = markdown.replace(templatePattern2, function(match, p1, p2) {
                                                    return `${p2}-foot ${p1}`;
                                                });

    // Convert @Check with no description to plain text
    // Format is @Check[type:athletics|dc:15|traits:action:climb]
    //        or @Check[type:athletics|traits:action:swim|dc:10]
    //        or @Check[type:flat|dc:16]
    //        or @Check[fortitude|dc:42]
    // will be converted to "DC 15 Athletics"
    const checkPattern = /@Check\[(?:type:)*([^\|\]]+)\|(?:.*?)dc:(\d+)(?:\|.*?)*\]/g;
    markdown = markdown.replace(checkPattern, function(match, p1, p2) {
                                                    // Convert sluggified p1 to more friendly label
                                                    p1 = p1.split("-").map(word=>word.slice(0,1).toUpperCase()+word.slice(1)).join(" ");
                                                    return `DC ${p2} ${p1} check`;
                                                });

    // Convert @Check for "basic save" to plain text
    // Format is @Check[type:reflex|dc:resolve(@actor.attributes.spellDC.value)|basic:true]
    //        or @Check[type:astrology-lore]
    //        or @Check[type:athletics|defense:reflex] 
    // will be converted to "basic Reflex"
    const checkBasicPattern = /@Check\[(?:type:)*([^\|\]]+)(?:\|.*?)*(\|basic:true)*\]/g;
    markdown = markdown.replace(checkBasicPattern, function(match, p1, basic) {
                                                    // Convert sluggified p1 to more friendly label
                                                    p1 = p1.split("-").map(word=>word.slice(0,1).toUpperCase()+word.slice(1)).join(" ");

                                                    if (basic) {
                                                        return `basic ${p1} check`;
                                                    } else {
                                                        return `${p1} check`;
                                                    }   
                                                });

    return markdown;
}

function setupTurndown() {

    // Foundry uses "showdown" rather than "turndown":
    // SHOWDOWN fails to parse tables at all

    if (!turndownService) {
        // Setup Turndown service to use GFM for tables
        // headingStyle: "atx"  <-- use "###" to indicate heading (whereas setext uses === or --- to underline headings)
        turndownService = new TurndownService({ 
            headingStyle: "atx",
            codeBlockStyle: "fenced"
        });
        // GFM provides supports for strikethrough, tables, taskListItems, highlightedCodeBlock
        gfm = TurndownPluginGfmService.gfm;
        turndownService.use(gfm);
        
        // Add a custom rule for handling action-glyph spans.
        // Convert them to Obsidian PF2E Action Icons plugin format.
        turndownService.addRule('actionGlyph', {
          filter: function (node, options) {
            return (
              node.nodeName === 'SPAN' &&
              node.getAttribute('class') === 'action-glyph'
            );
          },
          replacement: function (content, node, options) {
            // Match the default format used by the PF2E Action Icons plugin
            switch (content) {
             // Free action
             case 'F':
             case 'f':
                content = '0';
                break;
                
             // Reaction
             case 'R':
             case 'r':
                content = 'r';
                break;
                
             // Action - some Foundry entries use 1 (such as most spells), others use 'a'
             case 'a':
             case 'A':
                content = '1';
                break;
            }
            
            return '`pf2:' + content + '`';
          }
        });

    }
}

// This code needs to be asynchronous so we can fetch @Embed documents
async function convertHtmlAsync(doc, html) {

    // console.log("Converting: ", html);

    setupTurndown();

    let markdown;
    try {
        markdown = convertPF2ETags(doc,html);

        // Add an extra line break before a table so markdown renders it correctly:
        markdown = markdown.replaceAll("<table", "\n<br/>\n<table");

        // Convert links BEFORE doing HTML->MARKDOWN (to get links inside tables working properly)
        markdown = await convertLinksAsync(markdown, doc);

        // The conversion "escapes" the "[[...]]" markers, so we have to remove those markers afterwards
        markdown = turndownService.turndown(markdown).replaceAll("\\[\\[","[[").replaceAll("\\]\\]","]]");
        
        // Correct any escaped underscores that resulted from the turndown service
        markdown = markdown.replaceAll("\\_", "_");
        
        // Now convert file references
        const filepattern = /!\[([^\]]*)\]\(([^)]*)\)/g;
        markdown = markdown.replaceAll(filepattern, replaceLinkedFile);

        // Look for <div style="float:left"><div src=" and include that link in the zip archive
        // This will ensure images linked this way are included in the zip.
        // (These happen from the custom turndown processing for "img" tags with only a height attribute)
        const imgPattern = /<div style="float:left"><div src="([^"]*)"/g;
        for (const match of markdown.matchAll(imgPattern)) {
            const fullMatch = match[0];  // The full matched string, e.g., <div style="float:left"><div src="image1.png"
            const srcReference = match[1];  // The captured group, e.g., "image1.png"

            zip.folder(destForImages).file(srcReference, 
                // Provide a Promise which JSZIP will wait for before saving the file.
                // (Note that a CORS request will fail at this point.)
                fetch(srcReference).then(resp => {
                    if (resp.status !== 200) {
                        console.error(`ConvertHTML: Failed to fetch file from '${srcReference}' (response ${resp.status})`)
                        return new Blob();
                    } else {
                        console.debug(`ConvertHTML: Adding file ${srcReference}`);
                        return resp.blob();
                    }
                }).catch(e => { 
                    console.log(e);
                    return new Blob();
                }),
            {binary:true});
        }

    } catch (error) {
        console.warn(error);
        console.warn(`Error: failed to decode html:`, html)
    }

    return markdown;
}


// Unfortunately, handlebars don't run asynchronously, so I need a redundant version
// of the HTML conversion code that is synchronous, which won't handle pulling in the contents of @Embed tags.    
export function convertHtml(doc, html) {

    // console.log("Converting synchronously: ", html);

    setupTurndown();

    let markdown;
    try {
        markdown = convertPF2ETags(doc,html);

        // Add an extra line break before a table so markdown renders it correctly:
        markdown = markdown.replaceAll("<table", "\n<br/>\n<table");

        // Convert links BEFORE doing HTML->MARKDOWN (to get links inside tables working properly)
        markdown = convertLinks(markdown, doc);

        // The conversion "escapes" the "[[...]]" markers, so we have to remove those markers afterwards
        markdown = turndownService.turndown(markdown).replaceAll("\\[\\[","[[").replaceAll("\\]\\]","]]");
        
        // Correct any escaped underscores that resulted from the turndown service
        markdown = markdown.replaceAll("\\_", "_");
        
        // Now convert file references
        const filepattern = /!\[([^\]]*)\]\(([^)]*)\)/g;
        markdown = markdown.replaceAll(filepattern, replaceLinkedFile);

        // Look for <div style="float:left"><div src=" and include that link in the zip archive
        // This will ensure images linked this way are included in the zip.
        // (These happen from the custom turndown processing for "img" tags with only a height attribute)
        const imgPattern = /<div style="float:left"><div src="([^"]*)"/g;
        for (const match of markdown.matchAll(imgPattern)) {
            const fullMatch = match[0];  // The full matched string, e.g., <div style="float:left"><div src="image1.png"
            const srcReference = match[1];  // The captured group, e.g., "image1.png"

            zip.folder(destForImages).file(srcReference, 
                // Provide a Promise which JSZIP will wait for before saving the file.
                // (Note that a CORS request will fail at this point.)
                fetch(srcReference).then(resp => {
                    if (resp.status !== 200) {
                        console.error(`ConvertHTML: Failed to fetch file from '${srcReference}' (response ${resp.status})`)
                        return new Blob();
                    } else {
                        console.debug(`ConvertHTML: Adding file ${srcReference}`);
                        return resp.blob();
                    }
                }).catch(e => { 
                    console.log(e);
                    return new Blob();
                }),
            {binary:true});
        }

    } catch (error) {
        console.warn(error);
        console.warn(`Error: failed to decode html:`, html)
    }

    return markdown;
}


function frontmatter(doc, showheader=true) {
    let header = showheader ? `\n# ${doc.name}\n` : "";
    return FRONTMATTER + 
        `title: "${doc.name}"\n` + 
        `icon: "${DOCUMENT_ICON.lookup(doc)}"\n` +
        `aliases: "${doc.name}"\n` + 
        `foundryId: ${doc.uuid}\n` + 
        `tags:\n  - ${doc.documentName}\n` +
        FRONTMATTER +
        header;
}


async function oneJournal(path, journal) {
    let subpath = path;
    if (journal.pages.size > 1) {
        // Put all the notes in a sub-folder
        subpath = formpath(path, use_uuid_for_journal_folder ? docfilename(journal) : validFilename(journal.name));
        // TOC page 
        // This is a Folder note, so goes INSIDE the folder for this journal entry
        let markdown = frontmatter(journal) + "\n## Table of Contents\n";
        for (let page of journal.pages.contents.sort((a,b) => a.sort - b.sort)) {
            markdown += `\n${' '.repeat(2*(page.title.level-1))}- ${formatLink(docfilename(page), page.name)}`;
        }
        // Filename must match the folder name
        zip.folder(subpath).file(zipfilename(journal), markdown, { binary: false });
    }

    for (const page of journal.pages) {
        let markdown;
        switch (page.type) {
            case "text":
                switch (page.text.format) {
                    case 1: // HTML
                        markdown = await convertHtmlAsync(page, page.text.content);
                        break;
                    case 2: // MARKDOWN
                        markdown = page.text.markdown;
                        break;
                }
                break;
            case "image": case "pdf": case "video":
                if (page.src) markdown = fileconvert(page.src) + EOL;
                if (page.image?.caption) markdown += EOL + page.image.caption + EOL;
                break;
        }
        if (markdown) {
            markdown = frontmatter(page, page.title.show) + markdown;
            zip.folder(subpath).file(`${notefilename(page)}.md`, markdown, { binary: false });
        }
    }
}

async function oneRollTable(path, table) {
    let markdown = frontmatter(table);
    
    if (table.description) markdown += table.description + "\n\n";

    markdown += 
        `| ${table.formula || "Roll"} | result |\n` +
        `|------|--------|\n`;

    for (const tableresult of table.results) {
        const range  = (tableresult.range[0] == tableresult.range[1]) ? tableresult.range[0] : `${tableresult.range[0]}-${tableresult.range[1]}`;
        // Escape the "|" in any links
        markdown += `| ${range} | ${(await convertHtmlAsync(table, tableresult.getChatText())).replaceAll("|","\\|")} |\n`;
    }

    // No path for tables
    zip.folder(path).file(zipfilename(table), markdown, { binary: false });
}

function oneScene(path, scene) {
    
    const sceneBottom = scene.dimensions.sceneRect.y;
    const sceneLeft   = scene.dimensions.sceneRect.x;
    const units_per_pixel = /*units*/ scene.grid.distance / /*pixels*/ scene.grid.size;

    function coord(pixels) {
        return pixels * units_per_pixel;
    }
    function coord2(pixely, pixelx) { return `${coord(scene.dimensions.sceneRect.height) - coord(pixely - sceneBottom)}, ${coord(pixelx - sceneLeft)}` };

    let markdown = frontmatter(scene);

    // Two "image:" lines just appear as separate layers in leaflet.
    let overlays=[]
    if (scene.foreground) {
        overlays.push(`${fileconvert(scene.foreground, "Foreground", /*inline*/false)}`);
    }

    for (const tile of scene.tiles) {
        // tile.overhead
        // tile.roof
        // tile.hidden
        // tile.z
        // tile.alpha
        // - [ [[ImageFile2|Optional Alias]], [Top Left Coordinates], [Bottom Right Coordinates] ]
        let name = tile.texture.src;
        let pos = name.lastIndexOf('/');
        if (pos) name = name.slice(pos+1);
        overlays.push(`${fileconvert(tile.texture.src, name, /*inline*/ false)}, [${coord2(tile.y+tile.height-1, tile.x)}], [${coord2(tile.y, tile.x+tile.width-1)}]`);
    }

    let layers = (overlays.length === 0) ? "" : 'imageOverlay:\n' + overlays.map(layer => `    - [ ${layer} ]\n`).join("");
    // scene.navName - maybe an alias in the frontmatter (if non-empty, and different from scene.name)
    markdown += 
        `\n${MARKER}leaflet\n` +
        `id: ${scene.uuid}\n` +
        `bounds:\n    - [0, 0]\n    - [${coord(scene.dimensions.sceneRect.height)}, ${coord(scene.dimensions.sceneRect.width)}]\n` +
        "defaultZoom: 2.75\n" +
        "minZoom: 2.5\n" +
        "maxZoom: 6\n" +
        "zoomDelta: 0.25\n" +
        `lat: ${coord(scene.dimensions.sceneRect.height/2)}\n` +
        `long: ${coord(scene.dimensions.sceneRect.width/2)}\n` +
        `height: 100%\n` +
        `draw: false\n` +
        `unit: ${scene.grid.units}\n` +
        `showAllMarkers: true\n` +
        `preserveAspect: true\n` +
        `image: ${fileconvert(scene.background.src, null, /*inline*/false)}\n` +
        layers;

    // scene.dimensions.distance / distancePixels / height / maxR / ratio
    // scene.dimensions.rect: (x, y, width, height, type:1)
    // scene.dimensions.sceneHeight/sceneWidth/size/height/width
    // scene.grid: { alpha: 0.2, color: "#000000", distance: 5, size: 150, type: 1, units: "ft"}
    // scene.height/width

    for (const note of scene.notes) {
        const linkdoc = note.page || note.entry;
        const linkfile = linkdoc ? notefilename(linkdoc) : "Not Linked";
        // Leaflet plugin doesn't like ":" appearsing in the Note's label.
        const label = note.label.replaceAll(":","_");

        // invert Y coordinate, and remove the padding from the note's X,Y position
        markdown += `marker: default, ${coord2(note.y, note.x)}, ${formatLink(linkfile, label)}\n`;
            //`    icon: :${note.texture.src}:` + EOL +
    }
    markdown += MARKER;

    // scene.lights?

    zip.folder(path).file(zipfilename(scene), markdown, { binary: false });
}

function onePlaylist(path, playlist) {
    // playlist.description
    // playlist.fade
    // playlist.mode
    // playlist.name
    // playlist.seed
    // playlist._playbackOrder (array, containing list of keys into playlist.sounds)
    // playlist.sounds (collection of PlaylistSound)
    //    - debounceVolume
    //    - description
    //    - fade
    //    - name
    //    - path (filename)
    //    - pausedTime
    //    - repeat (bool)
    //    - volume

    let markdown = frontmatter(playlist);

    if (playlist.description) markdown += playlist.description + EOL + EOL;

    for (const id of playlist._playbackOrder) {
        const sound = playlist.sounds.get(id);
        // HOW to encode volume of each track?
        markdown += `#### ${sound.name}` + EOL;
        if (sound.description) markdown += sound.description + EOL
        markdown += fileconvert(sound.path) + EOL;
    }

    zip.folder(path).file(zipfilename(playlist), markdown, { binary: false });
}

async function documentToJSON(path, doc) {
    // see Foundry exportToJSON

    const data = doc.toCompendium(null);
    // Remove things the user is unlikely to need
    if (data.prototypeToken) delete data.prototypeToken;

    let markdown = frontmatter(doc);
    if (doc.img) markdown += fileconvert(doc.img, IMG_SIZE) + EOL + EOL;

    // Some common locations for descriptions
    const DESCRIPTIONS = [
        "system.details.biography.value",  // Actor: DND5E
        "system.details.publicNotes",       // Actor: PF2E
        "system.description.value",        // Item: DND5E and PF2E
    ]
    for (const field of DESCRIPTIONS) {
        let text = foundry.utils.getProperty(doc, field);
        if (text) markdown += await convertHtmlAsync(doc, text) + EOL + EOL;
    }

    let datastring;
    let dumpoption = game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_DUMP);
    if (dumpoption === "YAML")
        datastring = jsyaml.dump(data);
    else if (dumpoption === "JSON")
        datastring = JSON.stringify(data, null, 2) + EOL;
    else
        console.error(`Unknown option for dumping objects: ${dumpoption}`)
    // TODO: maybe extract Items as separate notes?

    // Convert LINKS: Foundry syntax to Markdown syntax
    datastring = convertLinks(datastring, doc);

    markdown +=
        MARKER + doc.documentName + EOL + 
        datastring +
        MARKER + EOL;

    zip.folder(path).file(zipfilename(doc), markdown, { binary: false });
}

async function maybeTemplate(path, doc) {
    const templatePath = templateFile(doc);
    if (!templatePath) return documentToJSON(path, doc);
    //console.log(`Using handlebars template '${templatePath}' for '${doc.name}'`)

    // Only upload non-system IMGs, if present.
    // NOTE: please observe any license restrictions on images from
    //       journal entries you do not directly own.  
    //       See: data/systems/pf2e/licenses for PF2e artwork license information. 
    //       This is why system images are excluded.
    if (doc.img && export_tokens) {
        if (! doc.img.includes("systems/") && ! doc.img.includes("icons/")) {
            // Save the image to the zip file
            doc.img_path = fileconvert(doc.img, " ", false);
        }
    }

    // Add extra property if initiative tracket option was selected
    if (include_initiative_tracker) {
        doc.include_initiative = true;
    }

    // Apply the supplied template file:
    // Foundry renderTemplate only supports templates with file extensions: html, handlebars, hbs
    // Foundry filePicker hides all files with extension html, handlebars, hbs
    let markdown = await myRenderTemplate(templatePath, doc).catch(err => {
        ui.notifications.warn(`Handlers Error: ${err.message}`);
        throw err;
    })

    if (!use_uuid_for_notename) {
        // Convert the UUID links to human-readable links
        markdown = convertMarkdownLinks(markdown, doc);
    }

    zip.folder(path).file(zipfilename(doc), markdown, { binary: false });
}

async function oneDocument(path, doc) {
    if (doc instanceof JournalEntry)
        await oneJournal(path, doc);
    else if (doc instanceof RollTable)
        await oneRollTable(path, doc);
    else if (doc instanceof Scene && game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_LEAFLET))
        await oneScene(path, doc);
    else if (doc instanceof Playlist)
        await onePlaylist(path, doc);
    else
        await maybeTemplate(path, doc);
    // Actor
    // Cards
    // ChatMessage
    // Combat(Tracker)
    // Item
    // Macro
}

async function oneChatMessage(path, message) {
    let html = await message.getHTML();
    if (!html?.length) return message.export();

    return `## ${new Date(message.timestamp).toLocaleString()}\n\n` + 
        await convertHtmlAsync(message, html[0].outerHTML);
}

async function oneChatLog(path, chatlog) {
    // game.messages.export:
    // Messages.export()
    let log=""
    for (const message of chatlog.collection) {
        log += await oneChatMessage(path, message) + "\n\n---------------------------\n\n";
    }
    //const log = chatlog.collection.map(m => oneChatMessage(path, m)).join("\n---------------------------\n");
    let date = new Date().toDateString().replace(/\s/g, "-");
    const filename = `log-${date}.md`;

    zip.folder(path).file(filename, log, { binary: false });
}

async function oneFolder(path, folder) {
    let subpath = formpath(path, validFilename(folder.name));
    for (const journal of folder.contents) {
        await oneDocument(subpath, journal);
    }
    for (const childfolder of folder.getSubfolders(/*recursive*/false)) {
        await oneFolder(subpath, childfolder);
    }
}

async function onePack(path, pack) {
    let type = pack.metadata.type;
    console.debug(`Collecting pack '${pack.title}'`)
    let subpath = formpath(path, validFilename(pack.title));
    const documents = await pack.getDocuments();
    for (const doc of documents) {
        await oneDocument(subpath, doc);
    }
}

async function onePackFolder(path, folder) {
    let subpath = formpath(path, validFilename(folder.name));
    for (const pack of game.packs.filter(pack => pack.folder === folder)) {
        await onePack(subpath, pack);
    }
}

let is_v10=false

export async function exportMarkdown(from, zipname) {

    clearTemplateCache();

    use_uuid_for_journal_folder = game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_FOLDER_AS_UUID);
    use_uuid_for_notename       = game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_NOTENAME_IS_UUID);
    export_tokens               = game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_EXPORT_TOKENS);
    include_initiative_tracker  = game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_INCLUDE_INITIATIVE);
    export_traits               = game.settings.get(MOD_CONFIG.MODULE_NAME, MOD_CONFIG.OPTION_EXPORT_TRAITS);

    let noteid = ui.notifications.info(`${MODULE_NAME}.ProgressNotification`, {permanent: true, localize: true})
    // Wait for the notification to get drawn
    await new Promise(resolve => setTimeout(resolve, 100));

    zip = new JSZip();

    const TOP_PATH = "";

    // Export all the traits as individual notes in a zz_traits folder
    if (export_traits) {
        for (const key in CONFIG.PF2E.traitsDescriptions) {
            let traitDescription = game.i18n.localize(CONFIG.PF2E.traitsDescriptions[key]);
            
            // A few traits have @Check[] tags that should be turned into human readable text
            const checkPattern = /@Check\[(?:type:)*([^\|\]]+)\|(?:.*?)dc:(\d+)(?:\|.*?)*\]/g;
            traitDescription = traitDescription.replace(checkPattern, function(match, p1, p2) {
                                                            // Convert sluggified p1 to more friendly label
                                                            p1 = p1.split("-").map(word=>word.slice(0,1).toUpperCase()+word.slice(1)).join(" ");
                                                            if (p1 === "Flat") {
                                                                return `DC ${p2} ${p1} check`;
                                                            } else {
                                                                return `DC ${p2} ${p1}`;
                                                            } 
                                                        });

            zip.folder("zz_traits").file(`${key}.md`, traitDescription, { binary: false });
        }
    }

    if (from instanceof Folder) {
        console.debug(`Processing one Folder`)
        // Do we put in the full hierarchy that might be ABOVE the indicated folder
        if (from.type === "Compendium")
            await onePackFolder(TOP_PATH, from);
        else
            await oneFolder(TOP_PATH, from);
    }
    else if (is_v10 ? from instanceof SidebarDirectory : from instanceof DocumentDirectory) {
        for (const doc of from.documents) {
            await oneDocument(folderpath(doc), doc);
        }
    } else if (from instanceof CompendiumDirectory) {
        // from.collection does not exist in V10
        for (const doc of game.packs) {
            await onePack(folderpath(doc), doc);
        }
    } else if (from instanceof CompendiumCollection) {
        await onePack(TOP_PATH, from);
    } else if (from instanceof CombatTracker) {
        for (const combat of from.combats) {
            await oneDocument(TOP_PATH, combat);
        }
    }
    else if (from instanceof ChatLog) {
        await oneChatLog(from.title, from);
    } else
        await oneDocument(TOP_PATH, from);

    let blob = await zip.generateAsync({ type: "blob" });
    await saveDataToFile(blob, `${validFilename(zipname)}.zip`);
    // ui.notifications.remove does not exist in Foundry V10
    ui.notifications.remove?.(noteid);
}

function ziprawfilename(name, type) {
    if (!type) return name;
    return `${type}-${name}`;
}

Hooks.once('init', async () => {
    // Foundry V10 doesn't use DocumentDirectory
    is_v10 = (typeof DocumentDirectory === "undefined");

    // If not done during "init" hook, then the journal entry context menu doesn't work

    const baseClass = is_v10 ? "SidebarDirectory" : "DocumentDirectory";

    // JOURNAL ENTRY context menu
    function addEntryMenu(wrapped, ...args) {
        return wrapped(...args).concat({
            name: `${MODULE_NAME}.exportToMarkdown`,
            icon: '<i class="fas fa-file-zip"></i>',
            condition: () => game.user.isGM,
            callback: async header => {
                const li = header.closest(".directory-item");
                const id = li.data(is_v10 ? "documentId" : "entryId");
                const entry = this.documents.find(d => d.id === id);
                //const entry = this.collection.get(li.data("entryId")); // works only on V11+
                if (entry) exportMarkdown(entry, ziprawfilename(entry.name, entry.constructor.name));
            },
        });
    }
    libWrapper.register(MODULE_NAME, `${baseClass}.prototype._getEntryContextOptions`, addEntryMenu, libWrapper.WRAPPER);

    function addCompendiumEntryMenu(wrapped, ...args) {
        return wrapped(...args).concat({
            name: `${MODULE_NAME}.exportToMarkdown`,
            icon: '<i class="fas fa-file-zip"></i>',
            condition: li => game.user.isGM,
            callback: async li => {
                const pack = game.packs.get(li.data("pack"));
                if (pack) exportMarkdown(pack, ziprawfilename(pack.title, pack.metadata.type));
            },
        });
    }
    libWrapper.register(MODULE_NAME, "CompendiumDirectory.prototype._getEntryContextOptions", addCompendiumEntryMenu, libWrapper.WRAPPER);

    // FOLDER context menu: needs 
    function addFolderMenu(wrapped, ...args) {
        return wrapped(...args).concat({
            name: `${MODULE_NAME}.exportToMarkdown`,
            icon: '<i class="fas fa-file-zip"></i>',
            condition: () => game.user.isGM,
            callback: async header => {
                const li = header.closest(".directory-item")[0];
                // li.dataset.uuid does not exist in Foundry V10
                const folder = fromUuidSync(`Folder.${li.dataset.folderId}`);
                if (folder) exportMarkdown(folder, ziprawfilename(folder.name, folder.type));
            },
        });
    }
    libWrapper.register(MODULE_NAME, `${baseClass}.prototype._getFolderContextOptions`, addFolderMenu, libWrapper.WRAPPER);
    if (!is_v10) libWrapper.register(MODULE_NAME, "CompendiumDirectory.prototype._getFolderContextOptions", addFolderMenu, libWrapper.WRAPPER);
})

Hooks.on("renderSidebarTab", async (app, html) => {
    if (!game.user.isGM) return;

    if (!(app instanceof Settings)) {
        const label = game.i18n.localize(`${MODULE_NAME}.exportToMarkdown`);
        const help  = game.i18n.localize(`${MODULE_NAME}.exportToMarkdownTooltip`);
        let button = $(`<button style="flex: 0" title="${help}"><i class='fas fa-file-zip'></i>${label}</button>`)
        button.click((event) => {
            event.preventDefault();
            exportMarkdown(app, ziprawfilename(app.constructor.name));
        });

        html.append(button);
    } else {
        console.debug(`Export-Markdown | Not adding button to sidebar`, app)
    }
})
