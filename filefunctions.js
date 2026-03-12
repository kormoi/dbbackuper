const fncs = require('./functions');
const AdmZip = require("adm-zip");
const { count } = require('console');
const cstyler = require('cstyler');
const path = require('path');
const fs = require('fs').promises;
const v8 = require('v8');
const os = require('os');








function getMemoryStats() {
    // 1. V8 Heap Stats (The Node.js Internal RAM)
    const v8Stats = v8.getHeapStatistics();
    const heapLimit = v8Stats.heap_size_limit / 1024 / 1024;
    const usedHeap = v8Stats.used_heap_size / 1024 / 1024;
    const availableHeap = heapLimit - usedHeap;
    const heapPercent = (usedHeap / heapLimit) * 100;

    // 2. System Stats (The Physical RAM of the Server/VPS)
    const totalSystemRam = os.totalmem() / 1024 / 1024;
    const freeSystemRam = os.freemem() / 1024 / 1024;
    const usedSystemRam = totalSystemRam - freeSystemRam;
    const systemPercent = (usedSystemRam / totalSystemRam) * 100;

    return {
        // Node.js specific (Heap)
        heap: {
            totalMB: Number(heapLimit.toFixed(2)),
            usedMB: Number(usedHeap.toFixed(2)),
            availableMB: Number(availableHeap.toFixed(2)),
            percentUsed: Number(heapPercent.toFixed(2))
        },
        // Physical Server specific
        system: {
            totalMB: Number(totalSystemRam.toFixed(2)),
            usedMB: Number(usedSystemRam.toFixed(2)),
            availableMB: Number(freeSystemRam.toFixed(2)),
            percentUsed: Number(systemPercent.toFixed(2))
        }
    };
}
async function getFolderTree(dirPath) {
    const tree = {};
    // Convert the initial input to an absolute path once
    const absoluteDirPath = path.resolve(dirPath);
    
    try {
        const items = await fs.readdir(absoluteDirPath);

        for (const item of items) {
            const fullPath = path.join(absoluteDirPath, item);
            const stats = await fs.stat(fullPath);
            const isDirectory = stats.isDirectory();

            tree[item] = {
                name: item,
                path: fullPath, // This is now guaranteed to be absolute
                type: isDirectory ? 'folder' : 'file',
                size: stats.size, 
                extension: isDirectory ? null : path.extname(item)
            };

            // Recursively get contents if it's a folder
            if (isDirectory) {
                tree[item].contents = await getFolderTree(fullPath);
            }
        }
        
        return tree;
    } catch (err) {
        // If the path doesn't exist or is inaccessible
        console.error(`Error reading directory ${absoluteDirPath}:`, err.message);
        return {};
    }
}

async function readJsonFile(filePath) {
    try {
        // Check if the file has a .json extension
        if (path.extname(filePath).toLowerCase() !== ".json") {
            throw new Error(`The file at ${filePath} is not a JSON file.`);
        }

        // Read the file as a string
        const fileContent = await fs.readFile(filePath, "utf-8");

        // Parse the JSON string into an object
        const jsonData = JSON.parse(fileContent);
        return jsonData;
    } catch (error) {
        // Handle errors (e.g., file not found, invalid JSON)
        console.error(`Error reading or parsing JSON file at ${filePath}:`, error);
        return null;
    }
}
async function writeJsonFile(filePath, data) {
    try {
        // Ensure the directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        // Convert the data object to a JSON string with indentation
        const jsonString = JSON.stringify(data, null, 2);

        // Write the JSON string to the file
        await fs.writeFile(filePath, jsonString, "utf-8");
        const successMessage = `File written successfully to ${filePath}`;
        console.log(successMessage);
        return true;
    } catch (error) {
        // Handle errors (e.g., permission issues, invalid data)
        console.error(`Error writing JSON file at ${filePath}:`, error);
        return null;
    }
}

