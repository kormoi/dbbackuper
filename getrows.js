const fncs = require('./functions');
const cstyler = require('cstyler');
const mysql = require('mysql2/promise');
const v8 = require('v8');
const fs = require('fs').promises;
const { createReadStream, createWriteStream, existsSync } = require('fs');
const { pipeline } = require('stream/promises');
const path = require('path');
const filefunctions = require('./filefunctions');
const { count } = require('console');





function toReadable(value) {
    // 1. ADVANCED SPATIAL & GEOMETRY LAYER (MySQL / PG Support)
    if (value !== null && typeof value === 'object') {

        // --- Postgres/PostGIS direct object driver structures ---
        if (value.x !== undefined && value.y !== undefined) {
            return { ischanged: true, value: `POINT(${value.x} ${value.y})`, type: 'point' };
        }

        // --- MySQL Spatial Buffer Parser ---
        // MySQL driver emits geometry as a Buffer, but it prefixes a 4-byte SRID header before the WKB.
        if (Buffer.isBuffer(value) && value.length > 4) {
            try {
                // Slice off the first 4 bytes (MySQL's internal SRID tracking header) to get the clean WKB
                const wkbBuffer = value.slice(4);

                // Parse using the built-in wkx library
                const geometry = wkx.Geometry.parse(wkbBuffer);

                // Convert it dynamically to a clean readable string (e.g., "POLYGON((...))", "LINESTRING(...)")
                const wktString = geometry.toWkt();

                // Extract the geometry type lower-cased ('point', 'polygon', 'geometrycollection')
                const geomType = geometry.constructor.name.toLowerCase();

                return { ischanged: true, value: wktString, type: geomType };
            } catch (e) {
                // If it fails parsing as a geometry data format, drop it safely to the raw buffer block below
            }
        }
    }
    // 1. Binary (Buffer / Uint8Array) -> Kept purely intact as a raw buffer object
    if (Buffer.isBuffer(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))) {
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        return { ischanged: true, value: buf, type: 'buffer' };
    }

    // 2. BigInt (MySQL/PG bigserial/bigint)
    if (typeof value === 'bigint') {
        return { ischanged: true, value: value.toString(), type: 'bigint' };
    }

    // 3. Dates
    if (value instanceof Date) {
        return { ischanged: true, value: value.toISOString(), type: 'date' };
    }

    // 4. PG JSON/JSONB or Array Columns
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        if (value.x !== undefined && value.y !== undefined) {
            return { ischanged: true, value: `POINT(${value.x} ${value.y})`, type: 'point' };
        }
        return { ischanged: true, value: JSON.stringify(value), type: 'json' };
    }

    // 5. Special Numbers
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
        return { ischanged: true, value: value.toString(), type: 'special_num' };
    }

    // 6. Direct Native Hex & Base64 Detection Layer
    if (typeof value === 'string') {

        // --- NATIVE HEX DETECTION ---
        if (value.length % 2 === 0 && value.length > 64) {
            const testHexBuf = Buffer.from(value, 'hex');
            if (testHexBuf.toString('hex').toLowerCase() === value.toLowerCase()) {
                return { ischanged: false, value: value.toUpperCase(), type: 'hex' };
            }
        }

        // --- NATIVE BASE64 DETECTION ---
        if (value.length % 4 === 0 && value.length > 64) {
            if (!/[\s]/.test(value)) {
                const testB64Buf = Buffer.from(value, 'base64');
                if (testB64Buf.toString('base64') === value) {
                    return { ischanged: false, value: value, type: 'base64' };
                }
            }
        }
    }

    // Default Fallback
    return { ischanged: false, value: value, type: typeof value };
}
function bufferToHex(bufferObj) {
    if (!bufferObj) {
        throw new Error("No data provided to conversion utility.");
    }

    // Normalize the input into a safe Node.js Buffer if it's a view/typed array
    const buf = Buffer.isBuffer(bufferObj)
        ? bufferObj
        : Buffer.from(bufferObj.buffer, bufferObj.byteOffset, bufferObj.byteLength);

    return buf.toString('hex').toUpperCase();
}
function getmemorypercent() {
    const stats = v8.getHeapStatistics();
    const heapLimit = stats.heap_size_limit / 1024 / 1024; // Convert to MB
    const usedHeap = stats.used_heap_size / 1024 / 1024;
    return (usedHeap * 100 / heapLimit);
}
// Fetch rows in chunks until memory limit is approached
async function getRowsUntilMemoryLimit(config, databaseName, tableName, startOffset = 0, thresholdPercent = 70) {
    let connection;
    let allData = [];
    let currentOffset = startOffset;
    let status = "completed"; // Default status

    try {
        connection = await mysql.createConnection(config);

        // 1. Get total rows
        const [countResult] = await connection.execute(
            `SELECT COUNT(*) AS total FROM \`${databaseName}\`.\`${tableName}\``
        );
        const totalRows = countResult[0].total;

        const chunkSize = 2000;
        const heapLimit = v8.getHeapStatistics().heap_size_limit;
        const memoryThreshold = heapLimit * (thresholdPercent / 100); // threshold

        while (currentOffset < totalRows) {
            // Check memory BEFORE the next chunk
            const currentUsage = v8.getHeapStatistics().used_heap_size;
            if (currentUsage > memoryThreshold) {
                console.warn(`Memory limit reached at offset: ${currentOffset}`);
                status = "memory_limit";
                break;
            }

            try {
                // Fetch chunk
                const [rows, fields] = await connection.execute(
                    `SELECT * FROM \`${databaseName}\`.\`${tableName}\` ORDER BY 1 LIMIT ? OFFSET ?`,
                    [String(chunkSize), String(currentOffset)]
                );

                // Identify JSON and BLOB (Image) columns
                const jsonColumns = fields.filter(f => f.columnType === 245).map(f => f.name);
                const blobColumns = fields.filter(f => [249, 250, 251, 252].includes(f.columnType)).map(f => f.name);

                const processedRows = rows.map(row => {
                    // Parse JSON columns
                    jsonColumns.forEach(col => {
                        if (row[col] && typeof row[col] === 'string') {
                            try { row[col] = JSON.parse(row[col]); } catch (e) { }
                        }
                    });
                    // Convert Image/BLOB to Base64
                    blobColumns.forEach(col => {
                        if (row[col] instanceof Buffer) {
                            row[col] = row[col].toString('base64');
                        }
                    });
                    return row;
                });

                allData = allData.concat(processedRows);
                currentOffset += rows.length;

            } catch (chunkErr) {
                console.error(`Error at offset ${currentOffset}:`, chunkErr.message);
                status = "error";
                break; // Stop loop but return what we already collected
            }
        }

        return {
            data: allData,
            nextOffset: currentOffset,
            totalRows: totalRows,
            status: status, // "completed", "memory_limit", or "error"
            isFinished: currentOffset >= totalRows
        };

    } catch (fatalErr) {
        console.error("Fatal Connection Error:", fatalErr.message);
        return { data: allData, nextOffset: currentOffset, status: "error", isFinished: false, message: fatalErr.message };
    } finally {
        if (connection) await connection.end();
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

        if (sizeData.length === 0) return { error: "No row found." };

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
async function getSingleRowAsJson(config, databaseName, tableName, offset) {
    let connection;
    try {
        // Establish connection
        connection = await mysql.createConnection(config);

        // 1. Identify Column Types from Schema
        const [fields] = await connection.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [databaseName, tableName]
        );

        const blobCols = fields.filter(f =>
            [249, 250, 251, 252].includes(f.DATA_TYPE) || f.DATA_TYPE.includes('blob')
        ).map(f => f.COLUMN_NAME);

        const jsonCols = fields.filter(f => f.DATA_TYPE === 'json').map(f => f.COLUMN_NAME);

        // 2. Fetch the actual row data
        // We select everything (*) because we need the full content for Base64 conversion
        const [rows] = await connection.execute(
            `SELECT * FROM \`${databaseName}\`.\`${tableName}\` LIMIT 1 OFFSET ${Number(offset)}`
        );

        if (rows.length === 0) return false; // No row found at this offset

        // mysql2 returns BLOBs as Buffers automatically
        const row = rows[0];

        // 3. Convert Buffers to Base64 Strings
        for (const col of blobCols) {
            if (row[col] instanceof Buffer) {
                // Convert binary buffer to base64 string
                row[col] = row[col].toString('base64');
            } else if (row[col] === null) {
                row[col] = null;
            }
        }

        // 4. Parse JSON columns (if they are stored as strings)
        jsonCols.forEach(col => {
            if (row[col] && typeof row[col] === 'string') {
                try {
                    row[col] = JSON.parse(row[col]);
                } catch (e) {
                    // Stay silent on parse errors
                }
            }
        });

        return row;

    } catch (err) {
        console.error("JSON Fetch Error:", err.message);
        return null;
    } finally {
        if (connection) await connection.end();
    }
}
async function writeDataToFileBig(data, folderPath, db, table) {
    try {
        for (const db of Object.keys(data)) {
            for (const table of Object.keys(data[db])) {
                for (const row of data[db][table]) {
                    for (const col of Object.keys(row)) {
                        // lets check if the value is buffer of 64 based string

                    }
                }
            }
        }
    } catch (err) {
        console.error(cstyler.red("Error writing data to file:"), err.message);
        return null;
    }
}
// Lets get all the rows of all tables of all databases and write to file
async function getrows(config, jsondata) {
    try {
        let data = {};
        let count = 0;
        let errorHappened = false;
        // Lets check if backup folder exist if not
        const folderPath = path.join(__dirname, "./backupfiles/backup/database/");
        const isfolderpath = await filefunctions.isFolderPath(folderPath);
        if (!isfolderpath) {
            const createfolder = await filefunctions.makeDirectory(folderPath);
            if (!createfolder) {
                console.error(cstyler.red("Error creating backup folder. Please check permissions and try again."));
                return null;
            }
        }
        for (const db of Object.keys(jsondata)) {
            if (!data.hasOwnProperty(db)) data[db] = {};
            for (const table of Object.keys(jsondata[db])) {
                if (!fncs.isJsonObject(jsondata[db][table])) {
                    continue;
                }
                data[db][table] = []; // Initialize as empty array to store rows
                // lets get all the rows of this table
                let isfinished = false;
                let offset = 0;
                let errorcount = 0;
                while (!isfinished) {
                    const result = await getRowsUntilMemoryLimit(config, db, table, offset, 50);
                    if (result.isFinished === true) {
                        data[db][table].push(...result.data);
                        offset = 0; // Reset offset for next table
                        isfinished = true;
                        errorcount = 0; // Reset error count for next table
                    } else if (result.status === "memory_limit") {
                        data[db][table].push(...result.data);
                        result.data = []; // Clear chunk data to free memory
                        offset = result.nextOffset; // Update offset for next chunk
                        // Lets check if we can save any file
                        // Then check memory uses
                        const writeResult = await filefunctions.writeJsonFile(`${folderPath}${db}_${table}_${count}.json`, data);
                        if (writeResult) {
                            count++;
                            data = {};
                            data[db] = {};
                            data[db][table] = []; // Store only the last chunk for reference
                            offset = result.nextOffset; // Update offset for next chunk
                        } else {
                            await filefunctions.clearFolderContents(folderPath);
                            console.error(cstyler.red("Error writing chunk to file. Clearing backup folder to prevent partial data issues."));
                            return null;
                        }
                        errorcount = 0; // Reset error count for next chunk
                    } else if (result.status === "error") {
                        console.error(cstyler.red("Error fetching rows:"), result.message);
                        if (errorcount < 3) {
                            errorcount++;
                            continue; // Try fetching the same chunk again
                        } else {
                            console.error(cstyler.red("Repeated errors fetching rows. Skipping to next table."));
                            errorHappened = true;
                            errorcount = 0; // Reset error count for next table
                            break; // Skip to next table
                        }
                    }
                    // if bigger than available memory then write previous data to file and clear the variable
                    data[db][table].push(...result.data);
                    result.data = []; // Clear chunk data to free memory


                }


                // Lets write the data to object

                // Check if we hit memory limit
                // If memory limit is hit, lets clean the data for saving on json file
                // write data to file


                const filestatus = filefunctions.getMemoryStats();
                if (filestatus.heap.percentUsed > 80) {
                    await writeDataToFile(result.data);
                    data = {}; // Clear in-memory data
                    data[db] = {};
                    data[db][table] = [] // Store only the last chunk for reference
                }
                // 1. Send data to your Write/Merge function


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
    getrows,
    getRowsUntilMemoryLimit,
    getColumnMetadataAndSize,
    getSingleRowAsJson,
    toReadable,
    toPrevious,
    getmemorypercent
}