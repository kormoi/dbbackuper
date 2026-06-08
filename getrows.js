const fncs = require('./functions');
const cstyler = require('cstyler');
const mysql = require('mysql2/promise');
const v8 = require('v8');
const fs = require('fs').promises;
const { createReadStream, createWriteStream, existsSync } = require('fs');
const { pipeline } = require('stream/promises');
const path = require('path');
const { count } = require('console');
const filefunctions = require('./filefunctions');
const getmtd = require("./getmetadata");




function checkMemoryLimit(value = 90, memory = 200) {
    const memStatus = filefunctions.getMemoryHeaps();
    if (memStatus.percentage > value || memStatus.availableMB < memory) {
        return false; // Memory limit reached
    }
    return true; // Memory is within limits
}
const validJsonTypes = [
    "string",   // e.g., "Hello World" (Must use double quotes)
    "number",   // e.g., 42, -12, or 3.14159 (Standard integers and floats)
    "boolean",  // e.g., true or false
    "object",   // e.g., { "key": "value" } (Nested key-value pairs)
    "array",    // e.g., [1, 2, "three"] (Ordered lists of values)
    "null"      // e.g., null (Represents an empty or intentional blank value)
];
const binaryTypes = [
    "BINARY",
    "VARBINARY",
    "VARBINARY(MAX)",
    "BYTEA",
    "TINYBLOB",
    "BLOB",
    "MEDIUMBLOB",
    "LONGBLOB",
    "IMAGE",
    "RAW",
    "LONG RAW",
    "BFILE"
];
function toReadable(value) {
    // 1. ADVANCED SPATIAL & GEOMETRY LAYER (MySQL / PG Support)
    if (value !== null && typeof value === 'object') {

        // --- Postgres/PostGIS direct object driver structures ---
        if (value.x !== undefined && value.y !== undefined) {
            return { ischanged: true, value: `POINT(${value.x} ${value.y})`, type: 'point' };
        }

        // --- MySQL Spatial Buffer Parser ---
        if (Buffer.isBuffer(value) && value.length > 4) {
            try {
                const wkbBuffer = value.slice(4);
                const geometry = wkx.Geometry.parse(wkbBuffer);
                const wktString = geometry.toWkt();
                const geomType = geometry.constructor.name.toLowerCase();

                return { ischanged: true, value: wktString, type: geomType };
            } catch (e) {
                // Not geometry data, fall through cleanly
            }
        }
    }

    // 2. Binary Layer -> Converted to Base64 so it is 100% safe for a JSON file!
    if (Buffer.isBuffer(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))) {
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);

        // FIX: Converting to Base64 prevents JSON stringify from corrupting/bloating the buffer
        return { ischanged: true, value: buf.toString('base64'), type: 'buffer_base64' };
    }

    // 3. BigInt
    if (typeof value === 'bigint') {
        return value.toString();
    }

    // 4. Dates
    if (value instanceof Date) {
        return { ischanged: true, value: value.toISOString(), type: 'date' };
    }

    // 5. Special Numbers (NaN, Infinity, -Infinity)
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
        return { ischanged: true, value: value.toString(), type: 'special_num' };
    }

    // 6. PG JSON/JSONB or Array Columns (Executed after Dates & Buffers are safely isolated)
    if (value !== null && typeof value === 'object') {
        return { ischanged: true, value: JSON.stringify(value), type: 'json' };
    }

    // 7. Direct Native Hex & Base64 Detection Layer
    if (typeof value === 'string') {
        if (value.length % 2 === 0 && value.length > 64) {
            const testHexBuf = Buffer.from(value, 'hex');
            if (testHexBuf.toString('hex').toLowerCase() === value.toLowerCase()) {
                return { ischanged: false, value: value.toUpperCase(), type: 'hex' };
            }
        }

        if (value.length % 4 === 0 && value.length > 64) {
            if (!/[\s]/.test(value)) {
                const testB64Buf = Buffer.from(value, 'base64');
                if (testB64Buf.toString('base64') === value) {
                    return { ischanged: false, value: value, type: 'base64' };
                }
            }
        }
    }

    // 8. Default Fallback (Strings, standard Numbers, Booleans, Nulls)
    return value;
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
function textBufferToString(bufferObj) {
    try {
        // 1. Guard clause: Return null if no data is provided
        if (!bufferObj) {
            return null;
        }

        // 2. Normalize into a standard Node.js Buffer
        const buf = Buffer.isBuffer(bufferObj)
            ? bufferObj
            : Buffer.from(bufferObj.buffer, bufferObj.byteOffset, bufferObj.byteLength);

        // 3. Text Validation Sniffer
        // Look at the first 100 bytes. If we find invisible binary control codes,
        // it means this is a real file (like an image or archive), NOT plain text.
        const sampleSize = Math.min(buf.length, 100);
        let isText = true;

        for (let i = 0; i < sampleSize; i++) {
            const byte = buf[i];

            // Control character bounds (Bypasses valid text whitespaces: Tab \t, Line Feed \n, Carriage Return \r)
            if (byte < 9 || (byte > 13 && byte < 32)) {
                isText = false;
                break;
            }
        }

        // 4. Conditional Output
        if (isText) {
            return buf.toString('utf8'); // Safely unpacks "Hi how are you"
        }

        return null; // Returns null because it's a true binary file (PNG, ZIP, etc.)

    } catch (error) {
        // Catches unexpected issues (e.g., passing numbers or objects that aren't buffers)
        return null;
    }
}
function toBuffer(input) {
    // 1. Quick validation guard for missing values
    if (input === null || input === undefined) {
        return false;
    }

    // 2. Wrap everything in a try block to catch unpredictable runtime engine failures
    try {
        // If it's already a Buffer, return it as-is
        if (Buffer.isBuffer(input)) {
            return input;
        }

        // Handle TypedArrays / ArrayBuffers safely (e.g., Uint8Array)
        if (input && input.buffer && input.byteLength !== undefined) {
            return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        }

        // Handle Strings (Detect Hex, Base64, or fallback to plain UTF-8 text)
        if (typeof input === 'string') {
            const cleanStr = input.trim();
            if (cleanStr === '') return false;

            // Check for Hex format
            if (/^[0-9a-fA-F]+$/.test(cleanStr) && cleanStr.length % 2 === 0) {
                return Buffer.from(cleanStr, 'hex');
            }

            // Check for Base64 format
            if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cleanStr)) {
                return Buffer.from(cleanStr, 'base64');
            }

            // Standard text fallback
            return Buffer.from(input, 'utf8');
        }

        // Handle Arrays (Checks if it's an array of raw bytes)
        if (Array.isArray(input)) {
            if (input.length === 0) return false;
            return Buffer.from(input);
        }

        // Handle Objects (Converts literal objects into a minified JSON text block)
        if (typeof input === 'object') {
            const jsonString = JSON.stringify(input);
            return Buffer.from(jsonString, 'utf8');
        }

        // Handle Numbers, Booleans, and BigInts safely by converting to text explicitly
        if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
            return Buffer.from(String(input), 'utf8'); // Using String(input) is safer than input.toString()
        }

    } catch (error) {
        // Log the error internally if needed: console.error("Buffer conversion failed:", error.message);
        return false; // Fail gracefully instead of crashing the server
    }

    // If it's a Function, Symbol, or unhandled type
    return false;
}
function restoreSpecialNumber(savedData) {
    return parseFloat(savedData);
}

