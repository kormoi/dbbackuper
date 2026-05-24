const fncs = require('./functions');
const AdmZip = require("adm-zip");
const { count } = require('console');
const cstyler = require('cstyler');
const path = require('path');
const fs = require('fs').promises;
const v8 = require('v8');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const fsRaw = require('fs');







const SIGNATURES = [
    // --- IMAGES & DESIGN (Strict, zero-offset signatures first) ---
    { hex: '89504E47', ext: 'png' },
    { hex: 'FFD8FF', ext: 'jpeg' },
    { hex: '47494638', ext: 'gif' },
    { hex: '38425053', ext: 'psd' },
    { hex: '424D', ext: 'bmp' },
    { hex: '00000100', ext: 'ico' },
    { hex: '00000200', ext: 'cur' },
    { hex: '49492A00', ext: 'tif' },
    { hex: '4D4D002A', ext: 'tif' },
    { hex: '52494646', ext: 'webp', sub: { offset: 8, hex: '57454250' } },

    // --- WEB TEXT FORMATS (New Additions) ---
    { hex: '7B', ext: 'json' },             // Matches opening brace '{'
    { hex: '5B', ext: 'json' },             // Matches opening bracket '['
    { hex: '3C21444F4354595045', ext: 'html' }, // Matches '<!DOCTYPE'
    { hex: '3C68746D6C', ext: 'html' },     // Matches '<html'

    // --- DOCUMENTS & E-BOOKS ---
    { hex: '25504446', ext: 'pdf' },
    { hex: '504B0304', ext: 'docx', sub: { offset: 30, hex: '646F6378' } },
    { hex: '504B0304', ext: 'xlsx', sub: { offset: 30, hex: '786C7378' } },
    { hex: '504B0304', ext: 'zip' }, // Generic zip fallback placed safely after explicit docx/xlsx sub-checks
    { hex: 'D0CF11E0', ext: 'doc' },
    { hex: '7B5C727466', ext: 'rtf' },
    { hex: '49545346', ext: 'chm' },

    // --- ARCHIVES & INSTALLERS ---
    { hex: '52617221', ext: 'rar' },
    { hex: '377ABCAF', ext: '7z' },
    { hex: '1F8B', ext: 'gz' },
    { hex: '425A68', ext: 'bz2' },
    { hex: 'FD377A585A00', ext: 'xz' },
    { hex: '4D5A', ext: 'exe' },
    { hex: '7F454C46', ext: 'elf' },
    { hex: 'CAFEBABE', ext: 'class' },
    { hex: '213C617263683E', ext: 'deb' },

    // --- AUDIO ---
    { hex: '494433', ext: 'mp3' },
    { hex: 'FFF1', ext: 'aac' },
    { hex: 'FFF9', ext: 'aac' },
    { hex: '664C6143', ext: 'flac' },
    { hex: '4F676753', ext: 'ogg' },
    { hex: '2321414D52', ext: 'amr' },
    { hex: '4D546864', ext: 'mid' },
    { hex: '52494646', ext: 'wav', sub: { offset: 8, hex: '57415645' } },

    // --- VIDEOS & COMPLEX CONTAINERS (Pushed down due to offsets/loose matching) ---
    { hex: '1A45DFA3', ext: 'mkv' },
    { hex: '3026B275', ext: 'wmv' },
    { hex: '000001BA', ext: 'mpg' },
    { hex: '000001B3', ext: 'mpg' },
    { hex: '464C5601', ext: 'flv' },
    { hex: '52494646', ext: 'avi', sub: { offset: 8, hex: '41564920' } },
    { hex: '66747970', ext: 'mp4', offset: 4 },
    { hex: '667479707174', ext: 'mov', offset: 4 },
    { hex: '667479706D703432', ext: 'm4v', offset: 4 },
    { hex: '76425052', ext: 'heic', offset: 4 },
    { hex: '45505542', ext: 'epub', offset: 10 },

    // --- FONTS ---
    { hex: '00010000', ext: 'ttf' },
    { hex: '4F54544F', ext: 'otf' },
    { hex: '774F4646', ext: 'woff' },
    { hex: '774F4632', ext: 'woff2' }
];

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
async function getNextFileName(filepath) {
    let maxCount = 0;
    let folderPath = path.join(__dirname, filepath);
    const result = await getFolderTree(folderPath);
    if (!result) return null;
    for (const file of Object.values(result)) {
        let fileName = file.name;
        fileName = fileName.split(".").slice(0, -1).join("."); // Remove extension
        const num = parseInt(fileName, 10);

        // If it's a valid number and bigger than our current max, update max
        if (!isNaN(num) && num > maxCount) {
            maxCount = num;
        }
    }
    return maxCount + 1;
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

        return true;
    } catch (err) {
        // This usually triggers for permission issues (EACCES) 
        // or if the file is currently locked by another process (EBUSY)
        console.error(`Delete Error [${targetPath}]:`, err.message);
        console.error(`Delete Error code [${targetPath}]:`, err.code);
        return false;
    }
}

