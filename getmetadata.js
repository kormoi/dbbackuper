const fncs = require('./functions');
const cstyler = require('cstyler');



const defaultdb = ['information_schema', 'mysql', 'performance_schema', 'sys', 'world'];

// require config and database names that you want to backup
// keep it empty to backup all databases that are not default
async function getmetadata(config, dbs = []) {
    try {
        // lets initialize our return object
        console.log("Getting JSON data...");
        let jsondata = {};
        // if dbs array has values, we will use them, else we will get all databases except default ones
        if (dbs.length > 0) {
            const dbnames = await fncs.getAllDatabaseNames(config);
            if (dbnames === null) {
                throw new Error("Could not retrieve database names. Please check your configuration.");
            }
            for (const dbname of dbs) {
                if (!dbnames.includes(dbname)) {
                    cstyler.warn(`Database "${dbname}" does not exist on the server. Please check the database name and try again.`);
                    return null;
                } else {
                    jsondata[dbname] = {};
                }
            }
        } else {
            const dbnames = await fncs.getAllDatabaseNames(config);
            if (dbnames === null) {
                throw new Error("Could not retrieve database names. Please check your configuration.");
            }
            for (const dbname of dbnames) {
                if (!defaultdb.includes(dbname)) {
                    jsondata[dbname] = {};
                }
            }
        }
        if(Object.keys(jsondata).length === 0) {
            cstyler.warn("No databases to process.");
            return {dbtaskerdata: null, raw: null};
        }
        // Now we have the databases to process in jsondata
        for (const dbname of Object.keys(jsondata)) {
            const tables = await fncs.getTableNames(config, dbname);
            if (tables === null) {
                cstyler.warn(`Could not retrieve tables for database "${dbname}". Skipping this database.`);
                return null;
            }
            // lets get database character set and collate
            const getcarcol = await fncs.getDatabaseCharsetAndCollation(config, dbname);
            if (getcarcol === null) {
                console.warn(`Could not retrieve character set or collate for database "${dbname}". Skipping this database.`)
            } else if (fncs.isJsonObject(getcarcol)) {
                jsondata[dbname]._charset_ = getcarcol.characterSet;
                jsondata[dbname]._collate_ = getcarcol.collation;
            }
            // lets check if there are tables
            if (tables.length === 0) {
                cstyler.info(`Database "${dbname}" has no tables. Skipping to next database.`);
                continue;
            }
            for (const tablename of tables) {
                if (!jsondata[dbname][tablename]) jsondata[dbname][tablename] = {};
                const columns = await fncs.getColumnNames(config, dbname, tablename);
                if (columns === null) {
                    cstyler.warn(`Could not retrieve columns for table "${tablename}" in database "${dbname}". Skipping this table.`);
                    return null;
                }
                const tablemetadata = await fncs.getTableMetadata(config, dbname, tablename);
                if (tablemetadata === null) {
                    console.error(`Could not retrieve table metadata for table "${tablename}" in database "${dbname}". Skipping this table.`);
                    return null;
                } else if (fncs.isJsonObject(tablemetadata)) {
                    jsondata[dbname][tablename].engine = tablemetadata.engine;
                    jsondata[dbname][tablename]._charset_ = tablemetadata.charset;
                    jsondata[dbname][tablename]._collate_ = tablemetadata.collation;
                    if (typeof tablemetadata.comment === "string") {
                        jsondata[dbname][tablename].comment = tablemetadata.comment;
                    }
                }
                if (columns.length === 0) {
                    cstyler.info(`Table "${tablename}" in database "${dbname}" has no columns. Skipping to next table.`);
                    continue;
                }
                for (const column of columns) {
                    if (!jsondata[dbname][tablename][column]) jsondata[dbname][tablename][column] = {};
                    // Get column details
                    const colDetails = await fncs.getColumnDetails(config, dbname, tablename, column);
                    if (colDetails === null) {
                        cstyler.warn(`Could not retrieve details for column "${column}" in table "${tablename}" of database "${dbname}". Skipping this column.`);
                        return null;
                    }
                    jsondata[dbname][tablename][column] = colDetails;
                    const foreignKeys = await fncs.getForeignKeyDetails(config, dbname, tablename, column);
                    if (foreignKeys === null) {
                        cstyler.warn(`Could not retrieve foreign key details for column "${column}" in table "${tablename}" of database "${dbname}". Skipping this column.`);
                        return null;
                    }
                    if (fncs.isJsonObject(foreignKeys)) {
                        jsondata[dbname][tablename][column].foreign_key = foreignKeys;
                    }
                }
            }
        }
        const raw = jsondata;
        // lets check if there is any reverse loop name or not
        for (const item of Object.keys(jsondata)) {
            for (const tables of Object.keys(jsondata[item])) {
                const getreverseloop = fncs.reverseLoopName(tables);
                if (Array.isArray(getreverseloop)) {
                    jsondata[item][getreverseloop[0]] = jsondata[item][tables];
                }
            }
        }
        for (const item of Object.keys(jsondata)) {
            const getreverseloop = fncs.reverseLoopName(item);
            if (Array.isArray(getreverseloop)) {
                jsondata[getreverseloop[0]] = jsondata[item];
            }
        }
        console.log(cstyler.green.bold("Successfully retrieved database, table and column structure metadata in JSON format."));
        return {dbtaskerdata: jsondata, raw: raw};
    } catch (err) {
        cstyler.error(err.message);
        return null;
    }
}

module.exports = {
    getmetadata
}