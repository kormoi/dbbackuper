const getmtd = require('./getmetadata');
const fncs = require('./functions');
const cstyler = require('cstyler');
const path = require("path");
const fs = require("fs");
const links = require("./links.js");

const checkdisk = require("./checkdiskspace.js");
const fileFunc = require("./filefunctions.js");
const rows = require("./getrows.js");


async function copyFiles(folderTree, destinationFolder) {
    try {
        for (const item of Object.keys(folderTree)) {
            const folderContent = folderTree[item];
            if (Object.hasOwn(folderContent, "contents") && fncs.isJsonObject(folderContent.contents)) {
                const destinationPath = path.resolve(path.join(destinationFolder, item));
                const mkdir = await fileFunc.makeDirectory(destinationPath);
                if (mkdir === null) {
                    throw new Error("Unable to create folder.");
                }
                const recurse = await copyFiles(folderContent.contents, destinationPath);
                if (recurse === null) {
                    return null;
                }
            } else {
                const copyFile = await fileFunc.copyFileToFolder(folderContent.path, destinationFolder);
                if (copyFile.success === false) {
                    throw new Error(copyFile.message);
                }
            }
        }
        return true;
    } catch (err) {
        console.error("Unable to copy files. Error message: ", err.message);
        return null;
    }
}
async function createbackup(config, dbs = [], forceDownload = false, outputpath = null, fullBackup = true) {
    try {
        console.log(cstyler.bold("Let's check disk space first to check if we can run the backup or not."));
        const cdsk = await checkdisk.checkDiskSpace(config, dbs, fullBackup);
        if (cdsk.success !== true) {
            throw new Error(cdsk.message);
        }
        // Lets delete folder if exist
        const deleteMain = await fileFunc.deletePath(links.main);
        if (!deleteMain) {
            throw new Error("Unable to work on file directory. Pleae check permission.");
        }
        // lets make sure we have the output directory
        const mkd1 = await fileFunc.makeDirectory(links.programfiles);
        const mkd2 = await fileFunc.makeDirectory(links.databasefiles);
        if (!mkd1 || !mkd2) {
            throw new Error(cstyler.red.bold("Could not create output directory. Please check permissions and try again."));
        }
        // get metadata
        const metadata = await getmtd.getmetadata(config, dbs);
        if (!fncs.isJsonObject(metadata)) {
            throw new Error(cstyler.red.bold("Could not retrieve metadata. Backup creation failed."));
        }
        if (metadata.dbtaskerdata === null && metadata.raw === null) {
            throw new Error(cstyler.red.bold("No valid data to backup."));
        }
        console.log(cstyler.green("Metadata written to file."));

        // Lets get all the row data for each table and write them to files
        const rowDataResult = await rows.getallrows(config, metadata.raw, forceDownload);
        if (rowDataResult !== true) {
            await fileFunc.deletePath(links.main);
            throw new Error(cstyler.red.bold("Could not retrieve row data. Backup creation failed."));
        }
        console.log(cstyler.green("Row data retrieved and written to files."));
        const rootPath = await fileFunc.getApplicationRoot();
        if (fullBackup) {
            // Lets create file backup
            const getFolderTree = await fileFunc.getFolderTree(rootPath);
            delete getFolderTree['.git'];
            delete getFolderTree.node_modules;
            const fileBackup = await copyFiles(getFolderTree, links.programfiles);
            if (fileBackup === null) {
                throw new Error("Unable to copy files from directory to zip them.");
            }
        }
        let returnData = false;
        // If we have an output path, we will zip all the files and move the zip to the output path
        if (outputpath) {
            // Lets check folder directory
            const isFolder = await fileFunc.isFolderPath(outputpath);
            if(isFolder === null){
                const folderPath = path.dirname(outputpath);
                const createFolder = fileFunc.makeDirectory(folderPath);
                if(createFolder === null){
                    console.error("Unable to create folder to given path.");
                    outputpath = rootPath;
                }
            } else if(isFolder === false){
                outputpath = path.dirname(outputpath);
            }
            const zipResult = await fileFunc.zipFile("./backupfiles/backup", path.join(outputpath, 'backup.zip'));
            if (!zipResult) {
                throw new Error(cstyler.bold.red("Could not create zip file. Please check permissions and try again."));
            }
            console.log(cstyler.bold.underline.green(`Successfully completed the backup '${outputpath}'`));
            returnData = true;
        } else {
            const zipResult = await fileFunc.zipFile("./backupfiles/backup", path.join(rootPath, 'backup.zip'));
            if (!zipResult) {
                throw new Error(cstyler.bold.red.bold("Could not create zip file. Please check permissions and try again."));
            }
            console.log(cstyler.bold.underline.green("Successfully completed the backup './backupfiles/backup'"));
            returnData = true;
        }
        await fileFunc.deletePath(links.main);
        return returnData;
    } catch (err) {
        console.error("Backup creation failed:", err);
        return null;
    }
}

module.exports = {
    createbackup
};