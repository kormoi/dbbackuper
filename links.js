const path = require("path");


module.exports = {
    main: path.join(__dirname, "./backupfiles"),
    backup: path.join(__dirname, "./backupfiles/backup"),
    database: path.join(__dirname, "./backupfiles/backup/database"),
    databasefiles: path.join(__dirname, "./backupfiles/backup/database/files"),
    programfiles: path.join(__dirname, "./backupfiles/backup/programfiles"),
    raw: path.join(__dirname, "./backupfiles/backup/database/raw.json"),
    dbtasker: path.join(__dirname, "./backupfiles/backup/database/dbtaskerdata.json"),
}