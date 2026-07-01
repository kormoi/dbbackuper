const fncs = require('./functions');
const { count } = require('console');
const cstyler = require('cstyler');
const path = require('path');
const fs = require('fs').promises;
const v8 = require('v8');
const os = require('os');
const fsRaw = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises'); // Already a promise!





/**
 * @param {MEMORY RAM PROBLEM solved} on_checking_variable_size
 * @param {calculating memory ram} - is using extra ram
 * @param {differant idea} memory We will store available memory before store data in variable
 * @param {next move} then we will check available memory after we store data
 * @returns 
 */

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
function getMemoryPercent() {
    const stats = v8.getHeapStatistics();
    const heapLimit = stats.heap_size_limit / 1024 / 1024; // Convert to MB
    const usedHeap = stats.used_heap_size / 1024 / 1024;
    return (usedHeap * 100 / heapLimit);
}
function getMemoryHeaps() {
    const stats = v8.getHeapStatistics();

    // 1. Calculate capacities in Megabytes (MB)
    const heapLimitMB = stats.heap_size_limit / 1024 / 1024;
    const usedHeapMB = stats.used_heap_size / 1024 / 1024;

    // 2. Subtract used memory from the absolute limit to find available space
    const availableHeapMB = heapLimitMB - usedHeapMB;

    // 3. Compute the active usage percentage
    const usedPercent = (usedHeapMB * 100) / heapLimitMB;

    // Return the processed memory metrics object
    return {
        usedMB: parseFloat(usedHeapMB.toFixed(2)),          // Memory actively being consumed
        availableMB: parseFloat(availableHeapMB.toFixed(2)),// Memory remaining before a crash
        limitMB: parseFloat(heapLimitMB.toFixed(2)),        // Total memory allocated to Node process
        percentage: parseFloat(usedPercent.toFixed(2))       // Usage ratio (e.g., 14.52%)
    };
}
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
function getVariableRAMSizeInMB(variable) {
    try {
        // Generates a binary buffer mimicking V8's internal heap representation
        const buffer = v8.serialize(variable);
        return buffer.length / (1024 * 1024);
    } catch (err) {
        // Handles edge cases like circular references that cannot be evaluated cleanly
        console.error("Failed to measure variable RAM footprint:", err.message);
        return 0;
    }
}
async function getApplicationRoot() {
    // 1. Fallback Option: Get the directory where the node process was initialized.
    // In 95% of standard production environments, this will point directly to the app root.
    let currentDir = process.cwd();

    // 2. Traversal Loop: Walk up directories looking for the master package.json file
    while (currentDir) {
        try {
            const packageJsonPath = path.join(currentDir, 'package.json');

            // Check if package.json exists in the current directory level
            await fs.access(packageJsonPath);

            // Double check that we aren't stopping inside our own module's folder structure
            if (!currentDir.includes('node_modules')) {
                return currentDir;
            }
        } catch (e) {
            // package.json wasn't found at this level, continue climbing up
        }

        const parentDir = path.dirname(currentDir);

        // If we hit the root filesystem anchor (e.g. "/" or "C:\"), break out of the loop
        if (parentDir === currentDir) {
            break;
        }

        currentDir = parentDir;
    }

    // Secondary safe fallback if the traversal loop somehow runs out of steps
    return process.cwd();
}
async function getFolderTree(dirPath) {
    const maxRetries = 3;
    const tree = {};
    const absoluteDirPath = path.resolve(dirPath);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const items = await fs.readdir(absoluteDirPath);

            for (const item of items) {
                const fullPath = path.join(absoluteDirPath, item);
                const stats = await fs.stat(fullPath);
                const isDirectory = stats.isDirectory();

                tree[item] = {
                    name: item,
                    path: fullPath, // Guaranteed absolute
                    type: isDirectory ? 'folder' : 'file',
                    size: stats.size,
                    extension: isDirectory ? null : path.extname(item)
                };

                // Recursively get contents if it's a folder
                if (isDirectory) {
                    const nestedContents = await getFolderTree(fullPath);
                    // If a nested crawl completely failed, we forward null or keep moving
                    tree[item].contents = nestedContents;
                }
            }

            // 🏁 Success! Return the tree layout object and exit the loop.
            return tree;

        } catch (err) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed reading directory ${absoluteDirPath}: ${err.message}`);

            if (attempt < maxRetries) {
                // Wait 1 second before trying to read the directory structure again
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                // All 3 tries failed completely
                console.error(`❌ All attempts failed. Error reading directory ${absoluteDirPath}:`, err.message);
                return null;
            }
        }
    }
}
async function getNextFileName(filepath) {
    let maxCount = 0;
    let folderPath = path.resolve(filepath);
    const ifFolder = await isFolderPath(folderPath);
    if (ifFolder === null) {
        const mkdir = makeDirectory(folderPath);
        if (mkdir === null) {
            return null;
        }
    } else if (ifFolder === false) {
        folderPath = path.dirname(folderPath);
    }
    const result = await getFolderTree(folderPath);
    if (result === null) return null;
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
async function readFileSafely(filePath, asArray = false) {
    try {
        const resolvedPath = path.resolve(filePath);

        // Read the file with standard UTF-8 string encoding
        const rawContent = await fs.readFile(resolvedPath, 'utf-8');

        if (!asArray) {
            return rawContent;
        }

        // Parse ignore file lines: split, clean whitespace, remove comments
        return rawContent
            .split(/\r?\n/) // Split by newline (handles Windows \r\n and Unix \n)
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'));

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`⚠️ File not found: ${filePath}`);
        } else {
            console.error(`❌ Error reading file at ${filePath}:`, error.message);
        }
        return null;
    }
}
async function readJsonFile(filePath) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed reading JSON file at ${filePath}: ${error.message}`);

            // If it's a structural error (e.g., not a JSON extension or invalid JSON syntax), 
            // retrying won't change the outcome, but we still respect the 3-try loop for disk safety.
            if (attempt < maxRetries) {
                // Cool down 1 second before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed reading or parsing JSON file at ${filePath}:`, error);
                return null;
            }
        }
    }
}
async function writeJsonFile(filePath, data) {
    const maxRetries = 3;

    // 💡 DEFENSIVE CHECK: Break immediately if path is an existing directory
    try {
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            const fileName = await getNextFileName(filePath);
            if (fileName === null) {
                console.error("Having problem getting next file name.");
                return null;
            }
            filePath = path.join(filePath, `${String(fileName)}.json`);
            console.log("filepath if undefined:", filePath)
        }
    } catch (e) {
        // Path doesn't exist yet, which is perfect! Proceed safely.
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });

            const jsonString = JSON.stringify(data, null, 2);
            await fs.writeFile(filePath, jsonString, "utf-8");

            return true;
        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed writing JSON file at ${filePath}: ${error.message}`);

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All attempts failed. Error writing JSON file at ${filePath}:`, error);
                return null;
            }
        }
    }
}
async function zipFile(sourcePath, outPath) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // 1. Dynamically import the archiver ESM module
            const archiverModule = await import('archiver');

            // 2. Safely grab ZipArchive directly from the module namespace
            const ZipArchive = archiverModule.ZipArchive || archiverModule.default?.ZipArchive;

            if (!ZipArchive) {
                throw new Error("Could not find the ZipArchive constructor in the archiver module.");
            }

            // 3. Establish the direct disk write stream using fsRaw
            const outputStream = fsRaw.createWriteStream(outPath);

            // 4. Instantiate the specialized Zip stream engine directly
            const archive = new ZipArchive({ zlib: { level: 9 } });

            // 5. Inspect if the target source path is a file or directory
            const stats = fsRaw.statSync(sourcePath);
            if (stats.isDirectory()) {
                archive.directory(sourcePath, false);
            } else {
                const fileName = path.basename(sourcePath);
                archive.file(sourcePath, { name: fileName });
            }

            // 6. Trigger finalization background processing pipeline
            const archivePromise = archive.finalize();

            // 7. Stream chunks straight to the file system using pipeline
            await pipeline(archive, outputStream);
            await archivePromise;

            console.log(`Successfully zipped: ${outPath}`);
            return true;

        } catch (e) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed compressing archive: ${e.message}`);

            // Clean up incomplete or broken zip file targets on failure
            try {
                if (fsRaw.existsSync(outPath)) {
                    await fs.promises.unlink(outPath);
                }
            } catch (_) { }

            if (attempt < maxRetries) {
                // Cool down 1 second before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed creating zip file:`, e.message);
                return null;
            }
        }
    }
}
async function unzipFile(zipFilePath, destinationFolderPath) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(1);
            const unzipperModule = await import('unzipper');
            console.log(2);
            const unzipper = unzipperModule.default || unzipperModule;
            console.log(3);

            const srcPath = path.resolve(zipFilePath);
            const destFolder = path.resolve(destinationFolderPath);

            console.log(4);
            // Ensure target folder directory exists
            await fs.mkdir(destFolder, { recursive: true });
            console.log(5);

            console.log(6);
            // FIXED: Open the zip file directly using unzipper's robust promise layer
            const directory = await unzipper.Open.file(srcPath);
            console.log(7);

            console.log(8);
            // Extract everything cleanly using the engine's native promise tracker
            await directory.extract({ path: destFolder });
            console.log(9); // This will now fire perfectly!

            console.log(`Successfully extracted archive to: ${destinationFolderPath}`);
            return true;

        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed extracting archive: ${error.message}`);

            // Clean up the partially extracted destination folder on failure to avoid corruption
            try {
                const destFolder = path.resolve(destinationFolderPath);
                await fs.rm(destFolder, { recursive: true, force: true });
            } catch (_) { }

            if (attempt < maxRetries) {
                // Cool down 1 second before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed extracting file:`, error.message);
                return null;
            }
        }
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
/**
 * return true if exist, false if file, null if not exist
 */
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
    if (typeof ext !== "string") return null;

    // FIXED: Ensure the extension string always has exactly one leading dot
    const exten = ext.startsWith(".") ? ext.toLowerCase() : "." + ext.toLowerCase();

    // 1. Check extension first (fast)
    const matchesExt = path.extname(filePath).toLowerCase() === exten;
    if (!matchesExt) return false;

    try {
        // 2. Check if it actually exists and is a file (not a folder named "test.zip")
        const stats = await fs.stat(filePath);
        return stats.isFile();
    } catch (err) {
        // If file doesn't exist, return null
        return null;
    }
}
/**
 * checks if it is a file path or not and also if file or not
 */
