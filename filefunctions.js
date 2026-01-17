const fncs = require('./functions');
const AdmZip = require("adm-zip");
const { count } = require('console');
const cstyler = require('cstyler');
const path = require('path');
const fs = require('fs').promises;









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
async function isfilepath(filePath, ext = ".zip") {
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



module.exports = {
    readJsonFile,
    writeJsonFile,
    unzipFile,
    compressbackupfile,
    isFolderPath,
    makeDirectory,
    isfilepath,
    clearFolderContents,
    deleteSingleFile,
}