async function deleteRowByOffset(dbConfig, dbName, tableName, offset) {
    let pool = null;

    try {
        pool = mysql.createPool({
            ...dbConfig,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 1
        });

        const safeTableName = tableName.replace(/`/g, '');

        // CHANGE: Use pool.query() instead of pool.execute() to prevent prepared statement errors
        const selectQuery = `SELECT * FROM \`${safeTableName}\` LIMIT 1 OFFSET ?`;
        const [targetRows] = await pool.query(selectQuery, [Number(offset)]);

        // If no row exists at that offset index, exit early gracefully
        if (targetRows.length === 0) {
            return false;
        }

        const targetRow = targetRows[0];
        const columns = Object.keys(targetRow);

        // Build a dynamic WHERE clause matching all column values of that specific row
        const whereConditions = columns.map(col => `\`${col}\` <=> ?`).join(' AND ');
        const queryValues = Object.values(targetRow);

        const deleteQuery = `
            DELETE FROM \`${safeTableName}\` 
            WHERE ${whereConditions} 
            LIMIT 1
        `;

        // Using pool.query() here ensures null-safe matches go through smoothly
        const [result] = await pool.query(deleteQuery, queryValues);
        return result.affectedRows > 0;

    } catch (error) {
        console.error(`❌ Error deleting row at offset ${offset} from [${tableName}]:`, error.message);
        throw error;

    } finally {
        if (pool) {
            await pool.end();
        }
    }
}
// Fetch rows in chunks until memory limit is approached
async function getRowsUntilMemoryLimit(config, databaseName, tableName, startOffset = 0, thresholdPercent = 70, chunkSize = 1000) {
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
async function getSingleRowUntilMemoryLimit(config, databaseName, tableName, offset = 0, chunkSize = 1000) {
    try {
        let data = [];
        let errorcount = 0;
        let isfinished = true;
        let rowoffset = offset;
        let status = "completed";
        let errorLevel = 0;
        let rowSizeMB = 0;
        let rowCount = 0;
        // Lets get rows one by one
        let keepFetching = true;
        while (keepFetching) {
            if (rowCount >= chunkSize) {
                isfinished = false;
                status = "chunk_limit";
                break;
            }
            const memStatus = filefunctions.getMemoryHeaps();
            if (memStatus.percentage > 80 || memStatus.availableMB < 200) {
                console.warn(`Memory limit reached while fetching single row at offset: ${rowoffset}`);
                status = "memory_limit";
                isfinished = false;
                break;
            }
            // Lets check available memory and row size if we can continue or not
            const rowmetadata = await getmtd.getColumnMetadataAndSize(config, databaseName, tableName, rowoffset);
            if (rowmetadata === false) {
                // no more row left to fetch
                isfinished = true;
                status = "completed";
                break;
            } else if (Array.isArray(rowmetadata)) {
                rowSizeMB = 0;
                for (const col of rowmetadata) {
                    // as function will return an array of data
                    rowSizeMB += col.sizeInBytes / (1024 * 1024);
                }
                const availableMB = filefunctions.getMemoryHeaps(); // Keep a 200MB buffer to prevent hitting critical limits
                if (rowSizeMB > (availableMB.availableMB - 200)) {
                    status = "memory_limit";
                    isfinished = false;
                    break;
                } else if (rowSizeMB > (availableMB.limitMB - 200)) {
                    /**
                     * if row size is bigger than total heap size
                     * in future update will will try to save the file directly from database to folder
                     * but right now we are good to go
                     */
                    console.error(`${cstyler.purple("Database:")} ${cstyler.blue(databaseName)}-${cstyler.purple("Table:")} ${cstyler.blue(tableName)}-${cstyler.purple("Offset:")} ${cstyler.yellow(rowoffset)} ${cstyler.red(` - Row size (${rowSizeMB.toFixed(2)} MB) exceeds total heap limit (${availableMB.limitMB} MB). We are skipping.`)}`);
                    continue; // Skip this row and try the next one, or implement a fallback strategy
                }
            } else {
                // if there is any error we will stop the process and return the data we have
                if (errorcount >= 3) {
                    console.error(`${cstyler.purple("Database:")} ${cstyler.blue(databaseName)}-${cstyler.purple("Table:")} ${cstyler.blue(tableName)}-${cstyler.purple("Offset:")} ${cstyler.yellow(rowoffset)} ${cstyler.red("Error fetching column metadata for single row. Aborting.")}`);
                    status = "error";
                    errorLevel = 2;
                    isfinished = false;
                    break;
                }
                errorcount++;
                continue; // Try fetching the same row again
            }
            // If we are here that means we can fetch the row safely without hitting memory limits
            const row = await getSingleRowAsJson(config, databaseName, tableName, rowoffset);
            if (row === false) {
                isfinished = true;
                status = "completed";
                break;
            } else if (row === null) {
                if (errorcount >= 3) {
                    console.error(`${cstyler.purple("Database:")} ${cstyler.blue(databaseName)}-${cstyler.purple("Table:")} ${cstyler.blue(tableName)}-${cstyler.purple("Offset:")} ${cstyler.yellow(rowoffset)} ${cstyler.red("Repeated errors fetching single row. Aborting.")}`);
                    // before break lets check row size and available memory size if we can continue or not
                    status = "error";
                    isfinished = false;
                    break; // Stop trying after 3 consecutive errors
                }
                errorcount++;
                continue; // Try fetching the same row again
            }
            data.push(row);
            rowoffset++;
            rowCount++;
        }
        return { isfinished: isfinished, status: status, offset: rowoffset, data: data, count: rowCount };

    } catch (err) {
        console.error("Error fetching single row:", err.message);
        return null;
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
async function _subSavefile(data, filePath = null) {
    try {
        // You should pass only buffer, base64 string or hex string to this function
        let folderPath = null;
        if (filePath !== null) {
            folderPath = path.resolve(filePath);
        } else {
            filePath = "./backupfiles/backup/database/files/";
            folderPath = path.resolve(filePath);
        }
        const fileNameWithoutExt = await filefunctions.getNextFileName(folderPath);
        const savefile = await filefunctions.saveDataToFile(data, folderPath, String(fileNameWithoutExt));
        // { success: false, isText: true, data: data }
        // { success: true, path: finalPath, fileName: `${fileNameWithoutExt}.${detectedExt}`, extension: detectedExt };
        let returndata = {};
        if (savefile === null) {
            return null;
        } else if (savefile.success === true) {
            returndata = { isSaved: true, filepath: path.join(filePath, savefile.fileName), type: 'file' };
        } else {
            returndata = data;
        }
        return returndata;
    } catch (err) {
        console.error(cstyler.red("Error in _subSavefile:"), err.message);
        return null;
    }
}
async function writeDataToFileBig(data) {
    try {
        for (const db of Object.keys(data)) {
            for (const table of Object.keys(data[db])) {
                let tableData = data[db][table];
                data[db][table] = []; // Clear the table data to free memory as we will write row by row
                while (tableData.length > 0) {
                    if (tableData.length === 0) {
                        break; // while loop runs at least once
                    }
                    let rowData = tableData.pop(); // Get the first row and remove it from the array to free memory
                    for (const col of Object.keys(rowData)) {
                        let colValue = rowData[col];
                        rowData[col] = null; // Clear original value to free memory
                        // if no need to make it readable then we will not make all row readable it takes up a lot of memory
                        // lets check if the value is buffer of 64 based string
                        if (!fncs.isJsonObject(colValue) || !colValue.hasOwnProperty("type") || !colValue.hasOwnProperty("ischanged") || !colValue.hasOwnProperty("value")) {
                            // Lets make it readable if it is not in our format
                            colValue = toReadable(colValue);
                        }
                        if (colValue.hasOwnProperty("isBinaryColumn") && colValue.isBinaryColumn === true) {
                            if (['base64', 'hex', 'buffer'].includes(colValue.type)) {
                                const errorcount = 0;
                                while (errorcount < 3) {
                                    const savethefile = await _subSavefile(colValue.value);
                                    // { isSaved: true, filepath: filepath + savefile.fileName, type: 'file' };
                                    // data
                                    if (savethefile === null) {
                                        errorcount++;
                                        continue; // Try saving the same data again
                                    }/* else if (savethefile.hasOwnProperty("isSaved") && savethefile.isSaved === true) {
                                        rowData[col] = savethefile; // Replace the value with file path
                                    }*/ else {
                                        rowData[col] = savethefile; // Replace the value with original data if saving failed but we got readable data back
                                    }
                                    break; // Break the loop after a successful save or a non-retryable failure
                                }
                                if (errorcount >= 3 && savethefile === null) {
                                    console.error(cstyler.red("Failed to save file for column:"), col, "Database:", db, "Table:", table, "Row:", row);
                                    if (colValue.type === 'buffer') {
                                        rowData[col] = colValue;
                                        rowData[col].value = bufferToHex(colValue.value);
                                        rowData[col].type = 'hex';
                                        rowData[row][col].from = 'buffer';
                                    } else {
                                        rowData[col] = colValue;
                                    }
                                }
                            } else {
                                rowData[col] = colValue; // Add the (possibly transformed) column value to the row data
                            }
                        } else {
                            rowData[col] = colValue; // Add the (possibly transformed) column value to the row data
                        }
                    }
                    data[db][table].push(rowData); // Add the processed row back to the data structure
                }
            }
        }
        return data;
    } catch (err) {
        console.error(cstyler.red("Error writing data to file:"), err.message);
        return null;
    }
}
async function makeDataReadable(config, data) {
    try {
        let savableData = {};
        for (const db of Object.keys(data)) {
            if (!savableData.hasOwnProperty(db)) savableData[db] = {};
            for (const table of Object.keys(data[db])) {
                const tableData = data[db][table];
                data[db][table] = []; // Clear original data to free memory as we will process row by row
                if (!savableData[db].hasOwnProperty(table)) savableData[db][table] = {};
                // lets get the metadata of this table to check which column is binary and which column is json
                const getmetadata = getmtd.getTableSchemaLayout(config, db, table);
                if (!fncs.isJsonObject(getmetadata)) {
                    if (getmetadata === null) {
                        return null;
                    }
                }
                while (tableData.length > 0) { // This is an array of rows, so we iterate through each row
                    let rowData = tableData.pop(); // Get the first row and remove it from the array to free memory
                    for (const col of Object.keys(rowData)) {
                        let colValue = rowData[col];
                        // lets make data readable
                        let isBinary = null;
                        // Check metadata to determine if this column is binary
                        if (fncs.isJsonObject(getmetadata) && getmetadata[col]) {
                            const colType = getmetadata[col].type.toUpperCase();
                            if (binaryTypes.includes(colType)) {
                                isBinary = true;
                            }
                        }
                        rowData[col] = toReadable(colValue);
                        rowData[col].isBinaryColumn = isBinary; // Add binary type info for later processing if needed
                    }
                    data[db][table].push(rowData); // Add the processed row back to the data structure
                }
            }
        }
        return data;
    } catch (err) {
        console.error(cstyler.red("Error making data readable:"), err.message);
        return null;
    }
}
function getChunkSize(memStatus = null) {
    if (memStatus === null) {
        memStatus = filefunctions.getMemoryHeaps();
    }
    let chunkSize = 1000; // Default chunk size for high memory machines
    if (memStatus.availableMB < 200) {
        console.error(cstyler.red("Critical Memory Warning: Available memory RAM is below 200MB. The process may fail due to insufficient memory."));
        return null;
    } else if (memStatus.availableMB < 1024) {
        chunkSize = 100; // Drastically reduce chunk size for low memory environments
    } else if (memStatus.availableMB >= 1024 && memStatus.availableMB < 4096) {
        chunkSize = 1000; // Moderate chunk size for mid-range machines
    } else {
        chunkSize = 2000; // Full chunk size for high-end machines
    }
    return chunkSize;
}
// Lets get all the rows of all tables of all databases and write to file
async function getallrows(config, jsondata) {
    try {
        let data = {};
        let count = 0;
        let errorHappened = false;
        // Lets get memory status before starting the process
        const memStatus = filefunctions.getMemoryHeaps(); // if memory limit we will check the differance of memory to check the size of data stored on variable and memory we have
        let chunkSize = getChunkSize(memStatus);
        if (chunkSize === null) {
            return null;
        }
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
                    const result = await getRowsUntilMemoryLimit(config, db, table, offset, 70, chunkSize);
                    if (result.isFinished === true) {
                        data[db][table].push(...result.data);
                        offset = 0; // Reset offset for next table
                        isfinished = true;
                        errorcount = 0; // Reset error count for next table
                    } else if (result.status === "memory_limit") {
                        data[db][table].push(...result.data);
                        result.data = []; // Clear chunk data to free memory
                        offset = result.nextOffset; // Update offset for next chunk
                        data = makeDataReadable(config, data);
                        /**
                         * @(2) conditions can happen here
                         * 1. If we have enough available memory then we will run single row operation function
                         * 2. else we will save file and continue with next chunk
                         */
                        const memStatusAfter = filefunctions.getMemoryHeaps();
                        const availableMemoryPercent = 100 * memStatusAfter.availableMB / memStatus.availableMB;
                        if (availableMemoryPercent > 50) {
                            // run single row operation function
                            const singleRowResult = await getSingleRowUntilMemoryLimit(config, db, table, offset, chunkSize);
                        } else {
                            // Lets make data readable
                            // Lets check if we can save any file
                            // Then check memory uses
                            const writeResult = await filefunctions.writeJsonFile(`${folderPath}${String(count)}.json`, data);
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
                            // if there is any error we will run getRowsUntilMemoryLimit function again with same offset until we get the data or we get 3 error then we will skip this table and continue with next table
                            errorcount = 0; // Reset error count for next chunk
                        }
                    } else if (result.status === "error") {
                        console.error(cstyler.red("Error fetching rows:"), result.message);
                        if (errorcount < 3) {
                            errorcount++;
                            continue; // Try fetching the same chunk again
                        } else {
                            console.error(cstyler.red("Repeated errors fetching rows."));
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
    toBuffer,
    bufferToHex,
    getallrows,
    deleteRowByOffset,
    getRowsUntilMemoryLimit,
    getSingleRowAsJson,
    toReadable,
}