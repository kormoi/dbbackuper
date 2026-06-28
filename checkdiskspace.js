const cstyler = require("cstyler");
const fncs = require("./functions");
const getmtd = require("./getmetadata");
const filefunction = require("./filefunctions");



const defaultdb = ['information_schema', 'mysql', 'performance_schema', 'sys', 'world'];


async function checkDiskSpace(config, databaseNames = null, fullbackup = true) {
    try {
        // Lets check database names first
        const alldbnames = await fncs.getAllDatabaseNames(config);
        if (alldbnames === null) {
            throw new Error("Having problem getting DATABASE names");
        }
        let alldb = [];
        if (Array.isArray(databaseNames) && databaseNames.length > 0) {
            let invaliddbcount = 0;
            for (const db of databaseNames) {
                if (!alldbnames.includes(db)) {
                    console.error(`${cstyler.purple("Database:")} ${cstyler.blue(db)} - ${cstyler.bold.yellow("do not exist on the server. Skipping it to the next one.")}`);
                } else {
                    if (fncs.isValidDatabaseName(db)) {
                        alldb.push(db);
                    } else {
                        console.error(`${cstyler.bold.red("Valid DATABASE name required.")} ${cstyler.bold.purple("Invalid Database Name:")} ${cstyler.bold.hex("#00f7ff")(db)}`);
                        invaliddbcount++;
                    }
                }
            }
            if (invaliddbcount > 0) {
                throw new Error(cstyler.bold.red("Valid DATABASE name required"));
            }
        } else if (databaseNames === null || databaseNames.length === 0) {
            for (const db of alldbnames) {
                if (!defaultdb.includes(db)) {
                    alldb.push(db);
                }
            }
        } else {
            throw new Error(`Database names must be provide as an array - ['database_1', 'database_2']`);
        }

        if (alldb.length === 0) {
            console.error(cstyler.bold.red("We are abborting. No database to check."));
            return { success: false, message: "We are abborting. No database to check." }
        }
        // Lets get database sizes in MB
        let databaseSize = 0;
        for (const db of alldb) {
            // lets count database size in mb then disk space
            const dbsize = await getmtd.getDatabaseSizeInMB(config, db);
            if (dbsize === null) {
                throw new Error("Having trouble to get database size.");
            }
            databaseSize += dbsize.size;
        }
        if (databaseSize === 0) {
            console.log(cstyler.bold.pink("DATABASE is empty. No need to proceed. We are skipping."));
            return { success: false, message: "DATABASE is empty. No need to proceed. We are skipping." }
        }
        // Lets get disk space
        const diskspace = await getmtd.getDiskMetricsInMB();
        if (diskspace === null) {
            throw new Error("We are having problem getting available diskspace");
        }
        // Lets check if fullbackup is required or not
        if (fullbackup === true) {
            // lets check uploaded files and folders
            let excludeFiles = ['./node_modules', './.gitignore', '.git']; // default file and folder names
            const approot = await filefunction.getApplicationRoot();
            const isexist = await filefunction.isfilepath('./.gitignore');
            if (isexist) {
                let gitign = await filefunction.readFileSafely("./.gitignore");
                gitign = gitign.split(/\r?\n/);
                for (const item of gitign) {
                    if (!excludeFiles.includes(item)) {
                        excludeFiles.push(item);
                    }
                }
            }
            const allfilesizes = await filefunction.getCustomFileSizesSumInMB([approot], excludeFiles);
            if (diskspace.freeMB > ((databaseSize * 3) + (allfilesizes.totalSum * 3))) {
                console.log(cstyler.bold.underline.green("We have enough space to run backup system. We are good to go."));
                return { success: true, message: "We have enough space to run backup system. We are good to go." };
            } else {
                console.error(cstyler.bold.red("No enough memory in disk space to run the backup. Please upgrade your disk space."));
                return { success: false, message: "No enough memory in disk space to run the backup. Please upgrade your disk space." }
            }
        } else {
            if (diskspace.freeMB > (databaseSize * 3)) {
                console.log(cstyler.underline.green("We have enough disk space for database data files."));
                return { success: true, message: "We have enough disk space for database data files." };
            } else {
                console.error(cstyler.bold.underline("Can't even save DATABASE data on the disk space. Please upgrade your disk space and try again."));
                return { success: false, message: "Can't even save DATABASE data on the disk space. Please upgrade your disk space and try again." }
            }
        }
    } catch (err) {
        console.error("Having trouble checking disk space. Error message: ", err.message);
        return { success: false, message: err.message }
    }
}


module.exports = {
    checkDiskSpace,
}