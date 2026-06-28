const path = require("path");
const fncs = require('./functions');
const cstyler = require('cstyler');
const dbtasker = require("dbtasker");
const fif = require("./filefunctions");



async function uploadBackup(config, zipPath, type = 'merge') {
    try {
        zipPath = path.resolve(zipPath);
        const isFile = await fif.isfilepathwithext(zipPath);
        if (isFile !== true) {
            throw new Error("A backup.zip file path is required");
        } else {
            
        }
        const dbtaskerdata = data.dbtaskerdata;
        const rows = data.rows;

        config.dropdb = false;
        config.droptable = false;
        config.dropcol = false;
        config.sep = "_";
        config.forceupdatecolumn = true;
        const operatedb = await dbtasker(config, dbtaskerdata);
    } catch (err) {
        console.error(err.message);
        return null;
    }
}


module.exports = {
    uploadData
}