const getmetadata = require('./getmetadata');
const fncs = require('./functions');
const cstyler = require('cstyler');
const path = require("path");
const fs = require("fs");
const links = require("./links.js");

const filefunc = require("./filefunctions.js");
const getmetadata = require("./getmetadata");
const rows = require("./rows.js");



async function createbackup(config, dbs = [], outputpath = null) {
    try {
        // lets make sure we have the output directory
        const 
        const result = await filefunc.makeDirectory(links.programfiles);
        if(!result) {
            throw new Error(cstyler.red.bold("Could not create output directory. Please check permissions and try again."));
        }
        // lets clean the folder if there are files in it
        const cleanresult = await filefunc.clearFolderContents(links.programfiles);
        if(!cleanresult) {
            throw new Error(cstyler.red.bold("Could not clean output directory. Please check permissions and try again."));
        }
        // get metadata
        const metadata = await getmetadata.getmetadata(config, dbs);
        if(!fncs.isJsonObject(metadata)) {
            throw new Error(cstyler.red.bold("Could not retrieve metadata. Backup creation failed."));
        }
        if(metadata.dbtaskerdata === null && metadata.raw === null) {
            throw new Error(cstyler.red.bold("No valid data to backup."));
        }
        // write metadata to file
        const writeResult = await filefunc.writeJsonFile("./backupfiles/backup/metadata.json", metadata);
        if(!writeResult) {
            throw new Error(cstyler.red.bold("Could not write metadata to file. Please check permissions and try again."));
        }
        console.log(cstyler.green("Metadata written to metadata.json"));
        // Lets get all the row data for each table and write them to files
        const rowDataResult = await rows.getrows(config, metadata.raw);
        if(!rowDataResult) {
            await filefunc.clearFolderContents("./backupfiles");
            throw new Error(cstyler.red.bold("Could not retrieve row data. Backup creation failed."));
        }
        console.log(cstyler.green("Row data retrieved and written to files."));
        // If we have an output path, we will zip all the files and move the zip to the output path
        if(outputpath) {
            const zipResult = await filefunc.zipDirectory("./backupfiles/backup", `${outputpath}/backup.zip`);
            if(!zipResult) {
                throw new Error(cstyler.red.bold("Could not create zip file. Please check permissions and try again."));
            }
            console.log(cstyler.green(`Backup moved to ${outputpath}`));
        } else {
            console.log(cstyler.green("Backup created in ./backupfiles/backup"));
        }
    } catch (err) {
        console.error("Backup creation failed:", err);
        return null;
    }
}

module.exports = {
    createbackup
};