async function saveBufferToFile(buffer, folderPath, fileNameWithoutExt) {
    if (!Buffer.isBuffer(buffer)) throw new Error("Data must be a Buffer");

    let ext = 'bin';
    const headerHex = buffer.toString('hex', 0, 32).toUpperCase();

    // 2. Loop through the Map (Efficient)
    for (const sig of SIGNATURES) {
        const offset = (sig.offset || 0) * 2; // hex is 2 chars per byte
        const chunk = headerHex.substring(offset, offset + sig.hex.length);

        if (chunk === sig.hex) {
            ext = sig.ext;
            // Handle sub-signatures (like AVI vs WEBP which both start with RIFF)
            if (sig.sub) {
                const subOffset = sig.sub.offset * 2;
                const subChunk = headerHex.substring(subOffset, subOffset + sig.sub.hex.length);
                if (subChunk !== sig.sub.hex) continue;
            }
            break;
        }
    }

    // 3. Fallback: Text/CSV detection
    if (ext === 'bin') {
        const isText = !buffer.slice(0, 100).some(b => b < 9 || (b > 13 && b < 32));
        if (isText) ext = 'csv';
    }

    const fullPath = path.join(folderPath, `${fileNameWithoutExt}.${ext}`);

    // 4. Stream to disk (RAM Safe)
    try {
        await fs.promises.mkdir(folderPath, { recursive: true });
        return new Promise((resolve) => {
            const stream = fs.createWriteStream(fullPath);
            stream.on('error', (err) => resolve({ success: false, error: err.message }));
            stream.on('finish', () => resolve({ success: true, path: fullPath, extension: ext }));
            stream.end(buffer);
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}
async function saveDataToFile(data, folderPath, fileNameWithoutExt) {
    let buffer;
    let isOriginallyBuffer = Buffer.isBuffer(data);
    let isOriginallyHex = false;
    let isOriginallyPlainString = false;

    // 1. Adaptive Normalization
    if (isOriginallyBuffer) {
        buffer = data;
    } else if (typeof data === 'string') {
        const isDataUrl = data.startsWith('data:');

        if (isDataUrl && data.includes(';base64,')) {
            const base64Data = data.split(';base64,')[1];
            buffer = Buffer.from(base64Data, 'base64');
        }
        else if (/^[0-9A-Fa-f]+$/.test(data) && data.length % 2 === 0) {
            buffer = Buffer.from(data, 'hex');
            isOriginallyHex = true;
        }
        else if (!isDataUrl && /^[A-Za-z0-9+/]*={0,2}$/.test(data) && data.length % 4 === 0 && data.length > 64) {
            buffer = Buffer.from(data, 'base64');
        }
        // Intercepts normal prose text strings (e.g., "Hi how are you")
        else {
            buffer = Buffer.from(data, 'utf8');
            isOriginallyPlainString = true;
        }
    } else {
        throw new Error("Data must be a Buffer or a String");
    }

    // --- TEXT / PROSE STRING BYPASS LAYER ---
    // If it was a plain text string from the start, do not save a file. Return it immediately as text data.
    if (isOriginallyPlainString) {
        return { success: true, isText: true, data: data };
    }

    let ext = 'bin';
    const headerHex = buffer.toString('hex', 0, 256).toUpperCase();

    // 2. Linear Signature Discovery Layer
    for (const sig of SIGNATURES) {
        const targetHex = sig.hex.toUpperCase();
        const byteOffset = sig.offset || 0;
        const hexCharOffset = byteOffset * 2;

        const chunk = headerHex.substring(hexCharOffset, hexCharOffset + targetHex.length);

        if (chunk === targetHex) {
            ext = sig.ext;

            if (sig.sub) {
                const subByteOffset = sig.sub.offset || 0;
                const subHexCharOffset = subByteOffset * 2;
                const targetSubHex = sig.sub.hex.toUpperCase();

                const subChunk = headerHex.substring(subHexCharOffset, subHexCharOffset + targetSubHex.length);

                if (subChunk === targetSubHex) {
                    break;
                } else {
                    break;
                }
            }
            break;
        }
    }

    // --- STRATEGIC CATCH-ALL ROUTING (For files that must be saved) ---
    if (ext === 'bin') {
        if (isOriginallyBuffer) {
            ext = 'dat'; // Raw unmatched buffer saves as a functional data file
        } else if (isOriginallyHex) {
            ext = 'hex'; // Raw unmatched hex code string saves as a hex file
        } else {
            // Backup catch-all for any decoded binary content that evaluates as text characters
            const isText = !buffer.slice(0, 100).some(b => b < 9 || (b > 13 && b < 32));
            if (isText) {
                return { success: false, isText: true, data: buffer.toString('utf8') };
            }
            ext = 'dat';
        }
    }

    const fullPath = path.join(folderPath, `${fileNameWithoutExt}.${ext}`);

    // 4. Unified Safe File Stream Execution Block
    try {
        await fs.mkdir(folderPath, { recursive: true });

        await pipeline(
            Readable.from(buffer),
            fsRaw.createWriteStream(fullPath)
        );

        return { success: true, path: fullPath, extension: ext };

    } catch (err) {
        return { success: false, error: err.message };
    }
}
/**
 * Reads a file and converts it to Base64 with a RAM safety check.
 */
async function fileToBase64(filePath) {
    try {
        // 1. Get file size first without loading it
        const stats = await fs.stat(filePath);
        const fileSize = stats.size;
        const freeRAM = os.freemem();

        // 2. Safety Check: Do we have enough RAM for Buffer + String + Overhead?
        // We need roughly 3x the file size in free RAM to be safe.
        if (fileSize * 3 > freeRAM) {
            throw new Error(`File is too large (${(fileSize / 1024 / 1024).toFixed(2)}MB) for the current available RAM.`);
        }

        // 3. Read and convert
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString('base64');

        return base64;
    } catch (err) {
        console.error("Base64 Conversion Error:", err.message);
        return null;
    }
}
// lets get file name on the folder that were set as count
async function getUniqueFilePath(folderPath, fileName, ext) {
    let fullPath = path.join(folderPath, `${fileName}.${ext}`);
    let counter = 1;

    // Check if file exists, if so, add (1), (2), etc.
    while (fs.existsSync(fullPath)) {
        fullPath = path.join(folderPath, `${fileName}_${counter}.${ext}`);
        counter++;
    }
    return fullPath;
}
module.exports = {
    SIGNATURES,
    getMemoryStats,
    getFolderTree,
    getNextFileName,
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
    saveDataToFile,
    fileToBase64,
    getUniqueFilePath
}