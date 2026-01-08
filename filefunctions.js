const fncs = require('./functions');
const AdmZip = require("adm-zip");
const fs = require("fs/promises");  // Importing fs.promises for async operations
const path = require("path");
const cstyler = require('cstyler');








async function getLastSavedFile(directory) {
    try {
        // Read the directory
        const files = await fs.readdir(directory);

        // Handle empty directory
        if (files.length === 0) {
            throw new Error(`No files found in the directory: ${directory}`);
        }

        // Get file stats and sort by modification time
        const fileStats = await Promise.all(
            files.map(async (file) => {
                const filePath = path.join(directory, file);
                const stats = await fs.stat(filePath);
                return { file, stats };
            })
        );

        const sortedFiles = fileStats.sort((a, b) => b.stats.mtime - a.stats.mtime);

        // Return the most recently saved file
        const lastSavedFile = sortedFiles[0]?.file; // Use optional chaining
        return lastSavedFile;
    } catch (err) {
        console.error(
            `Error getting last saved file from directory "${directory}": ${err.message}`
        );
        return null; // Return `null` if an error occurs
    }
}
async function compareJsonFiles(filePath1, filePath2) {
    try {
        // Ensure both files exist
        await fs.access(filePath1);
        await fs.access(filePath2);

        // Read the content of both files
        const fileContent1 = await fs.readFile(filePath1, "utf-8");
        const fileContent2 = await fs.readFile(filePath2, "utf-8");

        // Check if either file is empty
        if (!fileContent1.trim()) {
            console.error("File 1 is empty.");
            return false;
        }
        if (!fileContent2.trim()) {
            console.error("File 2 is empty.");
            return false;
        }

        // Parse the JSON content of both files
        let jsonData1, jsonData2;
        try {
            jsonData1 = JSON.parse(fileContent1);
        } catch (parseError) {
            console.error("Failed to parse File 1:", parseError.message);
            return false;
        }

        try {
            jsonData2 = JSON.parse(fileContent2);
        } catch (parseError) {
            console.error("Failed to parse File 2:", parseError.message);
            return false;
        }

        // Compare the two JSON objects using deepEqual
        const isEqual = JSON.stringify(jsonData1) === JSON.stringify(jsonData2);
        console.log("Are the JSON files equal?", isEqual);
        return isEqual;
    } catch (error) {
        // Log specific errors
        if (error.code === "ENOENT") {
            console.warn(`File not found: ${error.path}`);
            return false;
        } else {
            console.error("Error comparing JSON files:", error.message);
            return null;
        }
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
const writeJsFile = async (filePath, content) => {
    try {
        await fs.access(filePath).catch(() => fs.mkdir(path.dirname(filePath), { recursive: true }));
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`File written successfully to ${filePath}`);
        return true;
    } catch (error) {
        console.error(`Error writing file at ${filePath}:`, error);
        return null;
    }
};

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

        console.log(`Successfully extracted to: ${targetDir}`);
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
        let text = `module.exports = ${(fncs.stringifyAny(data))}`;
        const soursePath = path.join(path, "./backup.js");
        const writejs = await writeJsFile(soursePath, text);
        if (writejs === null) {
            return null;
        }
        const zipfile = zipFile(soursePath, path);
        if (zipfile === null) {
            return null;
        }
        console.log("Successfully zipped the file.");
        // lets delete file
        try {
            await fs.unlink(soursePath);
        } catch (err) {
            console.error(err.message);
        }
        return true;
    } catch (err) {
        console.error(err.message);
        return null;
    }
}