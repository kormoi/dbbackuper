const fncs = require('./functions');
const cstyler = require('cstyler');





async function getrows(config, jsondata) {
    try {
        let data = {};
        for (const db of Object.keys(jsondata)) {
            if (!data.hasOwnProperty(db)) data[db] = {};
            for (const table of Object.keys(jsondata[db])) {
                if (!fncs.isJsonObject(jsondata[db][table])) {
                    continue;
                }
                // lets get all the rows of this table
                const getallrow = await fncs.getAllRowsAccurately(config, db, table);
                if (Array.isArray(getallrow)) {
                    data[db][table] = getallrow;
                } else {
                    console.error(cstyler.blue("Database:"), cstyler.hex("#00d9ffff")(db), cstyler.blue("Table"), cstyler.hex("#00d9ffff")(table), "- Having problem getting all the rows from table.");
                    return null;
                }
            }
        }
        console.log(cstyler.green("Successfully done requesting and storing all the row."));
        return data;
    } catch (err) {
        console.error(err.message);
        return null;
    }
}

async function insertrows(config, data) {
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
                    const addrow = await fncs.addRecord(config, db, table, item);
                    if(addrow === null){
                        return null;
                    }
                }
                console.log("Record added to the table:", table);
                const rowcount = await fncs.getTableRowCount(config, db, table);
                if(typeof rowcount !== "number"){
                    console.error("Having problem getting row count. Server connection problem.");
                    return null;
                }
                console.log("Added row count:", rowcount);
                if(rowcount !== coldata.length){
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


module.exports = {
    getrows,
    insertrows
}