async function isfilepath(filePath) {
    try {
        filePath = path.resolve(filePath);
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
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // 'recursive: true' handles nested folders/files
            // 'force: true' prevents errors if the path doesn't exist
            await fs.rm(targetPath, { recursive: true, force: true });

            // 🏁 Success! The path was deleted or didn't exist to begin with.
            return true;

        } catch (err) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed to delete [${targetPath}]: ${err.message}`);

            if (attempt < maxRetries) {
                // Wait 1 second to let OS locks (EBUSY / EACCES) clear out before trying again
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                // All 3 tries failed completely
                console.error(`❌ All attempts failed. Delete Error [${targetPath}]:`, err.message);
                console.error(`❌ Delete Error code [${targetPath}]:`, err.code);
                return false;
            }
        }
    }
}
async function copyFileToFolder(sourceFilePath, destinationFolderPath) {
    try {
        // 1. Resolve absolute paths to keep pathing consistent
        const srcPath = path.resolve(sourceFilePath);
        const destFolder = path.resolve(destinationFolderPath);

        // 2. Extract the file name from the source path to build the new full path
        const fileName = path.basename(srcPath);
        const destFilePath = path.join(destFolder, fileName);

        // 3. Ensure the target directory exists (creates it recursively if missing)
        await fs.mkdir(destFolder, { recursive: true });

        // 4. Perform the copy operation
        // Using COPYFILE_EXCL is an optional flag that prevents overwriting an existing file
        await fs.copyFile(srcPath, destFilePath);

        console.log(`[${cstyler.green("Success")}] ${cstyler.yellow("Copied")} "${cstyler.blue(fileName)}" to ${cstyler.green(destinationFolderPath)}`);
        return { success: true, destinationPath: destFilePath };

    } catch (error) {
        console.error(`[Copy Error]:`, error.message);
        return { success: false, message: error.message };
    }
}
async function getCustomFileSizesSumInMB(pathsToCalculate, excludeList = []) {
    try {
        if (!Array.isArray(pathsToCalculate)) {
            throw new Error("The first parameter must be an array of paths.");
        }

        const absoluteExcludes = new Set(excludeList.map(p => path.resolve(p)));
        const filesBreakdown = {};
        let totalSizeInBytes = 0; // Tracking raw bytes for accuracy prior to division

        // Recursive scanner function
        async function scanPath(currentPath) {
            const absoluteCurrent = path.resolve(currentPath);

            // Halt if this path branch is blacklisted
            if (absoluteExcludes.has(absoluteCurrent)) {
                return;
            }

            try {
                const stats = await fs.stat(absoluteCurrent);

                if (stats.isFile()) {
                    totalSizeInBytes += stats.size;

                    const sizeInMB = stats.size / (1024 * 1024);
                    filesBreakdown[absoluteCurrent] = `${Number(sizeInMB.toFixed(2))} MB`;
                }
                else if (stats.isDirectory()) {
                    const entries = await fs.readdir(absoluteCurrent);
                    await Promise.all(
                        entries.map(entry => scanPath(path.join(absoluteCurrent, entry)))
                    );
                }
            } catch (err) {
                console.warn(`⚠️ Skipping inaccessible target: ${absoluteCurrent} (${err.message})`);
            }
        }

        // Process all target entry arrays
        await Promise.all(pathsToCalculate.map(p => scanPath(p)));

        // Calculate the absolute total sum representation
        const totalSumInMB = totalSizeInBytes / (1024 * 1024);

        return {
            files: filesBreakdown,
            totalSum: Number(totalSumInMB.toFixed(2)),
            unit: "MB"
        };

    } catch (error) {
        console.error(`❌ Failed to calculate target file metrics:`, error.message);
        return null;
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
            const stream = fsRaw.createWriteStream(fullPath);
            stream.on('error', (err) => resolve({ success: false, error: err.message }));
            stream.on('finish', () => resolve({ success: true, path: fullPath, extension: ext }));
            stream.end(buffer);
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}
function createStringDecoderStream(encoding) {
    let internalBuffer = '';
    return new Transform({
        transform(chunk, _, callback) {
            let chunkStr = chunk.toString('utf8');
            if (encoding === 'base64') {
                internalBuffer += chunkStr;
                const printableLength = Math.floor(internalBuffer.length / 4) * 4;
                if (printableLength > 0) {
                    const toProcess = internalBuffer.slice(0, printableLength);
                    internalBuffer = internalBuffer.slice(printableLength);
                    this.push(Buffer.from(toProcess, 'base64'));
                }
            } else if (encoding === 'hex') {
                internalBuffer += chunkStr;
                const printableLength = Math.floor(internalBuffer.length / 2) * 2;
                if (printableLength > 0) {
                    const toProcess = internalBuffer.slice(0, printableLength);
                    internalBuffer = internalBuffer.slice(printableLength);
                    this.push(Buffer.from(toProcess, 'hex'));
                }
            } else {
                this.push(Buffer.from(chunkStr, 'utf8'));
            }
            callback();
        },
        flush(callback) {
            if (internalBuffer.length > 0) {
                this.push(Buffer.from(internalBuffer, encoding));
            }
            callback();
        }
    });
}
function createSignatureSnifferStream(SIGNATURES, onExtensionFound) {
    let headerBuffer = Buffer.alloc(0);
    let matched = false;

    return new Transform({
        transform(chunk, encoding, callback) {
            if (!matched && headerBuffer.length < 64) {
                headerBuffer = Buffer.concat([headerBuffer, chunk]);

                if (headerBuffer.length >= 64 || chunk.length < 64) {
                    let ext = 'bin';

                    for (const sig of SIGNATURES) {
                        const targetHex = sig.hex.toUpperCase();
                        const byteOffset = sig.offset || 0;

                        if (headerBuffer.length >= (byteOffset + (targetHex.length / 2))) {
                            const chunkHex = headerBuffer.toString('hex', byteOffset, byteOffset + (targetHex.length / 2)).toUpperCase();

                            if (chunkHex === targetHex) {
                                ext = sig.ext;
                                if (sig.sub) {
                                    const subByteOffset = sig.sub.offset || 0;
                                    const targetSubHex = sig.sub.hex.toUpperCase();
                                    const subChunkHex = headerBuffer.toString('hex', subByteOffset, subByteOffset + (targetSubHex.length / 2)).toUpperCase();
                                    if (subChunkHex === targetSubHex) {
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                    }

                    onExtensionFound(ext, headerBuffer);
                    matched = true;
                }
            }
            this.push(chunk);
            callback();
        }
    });
}
async function saveDataToFile(data, folderPath, fileNameWithoutExt) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let isOriginallyBuffer = Buffer.isBuffer(data);
        let isOriginallyHex = false;
        let detectedExt = 'dat';
        let tmpPath = '';

        try {
            let sourceStream;
            let decoderStream = null;

            // 1. Process Input Types
            if (isOriginallyBuffer) {
                sourceStream = Readable.from(data);
            } else if (typeof data === 'string') {
                let cleaningData = data;
                let targetEncoding = 'utf8';

                if (cleaningData.startsWith('data:') && cleaningData.includes(';base64,')) {
                    cleaningData = cleaningData.split(';base64,')[1];
                    targetEncoding = 'base64';
                } else if (/^[0-9A-Fa-f]+$/.test(cleaningData.slice(0, 100)) && cleaningData.length % 2 === 0) {
                    targetEncoding = 'hex';
                    isOriginallyHex = true;
                } else if (/^[A-Za-z0-9+/]*={0,2}$/.test(cleaningData.slice(0, 100))) {
                    // FIXED: Executing the ternary condition cleanly without string wrappers
                    targetEncoding = cleaningData.length > 64 ? "base64" : "utf8";
                }

                if (targetEncoding === 'utf8') {
                    detectedExt = 'txt';
                }

                sourceStream = Readable.from(cleaningData);

                if (targetEncoding !== 'utf8') {
                    decoderStream = createStringDecoderStream(targetEncoding);
                }
            } else {
                throw new Error("Data must be a Buffer or a String");
            }

            // 2. Sniffer Layer
            const snifferStream = createSignatureSnifferStream(SIGNATURES, (ext, headerBuf) => {
                if (ext === 'bin') {
                    const isText = !headerBuf.slice(0, 100).some(b => b < 9 || (b > 13 && b < 32));
                    detectedExt = isText ? 'txt' : 'dat';
                } else {
                    detectedExt = ext;
                }
            });

            // 3. Setup File Paths
            await fs.mkdir(folderPath, { recursive: true });
            tmpPath = path.join(folderPath, `${fileNameWithoutExt}.tmp`);
            const writeStream = fsRaw.createWriteStream(tmpPath);

            // 4. Pipe everything safely using native promise pipeline
            if (decoderStream) {
                await pipeline(sourceStream, decoderStream, snifferStream, writeStream);
            } else {
                await pipeline(sourceStream, snifferStream, writeStream);
            }

            // 5. Finalize file name with the newly verified extension
            const finalPath = path.join(folderPath, `${fileNameWithoutExt}.${detectedExt}`);
            await fs.rename(tmpPath, finalPath);

            // 🏁 Success! Return file information and leave retry loop
            return { success: true, path: finalPath, fileName: `${fileNameWithoutExt}.${detectedExt}`, extension: detectedExt };

        } catch (err) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed saving data to file: ${err.message}`);

            // Clean up left behind temporary files on failure so it doesn't leave clutter
            if (tmpPath) {
                try { await fs.unlink(tmpPath); } catch (_) { }
            }

            if (attempt < maxRetries) {
                // Cool down 1 second before opening clean new streams
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed saving data to file:`, err.message);
                return null;
            }
        }
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
async function fileToBuffer(targetFilePath) {
    try {
        // 1. Resolve to an absolute path to avoid relative directory issues
        const absolutePath = path.resolve(targetFilePath);

        // 2. Verify the file actually exists before trying to read it
        try {
            await fs.access(absolutePath);
        } catch {
            throw new Error(`File not found at path: ${absolutePath}`);
        }

        // 3. Read the file into a raw binary buffer (No encoding specified = raw bytes)
        const fileBuffer = await fs.readFile(absolutePath);

        return fileBuffer;

    } catch (error) {
        console.error(`[fileToBuffer Error]:`, error.message);
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
    getMemoryPercent,
    getMemoryHeaps,
    getMemoryStats,
    getVariableRAMSizeInMB,
    getApplicationRoot,
    getFolderTree,
    getNextFileName,
    readFileSafely,
    readJsonFile,
    writeJsonFile,
    zipFile,
    unzipFile,
    compressbackupfile,
    isFolderPath,
    makeDirectory,
    isfilepathwithext,
    isfilepath,
    clearFolderContents,
    deleteSingleFile,
    deletePath,
    copyFileToFolder,
    getCustomFileSizesSumInMB,
    saveBufferToFile,
    saveDataToFile,
    fileToBase64,
    fileToBuffer,
    getUniqueFilePath,
}