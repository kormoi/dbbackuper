const fncs = require('./functions');
const path = require("path");
const fs = require("fs/promises");
const filefunctions = require('./filefunctions');
const getmetadata = require("./getmetadata");
const rows = require("./rows");
const cstyler = require('cstyler');
const dbtasker = require("dbtasker");
const upload = require("./upload");
const getmtd = require("./getmetadata");







const truers = [true, 1, "1", "true", "True", "TRUE"];
const falsers = [false, 0, "0", "false", "False", "FALSE"];
async function checkfile(filePath) {
  try {
    const extractpath = path.join(__dirname, "./backupfiles");
    const iffolderexist = await filefunctions.isFolderPath(extractpath);
    if (iffolderexist === null) {
      const mkdir = await filefunctions.makeDirectory(extractpath);
      if (mkdir === null) {
        console.error("We are having problem. Please try again.");
        return null;
      }
    }
    const clearfolder = await filefunctions.clearFolderContents(extractpath);
    if (clearfolder === null) {
      console.warn(cstyler.bold.red("Having problem running some function. Please try again."))
      return null;
    }
    const extractfile = filefunctions.unzipFile(filePath, extractpath);
    if (extractfile === false) {
      console.error(cstyler.bold.red("Unable to unzip the file."));
      return null;
    }
    // lets check if desired information avlaible on the file or not
    const jsonfilepath = path.join(__dirname, "./backupfiles/backup.json");
    const jsonfileexist = await filefunctions.isfilepath(jsonfilepath);
    if (jsonfileexist === null || jsonfileexist === false) {
      console.error(`Your provided zip file do not have the required ${cstyler.yellow("backup.json")} file.`);
      return null;
    }
    const jsondata = await filefunctions.readJsonFile(jsonfilepath);
    if (jsondata === null) return null;
    if (!jsondata.hasOwnProperty("data") || !jsondata.hasOwnProperty("row")) {
      console.error("Provided file do not have required data");
      return null;
    }
    if (!fncs.isJsonObject(jsondata.data) || !fncs.isJsonObject(jsondata.row)) {
      console.error("Provided data are not valid or changed the data format from json to something else.");
      return null;
    }
    return jsondata;
  } catch (err) {
    console.error("Got error when checking file: ", err.message);
    return null;
  }
}
module.exports = async function (allconfig, path) {
  try {
    // Lets work on path
    if (path.isAbsolute(path) === false) {
      console.warn(`The provided file path "${filePath}" is not absolute. Absolute path is required.`);
      return;
    }
    let filePath = path;
    // Process the configuration
    if (!fncs.isJsonObject(allconfig)) {
      throw new Error("Invalid configuration object.");
    }
    let config = {};
    if (allconfig.port && allconfig.user && allconfig.host && allconfig.password) {
      config.port = allconfig.port;
      config.user = allconfig.user;
      config.host = allconfig.host;
      config.password = allconfig.password;
      const isconfig = fncs.isValidMySQLConfig(allconfig);
      if (!isconfig) {
        throw new Error("Invalid MySQL configuration.");
      }
    }
    const ifmysqldatabase = await fncs.isMySQLDatabase(config);
    if (ifmysqldatabase === false) {
      console.error("My SQL database is required to run ", moduleName, " module. Please install mysql2 to use this module. To install run this code on the terminal > npm install mysql2");
      return;
    }
    const isvalidmysqlversion = await getmtd.isMySQL578OrAbove(config);
    if (isvalidmysqlversion === false) {
      console.error("My SQL version 5.7.8 or above is required. Please check if you have installed mysql2. To install: npm install mysql2");
      return;
    }
    // Lets determine the mode from configuration
    const modekeys = [
      "mode",
      "modes",
      "option",
      "opt",
      "mod",
      "switch",
      "method",
      "strategy",
      "type",
      "syncstrategy",
      "behavior",
      "logic",
      "backupmode",
      "backup_mode",
      "runmode",
      "writemode",
      "write_mode",
      "syncmode",
      "sync_mode",
      "write_rule",
      "insert_type",
      "update_style",
      "policy",
      "rule",
      "handling"
    ];
    const mergeAliases = [
      "merge",          // Standard
      "upsert",         // Database technical term
      "update",         // Common action
      "sync",           // Synchronization
      "patch",          // Incremental fix
      "combine",        // General English
      "additive",       // Logic-based
      "append",         // Adding to the end
      "integrate"       // Merging systems
    ];
    const replaceAliases = [
      "replace",     // Standard
      "overwrite",   // Common action
      "fresh",       // Start over
      "readd",       // Back to original state
      "mirror",      // Exact 1:1 copy
      "wipe",        // Clear everything
      "destructive", // Technical warning name
      "force",       // Override everything
      "rewrite"      // File-system style term
    ];
    let mode;
    for (const key of Object.keys(allconfig)) {
      if (modekeys.includes(fncs.stringifyAny(key).toLowerCase())) {
        if (mergeAliases.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          mode = "merge";
        } else if (replaceAliases.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          mode = "replace";
        }
        break;
      } else if (truers.includes(allconfig.merge)) {
        mode = "merge";
        break;
      } else if (truers.includes(allconfig.replace)) {
        mode = "replace";
        break;
      }
    }
    if (!mode) {
      mode = "merge"; // default mode
    }
    // Lets determine workmode
    let workmode;
    const workmode_keys = [
      "workmode",
      "work_mode",
      "filemode",
      "file_mode",
      "direction",
      "flow",
      "task",
      "job_type",
      "intent",
      "operation",
      "action",
      "process",
      "transfer",
      "io_mode",
      "run_as",
      "target",
      "activity"
    ];
    const backup_values = [
      "backup",
      "download",
      "export",
      "dump",
      "save",
      "extract",
      "out",
      "output",
      "pull",
      "fetch",
      "store",
      "archive",
      "backup_db",
      "export_db",
      "backup_database",
      "export_database"
    ];
    const upload_values = [
      "upload",
      "restore",
      "import",
      "load",
      "in",
      "input",
      "push",
      "put",
      "write",
      "insert_backup",
      "import_db",
      "restore_db",
      "deploy",
      "import_database",
      "restore_database",
      "deploy_database",
      "upload_database",
      "write_database",
      "insert_database",
      "push_database",
      "restorebackup",
      "uploadbackup",
      "importbackup",
      "restore_backup",
      "upload_backup",
      "import_backup"
    ];
    for (const key of Object.keys(allconfig)) {
      if (workmode_keys.includes(fncs.stringifyAny(key).toLowerCase())) {
        if (backup_values.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          workmode = "download";
        } else if (upload_values.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          workmode = "upload";
        } else {
          workmode = "download"; // Default mode
        }
        break;
      } else if (backup_values.includes(fncs.stringifyAny(key).toLowerCase())) {
        if (truers.includes(allconfig[key])) {
          workmode = "download";
        } else if (falsers.includes(allconfig[key])) {
          workmode = "upload";
        } else if (backup_values.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          workmode = "download";
        } else if (upload_values.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          workmode = "upload";
        } else {
          console.warn(`A valid value is required on config.${key}`);
        }
        break;
      } else if (upload_values.includes(fncs.stringifyAny(key).toLowerCase())) {
        if (truers.includes(allconfig[key])) {
          workmode = "upload";
          break;
        } else if (falsers.includes(allconfig[key])) {
          workmode = "download";
          break;
        } else if (backup_values.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          workmode = "download";
          break;
        } else if (upload_values.includes(fncs.stringifyAny(allconfig[key]).toLowerCase())) {
          workmode = "upload";
          break;
        } else {
          console.warn(`A valid value is required on config.${key}`);
        }
      }
    }
    // lets check filepath
    const isfile = await filefunctions.isfilepath(filePath, ".zip");
    if (isfile === null) {
      console.warn("A valid file path is required");
    }
    let iffolder = await filefunctions.isFolderPath(filePath);
    if ((iffolder = null || iffolder === false) && !isfile) {
      const makeit = await filefunctions.makeDirectory(filePath);
      if (makeit === null) {
        console.error("Required a valid folder path.");
        return;
      }
      iffolder = await filefunctions.isFolderPath(filePath);
    }
    // Let's check the file if data available or not, if filepath
    let filejson;
    if (isfile && workmode !== "download") {
      filejson = await checkfile(filePath);
    }
    // Let's check combination of path and work mode
    if (workmode === "download") {
      if (!iffolder) {
        if (isfile) {
          filePath = path.dirname(filePath);
        } else {
          console.error("Valid folder path is required to download the database backup file.");
          return;
        }
      }
    } else if (workmode === "upload") {
      if (!isfile) {
        console.warn(`Valid filepath is require for uploading old data to database.`);
        return;
      } else if (!filejson) {
        console.error("Valid file is required to get file data and upload data.");
        return;
      }
    } else if (workmode === undefined) {
      if (filejson) {
        workmode = "upload";
      } else if (iffolder) {
        workmode = "download";
      }
    }
    // lets work on backup operation
    if (workmode === "download") {
      // Lets backup the database
      // lets get metadata first
      let dblist;
      const dbkeys = ['db', 'database', 'dblist', 'databaselist', 'db_list', 'database_list'];
      for (const item of Object.keys(allconfig)) {
        if (dbkeys.includes(String(item).toLowerCase())) {
          dblist = dbkeys[item];
          break;
        }
      }
      if (!Array.isArray(dblist) && dblist !== undefined) {
        console.warn("You need to provide an array of database names that you want to backup or keep it empty.");
        return;
      }
      const metadatas = await getmetadata.getmetadata(config, dblist);
      if (fncs.isJsonObject(metadatas)) {
        // lets get rows and put them into one file
        const getrows = await rows.getrows(config, metadatas.raw);
        if (getrows === null) {
          return;
        }
        // lets create backup file
        const compressdb = await filefunctions.compressbackupfile(filePath, { ...metadatas, row: getrows });
        if (compressdb !== true) {
          console.error("Unable to compress backup file.");
          return;
        }
        console.log(cstyler.bold.green("Successfully backup the database."));
        return;
      } else {
        return;
      }
    } else {
      // Lets upload the backup
      const uploadfile = await upload.uploadData(config, filejson);
    }
  } catch (error) {
    console.error(`Error processing file at ${filePath}:`, error.message);
    return;
  }
};