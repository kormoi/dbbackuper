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




module.exports = {
    getrows
}