// Adm Zip
function zipFile(sourcePath, outPath) {
    try {
        const zip = new AdmZip();

        // Check if source is a folder or a single file
        zip.addLocalFolderPromise ? zip.addLocalFile(sourcePath) : zip.addLocalFolder(sourcePath);

        // If it's just a single file, we use addLocalFile
        // For simplicity, this hero function handles both:
        zip.addLocalFile(sourcePath);

        zip.writeZip(outPath);
        console.log(`Successfully zipped: ${outPath}`);
        return true;
    } catch (e) {
        console.error(`Zip Error: ${e.message}`);
        return null;
    }
}
function unzipFile(zipPath, targetDir) {
    try {
        const zip = new AdmZip(zipPath);

        // extractAllTo(targetPath, overwrite)
        zip.extractAllTo(targetDir, true);

        console.log(`Successfully extracted zip file`);
        return true;
    } catch (e) {
        console.error(`Unzip Error: ${e.message}`);
        return false;
    }
}
async function compressbackupfile(path, data) {
    try {
        // is path absolute
        if (!path.isAbsolute(path)) {
            console.warn("An absolute output path is required. You can do 'path.join(__dirname, [Your path here]);'");
            return false;
        }
        const sourcePath = path.join(__dirname, "./backupfiles/backup.json");
        const writejs = await writeJsonFile(sourcePath, data);
        if (writejs === null) {
            console.error("Having problem creating JSON file. Please try again or reinstall the module.");
            return null;
        }
        const zipfile = zipFile(sourcePath, path);
        if (zipfile === null) {
            return null;
        }
        console.log("Successfully zipped the file.");
        // lets delete file
        try {
            await fs.unlink(sourcePath);
        } catch (err) {
            console.error(err.message);
        }
        return true;
    } catch (err) {
        console.error(err.message);
        return null;
    }
}
async function isFolderPath(folderPath) {
    try {
        const stats = await fs.stat(folderPath);
        return stats.isDirectory();
    } catch (err) {
        // If the folder doesn't exist yet, we can check if it has no extension
        return null;
    }
}
async function makeDirectory(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (err) {
        console.error(`Error creating directory: ${err.message}`);
        return null;
    }
}
async function isfilepathwithext(filePath, ext = ".zip") {
    // 1. Check extension first (fast)
    let exten;
    if (typeof ext !== "string") return null;
    if (!ext.startsWith(".")) {
        exten = "." + ext;
    }
    const isZipExt = path.extname(filePath).toLowerCase() === exten;
    if (!isZipExt) return false;

    try {
        // 2. Check if it actually exists and is a file (not a folder named "test.zip")
        const stats = await fs.stat(filePath);
        return stats.isFile();
    } catch (err) {
        // If file doesn't exist, we return null
        return null;
    }
}
async function isfilepath(filePath) {
    try {
        const stats = await fs.stat(filePath);
        // Returns true only if it is a file (not a folder)
        return stats.isFile();
    } catch (err) {
        // If the file doesn't exist or there is a permission error, return null
        return null;
    }
}
async function clearFolderContents(folderPath) {
    try {
        // 1. Read all files/folders inside the directory
        const files = await fs.readdir(folderPath);

        // 2. Loop and delete each item
        const deletePromises = files.map(file => {
            const filePath = path.join(folderPath, file);

            // Use rm with recursive: true to delete subfolders as well
            // Use force: true to ignore errors if the file is already gone
            return fs.rm(filePath, { recursive: true, force: true });
        });
        await Promise.all(deletePromises);
        return true;
    } catch (err) {
        console.error(`Error clearing folder: ${err.message}`);
        return null;
    }
}
async function deleteSingleFile(filePath) {
    try {
        // unlink deletes the file
        await fs.unlink(filePath);

        console.log(`Successfully deleted file: ${filePath}`);
        return true;
    } catch (err) {
        // Handle case where file doesn't exist to avoid noisy errors
        if (err.code === 'ENOENT') {
            console.warn(`File not found, nothing to delete: ${filePath}`);
            return true;
        }

        console.error(`Error deleting file: ${err.message}`);
        return null;
    }
}
async function deletePath(targetPath) {
    try {
        // 'recursive: true' handles nested folders/files
        // 'force: true' prevents errors if the path doesn't exist
        await fs.rm(targetPath, { recursive: true, force: true });
        
        return { 
            success: true, 
            message: `Successfully deleted: ${targetPath}` 
        };
    } catch (err) {
        // This usually triggers for permission issues (EACCES) 
        // or if the file is currently locked by another process (EBUSY)
        console.error(`Delete Error [${targetPath}]:`, err.message);
        return { 
            success: false, 
            error: err.message, 
            code: err.code 
        };
    }
}
async function saveBufferToFile(buffer, targetPath, fileNameWithoutExt) {
    /**
     * Supported Extensions:
     *
    // Video
    "mp4", "mov", "mkv", "avi", "wmv", "mpg",

    // Images & Design
    "jpeg", "png", "gif", "webp", "tif", "psd", "ai",

    // Documents
    "docx", "doc", "pdf", "csv", "xml", "json",

    // Archives
    "rar", "7z", "zip", "gz"
    */
    if (!Buffer.isBuffer(buffer)) {
        throw new Error("Data must be a Buffer");
    }

    // Convert the first 24 bytes to Hex to catch video signatures
    const hex = buffer.toString('hex', 0, 24).toUpperCase();
    let ext = 'bin';

    // --- VIDEO ---
    // MP4/MOV: Look for 'ftyp' (66747970) usually at offset 4
    if (hex.includes('66747970')) {
        // Quick check: 'qt  ' is usually MOV, others are MP4
        ext = hex.includes('71742020') ? 'mov' : 'mp4';
    }
    else if (hex.startsWith('1A45DFA3')) ext = 'mkv';
    else if (hex.startsWith('52494646') && hex.substring(16, 24) === '41564920') ext = 'avi'; // RIFF + AVI 
    else if (hex.startsWith('3026B275')) ext = 'wmv';
    else if (hex.startsWith('000001BA') || hex.startsWith('000001B3')) ext = 'mpg';

    // --- IMAGES & DESIGN ---
    else if (hex.startsWith('FFD8FF')) ext = 'jpeg';
    else if (hex.startsWith('89504E47')) ext = 'png';
    else if (hex.startsWith('47494638')) ext = 'gif';
    else if (hex.startsWith('38425053')) ext = 'psd';
    else if (hex.startsWith('52494646') && hex.substring(16, 24) === '57454250') ext = 'webp'; // RIFF + WEBP
    else if (hex.startsWith('49492A00') || hex.startsWith('4D4D002A')) ext = 'tif';
    else if (hex.startsWith('25504446')) ext = 'ai'; // Modern AI (PDF)
    else if (hex.startsWith('25215053')) ext = 'ai'; // Old AI (PostScript)

    // --- DOCUMENTS & ARCHIVES ---
    else if (hex.startsWith('504B0304')) ext = 'docx';
    else if (hex.startsWith('D0CF11E0')) ext = 'doc';
    else if (hex.startsWith('52617221')) ext = 'rar';
    else if (hex.startsWith('377ABCAF')) ext = '7z';

    // --- TEXT / CSV ---
    else {
        const isText = !buffer.slice(0, 50).some(byte => byte < 9 || (byte > 13 && byte < 32));
        if (isText) ext = 'csv';
    }

    const fullFileName = `${fileNameWithoutExt}.${ext}`;
    const finalPath = path.join(targetPath, fullFileName);

    try {
        await fs.mkdir(targetPath, { recursive: true });
        await fs.writeFile(finalPath, buffer);
        return { success: true, path: finalPath, extension: ext };
    } catch (err) {
        return { success: false, error: err.message };
    }
}


module.exports = {
    getMemoryStats,
    getFolderTree,
    readJsonFile,
    writeJsonFile,
    unzipFile,
    compressbackupfile,
    isFolderPath,
    makeDirectory,
    isfilepathwithext,
    isfilepath,
    clearFolderContents,
    deleteSingleFile,
    deletePath,
    saveBufferToFile,
}