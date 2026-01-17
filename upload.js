const fncs = require('./functions');
const cstyler = require('cstyler');
const dbtasker = require("dbtasker");



async function insertrows(config, data, mode) {
    try {
        // lets start adding the rows
        console.log(cstyler.hex()("Lets initiate the adding column"));
        for (const db of Object.keys(data)) {
            for (const table of Object.keys(data[db])) {
                if (!Array.isArray(data[db][table])) {
                    console.error(`${cstyler.blue("Database:")} ${cstyler.hex("#00d9ffff")(db)} ${cstyler.blue("Table:")} ${cstyler.hex("#00d9ffff")(table)} - There must be some problem in backup file. Please try again.`);
                    return null;
                }
                const coldata = data[db][table];
                for (const item of coldata) {
                    if (!fncs.isJsonObject(item)) {
                        console.error(`${cstyler.blue("Database:")} ${cstyler.hex("#00d9ffff")(db)} ${cstyler.blue("Table:")} ${cstyler.hex("#00d9ffff")(table)} ${cstyler.blue("data:")} ${item} - There must be some problem in backup file. Please try again.`);
                        return null;
                    }
                    const requiredcol = await fncs.getRequiredColumnNames(config, databaseName, tableName);
                    if (!Array.isArray(requiredcol)) {
                        console.error("There is a database connection problem. Check config or try again.");
                        return null;
                    }
                    if (!hasArray(Object.keys(Object.keys(item)), requiredcol)) {
                        console.error("There must be some problem in backup file. Some information are missing. please try again.");
                    }
                    const primaryKey = await fncs.checkPrimaryKey(config, databaseName, tableName);
                    if (primaryKey === null) {
                        throw new Error("Unable to determine primary key for the table. Server error.");
                    }
                    if (primaryKey) {
                        if (item.hasOwnProperty(primaryKey) === true) {
                            if (mode === 'merge') {
                                delete item[primaryKey];
                                const addrow = await fncs.addRecord(config, db, table, item);
                                if (addrow === null) {
                                    console.error("There is a database connection problem. Check config or try again.");
                                    return null;
                                }
                            } else {
                                const checkexist = await fncs.checkRowExists(config, db, table, primaryKey, item[primaryKey]);
                                if (checkexist === null) {
                                    console.error("There is a database connection problem. Check config or try again.");
                                    return null;
                                }
                                if (checkexist === true) {
                                    // update the row config, databaseName, tableName, validatedData, primaryKeyColumn)
                                    const updaterow = await fncs.updateRecord(config, db, table, item, primaryKey);
                                    if (updaterow === null) {
                                        console.error("There is a database connection problem. Check config or try again.");
                                        return null;
                                    }
                                } else {
                                    // add the row
                                    const addrow = await fncs.addRecord(config, db, table, item);
                                    if (addrow === null) {
                                        console.error("There is a database connection problem. Check config or try again.");
                                        return null;
                                    }
                                }
                            }
                        }

                    } else {
                        const addrow = await fncs.addRecord(config, db, table, item);
                        if (addrow === null) {
                            console.error("There is a database connection problem. Check config or try again.");
                            return null;
                        }
                    }
                }
                console.log("Record added to the table:", table);
                const rowcount = await fncs.getTableRowCount(config, db, table);
                if (typeof rowcount !== "number") {
                    console.error("Having problem getting row count. Server connection problem.");
                    return null;
                }
                console.log("Added row count:", rowcount);
                if (rowcount !== coldata.length) {
                    console.error("We may have missed some rows. Please try backup again. Given row count:", cstyler.yellow(coldata.length));
                    return null;
                }
            }
        }
        console.log(cstyler.bold.green("<<< We have added all the rows to all the tables >>>"));
        return true;
    } catch (err) {
        console.error(err.message);
        return null;
    }
}
async function uploadData(config, data, operation) {
    try {
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