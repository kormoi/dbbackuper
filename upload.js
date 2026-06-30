const path = require("path");
const fncs = require('./functions');
const cstyler = require('cstyler');
const dbtasker = require("dbtasker");
const ff = require("./filefunctions");
const links = require("./links");
const valcc = require("./validateUploads");




async function validateDBTaskerData(config, data) {
    try {
        let tableCount = 0;
        if (Object.keys(data).length === 0) { return null; }
        for (const db of Object.keys(data)) {
            if (!fncs.isJsonObject(data[db])) {
                return false;
            }
            // because it must have those information. it was created by another function
            if (!Object.hasOwn(data[db], "_charset_") || !Object.hasOwn(data[db], "_collate_")) {
                // database setting do not exist
                return false;
            }
            const valdbcc = await valcc.validateDatabaseConfig(config, data[db]._charset_, data[db]._collate_);
            data[db]._charset_ = valdbcc.characterSet;
            data[db]._collate_ = valdbcc.collation;

            for (const table of Object.keys(data[db])) {
                if (['_charset_', '_collate_'].includes(table) && !fncs.isJsonObject(data[db][table])) {
                    // not a table. database setting
                    continue;
                } else if (!fncs.isJsonObject(data[db][table])) {
                    return false;
                } else {
                    if (!Object.hasOwn(data[db][table], "_charset_") || !Object.hasOwn(data[db][table], "_collate_") || !Object.hasOwn(data[db][table], "engine")) {
                        // table setting do not exist
                        return false;
                    }
                    // Lets validate characterset collate and engine
                    const valtcc = await valcc.validateTableConfig(config, data[db][table]._charset_, data[db][table]._collate_, data[db][table].engine);
                    data[db][table]._charset_ = valtcc.characterSet;
                    data[db][table]._collate_ = valtcc.collation;
                    if (data[db][table].isValidEngine === false) {
                        return false;
                    }
                    for (const col of Object.keys(data[db][table])) {
                        if (['engine', '_charset_', '_collate_'].includes(col) && !fncs.isJsonObject(data[db][table][col])) {
                            // not a table. database setting
                            continue;
                        } else if (!fncs.isJsonObject(data[db][table][col])) {
                            return false;
                        } else {
                            for (const item of ['columntype', 'length_value', 'unsigned', 'zerofill', 'nulls', 'defaults', 'autoincrement', 'index', 'comment', '_charset_', '_collate_']) {
                                if (!Object.hasOwn(data[db][table][col], item)) {
                                    return false;
                                }
                                if (['unsigned', 'zerofill', 'nulls', 'autoincrement'].includes(item) && typeof data[db][table][col][item] !== "boolean") {
                                    return false;
                                }
                            }
                            if (data[db][table][col]._charset_ || data[db][table][col]._collate_) {
                                const valcocc = await valcc.validateColumnConfig(config, data[db][table][col]._charset_, data[db][table][col]._collate_);
                                data[db][table][col]._charset_ = valcocc.characterSet;
                                data[db][table][col]._collate_ = valcocc.collation;
                            }
                        }
                    }
                }
            }
        }
        return true;
    } catch (err) {
        console.error("Having problem validating database configaration data. Error message: ", err.message);
        return null;
    }
}
async function fileBackup() {
    try{
        const rootPath = await ff.getApplicationRoot();
    }catch(e){
        console.error("Having problem doint the file backup. Error message: ", e.message);
        return null;
    }
}
async function uploadBackup(config, zipPath, type = 'merge') {
    try {
        zipPath = path.resolve(zipPath);
        const isFile = await ff.isfilepathwithext(zipPath, 'zip');
        if (isFile !== true) {
            throw new Error("A '.zip' file path is required");
        }
        const mkdir_ = await ff.makeDirectory(links.main);
        if (mkdir_ === null) {
            throw new Error("Unable to create directory. Please check permission.");
        }
        const unzip = await ff.unzipFile(zipPath, links.main);
        console.log(unzip)
        if (unzip === null) {
            throw new Error("Unable to unzip file.");
        }
        // Lets check if we have all kind of file or not
        const dbtfilepath = path.resolve(path.join(links.database, "dbtaskerdata.json"));
        const dbfileexist = await ff.isfilepath(dbtfilepath);
        if (dbfileexist !== true) {
            throw new Error("Required file do not exist inside ziped file. Please try uploading correct file and backup your system.");
        }
        // Lets get db tasker data to upload to database
        const dbtaskerdata = await ff.readJsonFile(dbtfilepath);
        if (!fncs.isJsonObject(dbtaskerdata)) {
            throw new Error("Unable to read JSON file. Must be some function error. Please try again.");
        }
        // Lets validate dbtasker data
        const valdcc = await validateDBTaskerData(config, dbtaskerdata);
        if (valdcc !== true) {
            throw new Error("Please upload a valid file that contains valid database setting file created by 'DBBACKUPER'");
        }
        // Lets validate json row data
        const valJsonRowData = await valcc.validateJsonRowData();
        if(valJsonRowData === null){
            throw new Error("Unable to validate backup row data.");
        }
        /**
         * If it is a full Backup and we don't put full file system user may request for data
         * We have to complete file system first
         */
        const isFullBackup = await fileBackup();
        // Lets organize dbtasker configuration
        let dbtaskerconfig = {};
        dbtaskerconfig.user = config.user;
        dbtaskerconfig.password = config.password;
        dbtaskerconfig.host = config.host;
        dbtaskerconfig.port = config.port;
        dbtaskerconfig.dropdb = false;
        if (type === 'replace') {
            dbtaskerconfig.droptable = true;
            dbtaskerconfig.dropcol = true;
        } else {
            dbtaskerconfig.droptable = false;
            dbtaskerconfig.dropcol = false;
        }
        dbtaskerconfig.forceupdatecolumn = true;
        dbtaskerconfig.forcedeletecolumn = false;
        dbtaskerconfig.sep = "_";
        // Lets setup database configuration from backup
        const operatedb = await dbtasker(config, dbtaskerdata);
        if (operatedb !== true) {
            throw new Error("Unable to setup database. Please try again.");
        }
        // Let's upload all the rows
        
    } catch (err) {
        console.error("Having problem uploading backup. Error message: ", err.message);
        return null;
    }
}


module.exports = {
    uploadBackup
}