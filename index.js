const fncs = require('./functions');
const path = require("path");
const ff = require('./filefunctions');
const cstyler = require('cstyler');
const upl = require("./upload");
const dwn = require("./createbackup");
const getmtd = require("./getmetadata");






const pathAliases = [
  // Base variations
  "path", "dir", "directory", "folder", "location", "destination", "source", "target", "filepath", "folderpath", "route", "address", "place",

  // Custom structural/formatted combinations
  "file_path", "folder_path", "dir_path", "target_path", "output_path", "input_path", "save_path", "export_path", "import_path",
  "file path", "folder path", "dir path", "target path", "output path", "input path", "save path", "export path", "import path"
];
const databaseAliases = [
  "db", "database", "schema"
].flatMap(word => [
  word,
  `${word}_list`, `${word}list`, `${word} list`,
  `${word}_name`, `${word}name`, `${word} name`,
  `${word}_names`, `${word}names`, `${word} names`,
  `${word}_target`, `${word}target`, `${word} target`,
  `${word}_source`, `${word}source`, `${word} source`,
  `target_${word}`, `target${word}`, `target ${word}`,
  `source_${word}`, `source${word}`, `source ${word}`
]);
const downloadBackupAliases = [
  // Base variations
  "download", "export", "dump", "pull", "retrieve", "save", "fetch", "outbound",

  // Suffix variations (_backup, backup, space backup)
  ...[
    "download", "export", "dump", "pull", "retrieve", "save", "fetch", "outbound", "database", "data", "db"
  ].flatMap(word => [`${word}_backup`, `${word}backup`, `${word} backup`]),

  // Custom formatted combinations
  "db_dump", "db_export", "db_download", "data_export", "data_download",
  "db dump", "db export", "db download", "data export", "data download"
];
const uploadBackupAliases = [
  // Base variations
  "upload", "import", "load", "restore", "push", "feed", "ingest", "inbound",

  // Suffix variations (_backup, backup, space backup)
  ...[
    "upload", "import", "load", "restore", "push", "feed", "ingest", "inbound"
  ].flatMap(word => [`${word}_backup`, `${word}backup`, `${word} backup`]),

  // Custom formatted combinations
  "db_load", "db_import", "db_upload", "data_import", "data_upload", "file_upload",
  "db load", "db import", "db upload", "data import", "data upload", "file upload"
];
const workModeAliases = [ // this one is perfect
  // Base variations
  "mode", "workmode", "action", "operation", "job", "task", "type", "command", "direction", "method", "strategy", "process", "execution", "intent", "runmode",

  // Custom formatted combinations
  "work_mode", "job_type", "action_type", "op_type", "operation_type", "run_mode", "task_type", "cmd_type", "command_type", "exec_mode",
  "work mode", "job type", "action type", "op type", "operation type", "run mode", "task type", "cmd type", "command type", "exec mode"
];
const uploadTypeAliases = [
  // Base variations
  "type", "uploadtype", "strategy", "syncstrategy", "mergestrategy", "policy", "conflictpolicy", "mode", "uploadmode", "action", "behavior",

  // Custom formatted combinations
  "upload_type", "sync_strategy", "merge_strategy", "conflict_policy", "upload_mode", "import_type", "import_mode", "import_strategy",
  "upload type", "sync strategy", "merge strategy", "conflict policy", "upload mode", "import type", "import mode", "import strategy"
];
const cleanBackupAliases = [
  "clean", "purge", "truncate", "reset", "clear", "empty", "blank", "wipeout", "fresh", "readd", "mirror", "wipe", "sanitize", "flush", "initialize", "obliterate"
].flatMap(word => [word, `${word}_backup`, `${word}backup`, `${word} backup`]);
const mergeKeepOldAliases = [
  // Base Safe/Merge Terms
  "merge", "upsert", "update", "sync", "patch", "combine", "additive", "append", "integrate", "blend", "coalesce", "amalgamate", "intertwine",
  // Keep Old/Skip Terms
  "keepold", "keepoldest", "oldestwins", "safemerge", "skipexisting", "preserve", "ignoreconflicts", "keep_old", "keep_oldest", "oldest_wins", "safe_merge", "skip_existing", "ignore_conflicts"
].flatMap(word => [word, `${word}_backup`, `${word}backup`, `${word} backup`]);
const replaceKeepNewAliases = [
  // Base Overwrite/Replace Terms
  "replace", "overwrite", "destructive", "force", "rewrite", "supersede", "override", "clobber", "overlay", "substitute",
  // Keep New/Timestamp Terms
  "keepnew", "keepnewest", "newestwins", "smartmerge", "timestampmerge", "latest", "recent", "keep_new", "keep_newest", "newest_wins", "smart_merge", "timestamp_merge"
].flatMap(word => [word, `${word}_backup`, `${word}backup`, `${word} backup`]);
const forceDownloadAliases = [
  "forcedownload", "force_download", "force download",
  "forceexport", "force_export", "force export",
  "forcedump", "force_dump", "force dump",
  "overwriteexport", "overwrite_export", "overwrite export",
  "overwritedownload", "overwrite_download", "overwrite download"
].flatMap(word => [word, `${word}_backup`, `${word}backup`, `${word} backup`]);
const fullBackupAliases = [
  "full", "complete", "entire", "all", "total", "comprehensive", "max", "maximum", "whole"
].flatMap(word => [word, `${word}_backup`, `${word}backup`, `${word} backup`]);
const hostAliases = [
  "host", "hostname", "server", "ip", "address", "domain", "endpoint", "url",
  "db_host", "dbhost", "db host", "database_host", "database host"
];
const portAliases = [
  "port", "portnumber", "conn_port", "connection_port",
  "db_port", "dbport", "db port", "database_port", "database port"
];
const userAliases = [
  "user", "username", "uid", "role", "account", "login", "profile",
  "db_user", "dbuser", "db user", "database_user", "database user"
];
const passwordAliases = [
  "password", "pass", "pwd", "secret", "cred", "credential", "token", "auth",
  "db_password", "dbpass", "dbpwd", "db password", "database_password", "database password"
];

