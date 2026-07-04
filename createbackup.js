const getmtd = require('./getmetadata');
const fncs = require('./functions');
const cstyler = require('cstyler');
const path = require("path");
const links = require("./links.js");
const checkdisk = require("./checkdiskspace.js");
const ff = require("./filefunctions.js");
const rows = require("./getrows.js");





async function copyFiles(folderTree, destinationFolder) {
    try {
        for (const item of Object.keys(folderTree)) {
            const folderContent = folderTree[item];
            if (Object.hasOwn(folderContent, "contents") && fncs.isJsonObject(folderContent.contents)) {
                const mkdir = await ff.makeDirectory(destinationFolder);
                if (mkdir === null) {
                    throw new Error("Unable to create folder.");
                }
                const recurse = await copyFiles(folderContent.contents, destinationFolder);
                if (recurse === null) {
                    return null;
                }
            } else {
                const copyFile = await ff.copyFileToFolder(folderContent.path, destinationFolder);
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
// if database list is empty then it gets checked by metadata giver funciton
async function createbackup(config, outputpath = null, fullBackup = false, dbs = [], forceDownload = false) {
    try {
        console.log(cstyler.bold("Let's check disk space first to check if we can run the backup or not."));
        const cdsk = await checkdisk.checkDiskSpace(config, dbs, fullBackup);
        if (cdsk.success !== true) {
            throw new Error(cdsk.message);
        }
        // Lets delete folder if exist
        const deleteMain = await ff.deletePath(links.main);
        if (!deleteMain) {
            throw new Error("Unable to work on file directory. Pleae check permission.");
        }
        // lets make sure we have the output directory
        const mkd1 = await ff.makeDirectory(links.programfiles);
        const mkd2 = await ff.makeDirectory(links.databasefiles);
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
            await ff.deletePath(links.main);
            throw new Error(cstyler.red.bold("Could not retrieve row data. Backup creation failed."));
        }
        console.log(cstyler.green("Row data retrieved and written to files."));
        const rootPath = await ff.getApplicationRoot();
        if (fullBackup) {
            // Lets create file backup
            const getFolderTree = await ff.getFolderTree(rootPath);
            delete getFolderTree['.git'];
            delete getFolderTree.node_modules;
            const fileBackup = await copyFiles(getFolderTree, links.programfiles);
            if (fileBackup === null) {
                throw new Error("Unable to copy files from directory to zip them.");
            }
        }
        // If we have an output path, we will zip all the files and move the zip to the output path
        if (!outputpath) {
            outputpath = rootPath;
        }

        // Lets check folder directory
        const isFolder = await ff.isFolderPath(outputpath);
        if (isFolder === null) {
            const folderPath = path.dirname(outputpath);
            const createFolder = ff.makeDirectory(folderPath);
            if (createFolder === null) {
                console.error("Unable to create folder to given path.");
                outputpath = rootPath;
            }
        } else if (isFolder === false) {
            outputpath = path.dirname(outputpath);
        }
        let count = 0;
        let fileNameWD = `backup_${fncs.getDateTime("_").date}__by_dbbackuper.zip`;
        while (true) {
            if (count > 0) {
                fileNameWD = `backup_${fncs.getDateTime("_").date}__by_dbbackuper_${count}.zip`;
            }
            console.log(path.join(outputpath, fileNameWD))
            const fileExist = await ff.isfilepath(path.join(outputpath, fileNameWD), '.zip');
            console.log('outputpath', outputpath)
            if (fileExist !== true) {
                break;
            }
            count++;
        }
        const zipResult = await ff.zipFile(links.main, path.join(outputpath, fileNameWD));
        if (!zipResult) {
            throw new Error(cstyler.bold.red("Could not create zip file. Please check permissions and try again."));
        }
        console.log(cstyler.bold.underline.green(`Successfully completed the backup '${outputpath}'`));

        await ff.deletePath(links.main);
        return true;
    } catch (err) {
        console.error("Backup creation failed:", err);
        return null;
    }
}

module.exports = {
    createbackup
};