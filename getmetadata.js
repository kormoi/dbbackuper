const fncs = require('./functions');
const cstyler = require('cstyler');
const mysql = require('mysql2/promise');
const path = require("path");
const fs = require('fs').promises;



const defaultdb = ['information_schema', 'mysql', 'performance_schema', 'sys', 'world'];

async function getMySQLVersion(config) {
  const connection = await mysql.createConnection(config);
  try {
    const [rows] = await connection.execute('SELECT VERSION() AS version');
    const version = rows[0].version;
    console.log("Mysql database version is: ", cstyler.green(version));
    return version;
  } catch (err) {
    console.error(err.message);
    return null;
  } finally {
    await connection.end();
  }
}
async function isMySQL578OrAbove(config) {
  const versionStr = await getMySQLVersion(config); // e.g., '5.7.9-log' or '8.0.34'
  // Extract numeric version
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);

  if (major > 5) return true;
  if (major < 5) return false;
  if (minor > 7) return true;
  if (minor < 7) return false;
  // major==5, minor==7
  return patch >= 8;
}
async function getDiskMetricsInMB(pathToCheck) {
    try {
        // Safe path resolution for Node v20 (Defaults to execution root if empty)
        const targetPath = path.resolve(pathToCheck || './');

        // Use the native statfs method from fs/promises
        const stats = await fs.statfs(targetPath);

        // Convert the structural block configurations to bytes
        const freeBytes = stats.bsize * stats.bavail;
        const totalBytes = stats.bsize * stats.blocks;

        // Convert bytes directly to Megabytes (MB)
        const freeMB = freeBytes / (1024 * 1024);
        const totalMB = totalBytes / (1024 * 1024);

        return {
            freeMB: Number(freeMB.toFixed(2)),
            totalMB: Number(totalMB.toFixed(2)),
            percentageAvailable: Number(((freeBytes / totalBytes) * 100).toFixed(2))
        };

    } catch (error) {
        console.error(`❌ Failed reading storage metrics:`, error.message);
        return null;
    }
}
async function getDatabaseSizeInMB(config, dbName) {
  let connection = null;
  let poolContext = null;

  try {
    // 1. Validate configuration format
    const isconfig = fncs.isValidDbConfig(config);
    if (isconfig === false) {
      console.error("❌ Invalid database configuration provided.");
      return null;
    }

    // 2. FIXED: Added 'await' here because detectDatabase is an async function!
    const dbType = await fncs.detectDatabase(config);
    if (dbType === null) {
      console.error("❌ Unable to detect database type from configuration.");
      return null;
    }

    // 3. Extract safe driver connection attributes (Handles flat or nested config structures)
    const connectionOpts = (config.connection && typeof config.connection === 'object')
      ? config.connection
      : config;

    // Ensure the connection opts point to our target evaluation database space
    const targetConnOpts = { ...connectionOpts, database: dbName };

    // 4. Connect to the respective database system
    const normalizedType = dbType.toLowerCase();

    if (normalizedType === 'mysql') {
      connection = await mysql.createConnection(targetConnOpts);

      const query = `
        SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb 
        FROM information_schema.tables 
        WHERE table_schema = ?;
      `;

      const [rows] = await connection.execute(query, [dbName]);
      return { size: rows[0]?.size_mb ? Number(rows[0].size_mb) : 0.00, unit: "MB", type: "mysql" };
    }

    if (normalizedType === 'postgres' || normalizedType === 'pg') {
      // Use a standard short-lived Client or Pool instantiation for metadata parsing
      connection = new pg.Client(targetConnOpts);
      await connection.connect();

      const query = `SELECT ROUND(pg_database_size($1) / 1024.0 / 1024.0, 2) AS size_mb;`;
      const res = await connection.query(query, [dbName]);
      return { size: res.rows[0]?.size_mb ? Number(res.rows[0].size_mb) : 0.00, unit: "MB", type: "pg" };
    }

    throw new Error(`Unsupported database driver type: [${dbType}]`);

  } catch (err) {
    console.error(`❌ Failed to read database metrics for ${dbName}:`, err.message);
    return null;
  } finally {
    // 5. CRITICAL FIX: Always close active connection sockets to prevent leaks
    if (connection) {
      try {
        if (typeof connection.end === 'function') {
          await connection.end();
        }
      } catch (closeErr) {
        // Suppress background closure bubbles
      }
    }
  }
}
async function getCharsetAndCollations(config) {
  let conn;
  try {
    conn = await mysql.createConnection(config);

    const [charsetRows] = await conn.query("SHOW CHARACTER SET");
    const characterSets = charsetRows.map(row => row.Charset);

    const [collationRows] = await conn.query("SHOW COLLATION");
    const collations = collationRows.map(row => row.Collation);

    await conn.end();
    return { characterSets, collations };
  } catch (err) {
    return null;
  } finally {
    if (conn) await conn.end();
  }
}
async function getDatabaseCharsetAndCollation(config, databaseName) {
  let connection;
  try {
    // Connect to the server (not to a specific database)
    connection = await mysql.createConnection(config);

    // Query the information_schema for the given database
    const [rows] = await connection.execute(
      `SELECT DEFAULT_CHARACTER_SET_NAME AS characterSet, DEFAULT_COLLATION_NAME AS collation 
       FROM information_schema.SCHEMATA 
       WHERE SCHEMA_NAME = ?`,
      [databaseName]
    );

    if (rows.length === 0) {
      console.error(`Database "${databaseName}" not found.`);
      return null;
    }

    return {
      characterSet: rows[0].characterSet,
      collation: rows[0].collation,
    };
  } catch (err) {
    console.error("Error fetching charset/collation:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
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
            const getcarcol = await getDatabaseCharsetAndCollation(config, dbname);
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
async function getColumnMetadataAndSize(config, databaseName, tableName, offset) {
    let connection;
    try {
        connection = await mysql.createConnection(config);

        // 1. Get Schema Info
        const [schemaInfo] = await connection.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [databaseName, tableName]
        );

        // 2. Optimized Size Query
        // We use BIT_LENGTH / 8 as a fallback and COALESCE to catch NULLs
        const sizeCalculations = schemaInfo.map(col => {
            return `COALESCE(OCTET_LENGTH(\`${col.COLUMN_NAME}\`), 0) AS \`${col.COLUMN_NAME}_size\``;
        }).join(', ');

        const [sizeData] = await connection.execute(
            `SELECT ${sizeCalculations} 
             FROM \`${databaseName}\`.\`${tableName}\` 
             LIMIT 1 OFFSET ${Number(offset)}`
        );

        if (sizeData.length === 0) return false; // No row found at this offset

        // 3. Map Results
        return schemaInfo.map(col => ({
            column: col.COLUMN_NAME,
            type: col.DATA_TYPE,
            fullType: col.COLUMN_TYPE,
            sizeInBytes: sizeData[0][`${col.COLUMN_NAME}_size`]
        }));

    } finally {
        if (connection) await connection.end();
    }
}
async function getTableSchemaLayout(config, databaseName, tableName) {
    let connection;
    try {
        connection = await mysql.createConnection(config);

        const [schemaInfo] = await connection.execute(
            `SELECT 
                COLUMN_NAME, 
                DATA_TYPE, 
                CHARACTER_MAXIMUM_LENGTH, 
                NUMERIC_PRECISION, 
                NUMERIC_SCALE,
                COLUMN_TYPE
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`,
            [databaseName, tableName]
        );

        // 🚨 CRITICAL FIX: If the table doesn't exist, schemaInfo length is 0
        if (schemaInfo.length === 0) {
            console.error(cstyler.red(`❌ Table "${tableName}" does not exist in database "${databaseName}".`));
            return false; // Return false to indicate the table doesn't exist, instead of throwing an error
        }

        const schemaMap = {};

        for (const col of schemaInfo) {
            const type = col.DATA_TYPE.toUpperCase();
            schemaMap[col.COLUMN_NAME] = { type };

            if (col.CHARACTER_MAXIMUM_LENGTH !== null) {
                schemaMap[col.COLUMN_NAME].value = col.CHARACTER_MAXIMUM_LENGTH;
            }
            else if (col.NUMERIC_PRECISION !== null && col.NUMERIC_SCALE !== null && col.NUMERIC_SCALE > 0) {
                schemaMap[col.COLUMN_NAME].value = [col.NUMERIC_PRECISION, col.NUMERIC_SCALE];
            }
            else if (col.NUMERIC_PRECISION !== null && ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT'].includes(type)) {
                schemaMap[col.COLUMN_NAME].value = col.NUMERIC_PRECISION;
            }
            else if (type === 'ENUM' || type === 'SET') {
                const cleanStr = col.COLUMN_TYPE.substring(type.length + 1, col.COLUMN_TYPE.length - 1);
                schemaMap[col.COLUMN_NAME].value = cleanStr.split(',').map(v => v.replace(/'/g, ''));
            }
        }

        return schemaMap;

    } catch (error) {
        // This will now catch the "Table does not exist" error cleanly
        console.error(`❌ Failed parsing schema layout:`, error.message);
        return null; // Return null to indicate failure, instead of throwing further
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}
module.exports = {
    getMySQLVersion,
    isMySQL578OrAbove,
    getDatabaseSizeInMB,
    getDiskMetricsInMB,
    getCharsetAndCollations,
    getDatabaseCharsetAndCollation,
    getmetadata,
    getColumnMetadataAndSize,
    getTableSchemaLayout,
}