const truers = [true, 1, "1", "true", "True", "TRUE"];
const falsers = [false, 0, "0", "false", "False", "FALSE"];

async function getConfigValue(config) {
  let data = {};
  for (const key of Object.keys(config)) {
    if (pathAliases.includes(key.toLowerCase())) {
      data.path = config[key];
    } else if (databaseAliases.includes(key.toLowerCase())) {
      data.dblist = config[key];
    } else if (workModeAliases.includes(key.toLowerCase())) {
      data.workmode = config[key];
    } else if (downloadBackupAliases.includes(key.toLowerCase())) {
      if (truers.includes(config[key])) {
        data.workmode = "download";
      }
    } else if (uploadBackupAliases.includes(key.toLowerCase())) {
      if (truers.includes(config[key])) {
        data.workmode = "upload";
      }
    } else if (fullBackupAliases.includes(key.toLowerCase())) {
      data.fullBackup = config[key];
    } else if (uploadTypeAliases.includes(key.toLowerCase())) {
      data.uploadType = config[key];
    } else if (mergeKeepOldAliases.includes(key.toLowerCase())) {
      if (truers.includes(config[key])) {
        data.uploadType = "merge";
      }
    } else if (replaceKeepNewAliases.includes(key.toLowerCase())) {
      if (truers.includes(config[key])) {
        data.uploadType = "replace";
      }
    } else if (cleanBackupAliases.includes(key.toLowerCase())) {
      if (truers.includes(config[key])) {
        data.uploadType = "clean";
      }
    } else if (forceDownloadAliases.includes(key.toLowerCase())) {
      if (truers.includes(config[key])) {
        data.forceDownload = true;
      } else {
        data.forceDownload = false;
      }
    } else if (hostAliases.includes(key.toLowerCase())) {
      data.host = config[key];
    } else if (portAliases.includes(key.toLowerCase())) {
      data.port = config[key];
    } else if (userAliases.includes(key.toLowerCase())) {
      data.user = config[key];
    } else if (passwordAliases.includes(key.toLowerCase())) {
      data.password = config[key];
    }
  }
  // Lets work on data configuration
  if (data.host && data.port && data.user && data.password) {
    data.config = {
      host: data.host,
      port: data.port,
      user: data.user,
      password: data.password
    }
    const isconfig = fncs.isValidDbConfig(data.config);
    if (!isconfig) {
      return { successful: false, message: "Invalid database configuration provided. Please check the configuration object." };
    }
    const ifmysqldatabase = await fncs.isMySQLDatabase(data.config);
    if (ifmysqldatabase === false) {
      console.error("My SQL database is required to run DBBACKUPER module. Please install mysql2 to use this module. To install run this code on the terminal > npm install mysql2");
      return { successful: false, message: "My SQL database is required to run DBBACKUPER module. Please install mysql2 to use this module. To install run this code on the terminal > npm install mysql2" };
    }
    const isvalidmysqlversion = await getmtd.isMySQL578OrAbove(data.config);
    if (isvalidmysqlversion === false) {
      console.error("My SQL version 5.7.8 or above is required. Please check if you have installed mysql2. To install: npm install mysql2");
      return { successful: false, message: "My SQL version 5.7.8 or above is required. Please check if you have installed mysql2. To install: npm install mysql2" }
    }
  } else {
    return { successful: false, message: "Incomplete database configuration provided." };
  }
  if (data.workmode) {
    data.workmode = data.workmode.trim().toLowerCase().replace(/\s+/g, ' ');
    if (downloadBackupAliases.includes(data.workmode)) {
      data.workmode = "download";
    } else if (uploadBackupAliases.includes(data.workmode)) {
      data.workmode = "upload";
    } else {
      console.warn(`Invalid work mode "${data.workmode}" provided. We are checking file path to understand if download or upload.`);
      data.workmode = null;
    }
  }
  // lets check path
  if (data.path) {
    data.path = path.resolve(data.path);
    const isfile = await ff.isfilepath(data.path, ".zip");
    if (isfile === null) {
      console.warn("A valid path is required. Please provide a valid path.");
      return { successful: false, message: "A valid path is required." };
    } else if (isfile === false) {
      if (data.workmode === "upload") {
        console.warn("A valid file path is required for uploading. Please provide a valid file path.");
        return { successful: false, message: "A valid file path is required for uploading." };
      } else if (data.workmode === null) {
        data.workmode = "download";
      }
    } else if (isfile === true) {
      if (data.workmode === "download") {
        path = path.dirname(path);
        console.warn("A valid folder path is required for downloading. You provided a file path. We will use the parent directory of the provided zip file path to download backup file.");
      } else if (data.workmode === null) {
        data.workmode = "upload";
      }
    }
  }
  // force download
  if (data.forceDownload === undefined || !truers.includes(data.forceDownload)) {
    data.forceDownload = false;
  }
  // full backup
  if (data.workmode === "download") {
    if (data.fullBackup === undefined || !truers.includes(data.fullBackup)) {
      data.fullBackup = false;
    }
  }
  // lets work on upload type
  if (data.uploadType && typeof data.uploadType === "string") {
    if (mergeKeepOldAliases.includes(data.uploadType.toLowerCase())) {
      data.uploadType = "merge"
    } else if (replaceKeepNewAliases.includes(data.uploadType.toLowerCase())) {
      data.uploadType = "replace";
    } else if (cleanBackupAliases.includes(data.uploadType.toLowerCase())) {
      data.uploadType = "clean";
    } else {
      data.uploadType = "clean";
    }
  } else {
    if (data.workmode === "upload") {
      console.warn("You didn't provided a valid upload type 'merge, replace or clean'. We are approaching for clean upload.");
    }
    data.uploadType = "clean";
  }
  // Lets work on database list
  if (Array.isArray(data.dblist)) {
    let dbArray = [];
    for (const item of data.dblist) {
      if (typeof item === "string" && fncs.isValidDatabaseName(item)) {
        dbArray.push(item.trim().toLowerCase().replace(/\s+/g, ' '));
      } else {
        return { successful: false, message: "Some of database names are not valid. Please provide valid database name and try again." }
      }
    }
  } else {
    data.dblist = [];
  }
  return data;
}

module.exports = async function (configData) {
  try {
    const data = await getConfigValue(configData);
    if (data.successful === false) {
      return data;
    }
    // lets work on backup operation
    if (data.workmode === "download") {
      // Lets backup the database
      const backupfile = await dwn.createbackup(data.config, data.path, data.fullBackup, data.dblist, data.forceDownload);
      if (backupfile !== true) {
        return { successful: false, message: "Unable to create backup. Please try again." }
      } else {
        return { successful: true, message: "Successfully created backup!" }
      }
    } else {
      // Lets upload the backup
      const uploadfile = await upl.uploadBackup(data.config, data.path, data.uploadType);
      if (uploadfile !== true) {
        return { successful: false, message: uploadfile.message }
      }
      return { successful: true, message: uploadfile.message }
    }
  } catch (error) {
    console.error(`Error processing request:`, error.message);
    return;
  }
};