const fncs = require('./functions');
const cstyler = require('cstyler');
const mysql = require('mysql2/promise');
const v8 = require('v8');
const fs = require('fs').promises;
const { createReadStream, createWriteStream, existsSync, read } = require('fs');
const { pipeline } = require('stream/promises');
const path = require('path');
const { count } = require('console');
const filefunctions = require('./filefunctions');
const getmtd = require("./getmetadata");
const links = require("./links");
const { off } = require('cluster');




/**
 * @param {MEMORY RAM PROBLEM solved} on_checking_variable_size
 * @param {calculating memory ram} - is using extra ram
 * @param {differant idea} memory We will store available memory before store data in variable
 * @param {next move} then we will check available memory after we store data
 * @returns 
 */
const mec = 3; // max error count

function checkMemoryLimit(value = 90, memory = 300) {
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
const textTypes = [
    // --- Standard Character Strings ---
    "CHAR",
    "VARCHAR",
    "NCHAR",
    "NVARCHAR",
    "VARCHAR2",  // Oracle specific
    "NVARCHAR2", // Oracle specific

    // --- Text Blob/CLOB Strings ---
    "TEXT",
    "TINYTEXT",
    "MEDIUMTEXT",
    "LONGTEXT",
    "CLOB",
    "NCLOB",

    // --- JSON & XML (Sticker string representations) ---
    "JSON",
    "XML"
];
async function totalRowCount(config, database, table) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let connection;
        try {
            connection = await mysql.createConnection(config);

            // 1. Get total rows (Variables corrected to match arguments 'database' and 'table')
            const [countResult] = await connection.execute(
                `SELECT COUNT(*) AS total FROM \`${database}\`.\`${table}\``
            );

            const totalRows = Number(countResult[0]?.total || 0);
            return totalRows; // 🏁 Success! Return the count and exit.

        } catch (err) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed fetching row count for ${table}: ${err.message}`);

            if (attempt < maxRetries) {
                // Wait for 1 second before attempting a clean retry connection
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                // All 3 tries failed completely
                console.error("❌ All attempts failed fetching row count. Error message: ", err.message);
                return null;
            }
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }
}
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
        return { ischanged: true, value: buf.toString('base64'), type: 'buffer', from: 'base64' };
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
    if (fncs.isJsonObject(value) || fncs.isJsonString(value)) {
        if (value.hasOwnProperty("ischanged") || value.hasOwnProperty("isSaved")) {
            return value;
        }
        return { ischanged: true, value: fncs.stringifyAny(value), type: 'json' };
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

// Fetch rows in chunks until memory limit is approached
function getChunkSize(memStatus = null) {
    if (memStatus === null) {
        memStatus = filefunctions.getMemoryHeaps();
    }
    let chunkSize = 1000; // Default chunk size for high memory machines
    if (memStatus.availableMB < 300) {
        console.error(cstyler.red("Critical Memory Warning: Available memory RAM is below 300MB. The process may fail due to insufficient memory."));
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
async function getColumnValueByOffset(config, databaseName, tableName, offset, columnName) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let connection;
        try {
            connection = await mysql.createConnection(config);

            // Fetch exactly 1 column from exactly 1 row at the targeted offset index
            const query = `
                SELECT \`${columnName}\` 
                FROM \`${databaseName}\`.\`${tableName}\` 
                LIMIT 1 OFFSET ${Number(offset)}
            `;

            const [rows] = await connection.execute(query);

            // If no row exists at this offset index boundary, return false cleanly
            if (rows.length === 0) {
                return false;
            }

            // Extract the raw column value directly from the object row map
            const targetValue = rows[0][columnName];

            // Return the value (even if it is explicitly null, zero, or an empty string)
            return { value: targetValue };

        } catch (err) {
            if (err.message.toLowerCase().includes('unknown column')) {
                return false;
            }
            console.warn(`⚠️  Attempt ${attempt}/${maxRetries} failed fetching column "${columnName}" from ${tableName}: ${err.message}`);

            if (attempt < maxRetries) {
                // Cool down for 1 second before retrying the connection
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed fetching column value.`);
                return null; // Return null to indicate a hard execution failure
            }
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }
}
// Lets work on single row limit
async function getSingleRowUntilMemoryLimit(config, databaseName, tableName, offset = 0, chunkSize = 1000, forceDownload = false) {
    try {
        // This function gets rows of a one table only
        let data = [];
        let isfinished = true;
        let status = "completed";
        let errorLevel = 0;
        let rowSizeMB = 0;
        let rowCount = 0;
        let isLimit = false;

        // Lets get rows one by one
        const totalRow = await totalRowCount(config, databaseName, tableName);
        if (totalRow === null) {
            throw new Error("Having problem featching row count.");
        }
        // Keep featching row one by one until break
        while (true) {
            if (totalRow <= offset) {
                isfinished = true;
                status = "completed";
                break;
            }
            if (rowCount >= chunkSize) {
                isfinished = false;
                status = "chunk_limit";
                break;
            }
            // Lets check if memory limit
            if (rowCount > 0 && !checkMemoryLimit(90, 200)) {
                console.warn(`Memory limit reached while fetching single row at offset: ${offset}`);
                status = "memory_limit";
                isfinished = false;
                break;
            }
            // Lets check available memory and row size if we can continue or not
            const rowmetadata = await getmtd.getRowMetadataAndSize(config, databaseName, tableName, offset);
            if (rowmetadata === false) {
                // no more row left to fetch
                isfinished = true;
                status = "completed";
                break;
            } else if (fncs.isJsonObject(rowmetadata)) {
                // Lets check if total row size bigger than available memory ram or not
                const memheap = filefunctions.getMemoryHeaps();
                if (rowmetadata.totalRowSizeinMB > (memheap.availableMB - 200)) {
                    // Lets check each column if we can save them one by one
                    let skiprow = false;
                    for (const item of rowmetadata.columns) {
                        // Lets check each column size
                        const sizeinMB = item.sizeInBytes / 1024 / 1024;
                        const columntype = item.type.toUpperCase();
                        if (sizeinMB > (memheap.availableMB - 200)) {
                            // skip the row
                            if (rowCount > 0) {
                                status = 'memory_limit'
                                isfinished = false;
                                isLimit = true;
                                break;
                            }
                            if (forceDownload) {
                                skiprow = true;
                                break;
                            } else {
                                status = "error";
                                isfinished = false;
                                // if can not skip row then no need to run the download process
                                throw new Error(`Database: ${databaseName} Table: ${tableName} Offset: ${offset} Row size: ${rowmetadata.totalRowSizeinMB} MB exceeded the limit of available memory RAM size: ${memheap.availableMB} MB - 200 MB(reserved for calculation. If you don't want this row then activate force to true in config.)`)
                            }
                        }
                    }
                    // if skip row is On then we will continue
                    if (isLimit) {
                        break;
                    }
                    // if force download is true then we can skip row if bigger than available memory
                    if (skiprow) {
                        offset++;
                        continue;
                    }
                    let rowdata = {};
                    for (const item of rowmetadata.columns) {
                        const sizeinMB = item.sizeInBytes / 1024 / 1024;
                        const columntype = item.type.toUpperCase();
                        const columnName = item.column;
                        const columnData = await getColumnValueByOffset(config, databaseName, tableName, offset, columnName);
                        if (columnData.hasOwnProperty("value")) {
                            // Lets check if data is savable or not
                            if (columnData.value === null) {
                                rowdata[columnName] = null;
                                continue;
                            }
                            let readableData = toReadable(columnData.value);
                            // sometimes toReadable returns plain data like string, number
                            if (fncs.isJsonObject(readableData)) {
                                if (['hex', 'buffer', 'base64'].includes(readableData.type)) {
                                    const savefile = await _subSavefile(readableData.value);
                                    if (savefile === null) {
                                        // do nothing keep the file on readable data
                                        // Because if it is bigger than 1 MB then
                                        // in the next block it will be processed
                                    } else if (savefile.hasOwnProperty("isSaved") && savefile.isSaved === true) {
                                        rowdata[columnName] = savefile;
                                        continue;
                                    } else {
                                        readableData = savefile; // Replace the value with original data if saving failed but we got readable data back
                                    }
                                }
                            }
                            if (sizeinMB > 1 && (!fncs.isJsonObject(readableData) || readableData.isSaved !== true)) {
                                let saveDataSingle = null;
                                if (fncs.isJsonObject(readableData) && readableData.hasOwnProperty("value")) {
                                    saveDataSingle = readableData.value;
                                    // if not saved it will not have any saving informaiton
                                } else {
                                    saveDataSingle = fncs.stringifyAny(readableData);
                                }
                                const saveFile = await _subSavefile(saveDataSingle);
                                if (saveFile === null) {
                                    status = "error";
                                    isfinished = false;
                                    throw new Error("Having problem saving data to file.")
                                }
                                rowdata[columnName] = saveFile;
                            } else {
                                rowdata[columnName] = readableData;
                            }
                        } else if (columnData === false) {
                            continue;
                        } else {
                            status = "error";
                            isfinished = false;
                            throw new Error("Having problem getting column data.");
                        }
                    }
                    data.push(rowdata);
                    rowCount++;
                    offset++;
                } else {
                    // Row data size is not bigger than available memory size
                    // Lets get whole row at once
                    // If we are here that means we can fetch the row safely without hitting memory limits
                    const row = await getSingleRowAsJson(config, databaseName, tableName, offset);
                    /**
                     * @param {It Returns}
                     * @param {false}
                     * @param {null}
                     * @param {ROW data as JSON}
                     */
                    if (fncs.isJsonObject(row)) {
                        let readableData = {};
                        for (const item of Object.keys(row)) {
                            const readable = toReadable(row[item]);
                            if (fncs.isJsonObject(readable)) {
                                if (['hex', 'buffer', 'base64'].includes(readable.type)) {
                                    const letSave = await _subSavefile(readable.value);
                                    if (letSave === null) {
                                        status = "error";
                                        isfinished = false;
                                        throw new Error("Having problem savign column data as file when the file is BLOB column.");
                                    }
                                    readableData[item] = letSave;
                                } else {
                                    readableData[item] = readable;
                                }
                            } else {
                                readableData[item] = readable;
                            }
                        }
                        data.push(row);
                        rowCount++;
                        offset++;
                    } else if (row === false) {
                        isfinished = true;
                        status = "completed";
                        break;
                    } else {
                        status = "error";
                        isfinished = false;
                        console.error(`${cstyler.purple("Database:")} ${cstyler.blue(databaseName)}-${cstyler.purple("Table:")} ${cstyler.blue(tableName)}-${cstyler.purple("Offset:")} ${cstyler.yellow(offset)} ${cstyler.red("Repeated errors fetching single row. Aborting.")}`);
                        // before break lets check row size and available memory size if we can continue or not
                        throw new Error(`Unable to featch the ROW data of Database: ${databaseName} Table: ${tableName} Offset: ${offset}`);
                    }
                }
            } else {
                // if there is any error we will stop the process and return the data we have
                status = "error";
                isfinished = false;
                throw new Error(`Unable to get ROW METADATA of Database: ${databaseName} Table: ${tableName} Offset: ${offset}`);
            }
        }
        return { isfinished: isfinished, status: status, offset: offset, data: data, count: rowCount };
    } catch (err) {
        console.error("Error fetching single row:", err.message);
        if (data.length > 0) {
            return { isfinished: isfinished, status: status, offset: offset, data: data, count: rowCount, message: err.message };
        }
        return null;
    }
}
async function getSingleRowAsJson(config, databaseName, tableName, offset) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

            if (fields.length === 0) return false; // Table doesn't exist

            // Filter out BLOB and binary tracking columns using lowercase string inspection
            const blobCols = fields.filter(f => {
                const type = String(f.DATA_TYPE).toLowerCase();
                return type.includes('blob') ||
                    type === 'binary' ||
                    type === 'varbinary' ||
                    type === 'bytea' ||
                    type === 'image';
            }).map(f => f.COLUMN_NAME);

            const jsonCols = fields
                .filter(f => String(f.DATA_TYPE).toLowerCase() === 'json')
                .map(f => f.COLUMN_NAME);

            // 2. Fetch the actual row data
            const [rows] = await connection.execute(
                `SELECT * FROM \`${databaseName}\`.\`${tableName}\` LIMIT 1 OFFSET ${Number(offset)}`
            );

            if (rows.length === 0) return false; // No row found at this offset

            // mysql2 returns BLOBs as Buffers automatically
            const row = rows[0];

            // 3. Convert Buffers to Base64 Strings
            for (const col of blobCols) {
                if (Buffer.isBuffer(row[col])) {
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

            return row; // 🏁 Success! Return the data and exit the retry loop.

        } catch (err) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed getting single row as JSON for ${tableName}: ${err.message}`);

            if (attempt < maxRetries) {
                // Cool down for 1 second before attempting a clean retry connection
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                // All 3 tries failed completely
                console.error("❌ All attempts failed getting row JSON. Error message: ", err.message);
                return null;
            }
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }
}
// single row operation function are end here
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
            // Lets check available memory size
            const memoryAvl = filefunctions.getMemoryHeaps();
            const avlMemSize = memoryAvl.availableMB - ((100 - thresholdPercent) * memoryAvl.limitMB / 100);
            const rowLeft = totalRows - (currentOffset - 1);
            // Lets get chunk size
            const getChunkSizeFromTargetMB = await getmtd.getChunkSizeFromTargetMB(config, databaseName, tableName, currentOffset, avlMemSize);
            if (typeof getChunkSizeFromTargetMB === 'number' && getChunkSizeFromTargetMB > 0) {
                if (getChunkSizeFromTargetMB > 5000) {
                    chunkSize = 5000;
                } else if (getChunkSizeFromTargetMB < chunkSize) {
                    chunkSize = getChunkSizeFromTargetMB;
                }
            } else if (getChunkSizeFromTargetMB === 0) {
                // before break the loop lets check the status
                if (totalRows <= currentOffset) {
                    status = "completed";
                } else {
                    status = "memory_limit";
                }
                break; // if no row can be acuired no need to run
            } else {
                throw new Error("Unable to get chunk size metadata from given size in MB when trying to get rows until memory limit.");
            }

            try {
                // Fetch chunk
                if (!checkMemoryLimit(70, 300)) {
                    return { data: allData, count: allData.length, nextOffset: currentOffset, status: "memory_limit", isFinished: false };
                }
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
            count: allData.length,
            nextOffset: currentOffset,
            totalRows: totalRows,
            status: status, // "completed", "memory_limit", or "error"
            isFinished: currentOffset >= totalRows
        };
    } catch (fatalErr) {
        console.error("Fatal Connection Error:", fatalErr.message);
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
            returndata = { isSaved: true, fileName: savefile.fileName, extention: savefile.extension, filepath: path.join(filePath, savefile.fileName), type: 'file' };
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
                        if (colValue.hasOwnProperty("isBinaryColumn") && colValue.isBinaryColumn === true) {
                            if (['base64', 'hex', 'buffer'].includes(colValue.type)) {
                                const savethefile = await _subSavefile(colValue.value);
                                // if saved returns { isSaved: true, filepath: filepath + savefile.fileName, type: 'file' };
                                // if not saved returns data
                                if (savethefile === null) {
                                    console.error(cstyler.red("Failed to save file for column:"), col, "Database:", db, "Table:", table, "Row:", row);
                                    if (colValue.type === 'buffer') {
                                        rowData[col] = colValue;
                                        rowData[col].value = bufferToHex(colValue.value);
                                        rowData[col].type = 'hex';
                                        rowData[row][col].from = 'buffer';
                                    } else {
                                        rowData[col] = colValue;
                                    }
                                } else if (savethefile.hasOwnProperty("isSaved") && savethefile.isSaved === true) {
                                    rowData[col] = savethefile;
                                } else {
                                    rowData[col] = savethefile; // Replace the value with original data if saving failed but we got readable data back
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
        return { success: true, data: data };
    } catch (err) {
        console.error(cstyler.red("Error writing data to file:"), err.message);
        return { success: null, data: data, message: err.message };
    }
}
async function makeDataReadable(config, data) {
    try {
        let savableData = {};
        for (const db of Object.keys(data)) {
            // check available memory
            if (!checkMemoryLimit(90, 200)) {
                const writeFile = await writeDataToFileBig(savableData);
                savableData = writeFile.data;
                if (!checkMemoryLimit(90, 200)) {
                    return { success: false, data: data, processed: savableData, isfinished: false };
                }
            }
            if (!savableData.hasOwnProperty(db)) savableData[db] = {};
            for (const table of Object.keys(data[db])) {
                if (!savableData[db].hasOwnProperty(table)) savableData[db][table] = [];
                // check available memory
                if (!checkMemoryLimit(90, 200)) {
                    const writeFile = await writeDataToFileBig(savableData);
                    savableData = writeFile.data;
                    if (!checkMemoryLimit(90, 200)) {
                        return { success: false, data: data, processed: savableData, isfinished: false };
                    }
                }
                // lets get the metadata of this table to check which column is binary and which column is json
                const getmetadata = await getmtd.getTableSchemaLayout(config, db, table);
                if (getmetadata === null) {
                    throw new Error("Having problem getting TABLE schema layout.")
                }
                let tableData = data[db][table];
                data[db][table] = []; // Clear original data to free memory as we will process row by row
                let rowcount = 0;
                while (tableData.length > 0) { // This is an array of rows, so we iterate through each row
                    if (rowcount >= 100) {
                        // check available memory
                        if (!checkMemoryLimit(90, 200)) {
                            const writeFile = await writeDataToFileBig(savableData);
                            savableData = writeFile.data;
                            if (!checkMemoryLimit(90, 200)) {
                                data[db][table] = tableData;
                                const writefile = await writeDataToFileBig(savableData);
                                savableData = writefile.data;
                                return { success: false, data: data, processed: savableData, isfinished: false };
                            }
                        }
                        rowcount = 0;
                    }
                    let rowData = tableData.pop(); // Get the first row and remove it from the array to free memory
                    for (const col of Object.keys(rowData)) {
                        let colValue = rowData[col];
                        // lets make data readable
                        let isBinary = false;
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
                    savableData[db][table].push(rowData); // Add the processed row back to the data structure
                    rowcount++;
                }
            }
        }
        const finalwriteFile = await writeDataToFileBig(savableData);
        savableData = finalwriteFile.data;
        return { success: true, data: data, processed: savableData, isfinished: true };
    } catch (err) {
        console.error(cstyler.red("Error making data readable:"), err.message);
        return { success: null, message: err.message }
    }
}
function memDifPercent(memory) {
    const memStatus = filefunctions.getMemoryHeaps();
    const perc = memStatus.percentage - memory.percentage;
    const inMB = memStatus.availableMB - memory.availableMB;
    if (perc >= 25 && inMB >= 200) return true;
    return false; // Memory is within limits
}
function isNearlySame(num1, num2, tolerancePercentage) {
    // 1. Handle the exact match edge case instantly
    if (num1 === num2) return true;

    // 2. Find the absolute mathematical difference between the numbers
    const absoluteDifference = Math.abs(num1 - num2);

    // 3. Determine the baseline (using the higher value ensures a strict percentage boundary)
    const baseline = Math.max(Math.abs(num1), Math.abs(num2));

    // 4. Calculate the actual percentage difference
    const actualPercentDiff = (absoluteDifference / baseline) * 100;

    // 5. Return whether the difference is within your target threshold
    return actualPercentDiff <= tolerancePercentage;
}
function cleanVariable(data) {
    for (const db of Object.keys(data)) {
        for (const table of Object.keys(data[db])) {
            if (data[db][table].length === 0) {
                delete data[db][table];
            }
        }
    }
    for (const db of Object.keys(data)) {
        if (Object.keys(data[db]).length === 0) {
            delete data[db];
        }
    }
    return data;
}
// Lets get all the rows of all tables of all databases and write to file
async function getallrows(config, jsondata, forceDownload = false) {
    try {
        let data = {};
        let count = 0;
        let errorHappened = false;
        let isfinished = false;
        let offset = 0;
        let errorcount = 0;
        // Lets get memory status before starting the process
        const memStatus = filefunctions.getMemoryHeaps(); // if memory limit we will check the differance of memory to check the size of data stored on variable and memory we have
        let chunkSize = getChunkSize(memStatus);
        if (chunkSize === null) {
            return null;
        }
        // Lets check if backup folder exist if not
        const folderPath = path.resolve(links.database);
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
                if (!data[db].hasOwnProperty(table)) data[db][table] = []; // Initialize as empty array to store rows
                // Lets check if table have any row or not
                const rowCount = await rowCount(config, db, table);
                if (rowCount === null) {
                    throw new Error("Having problem featching row count.");
                } else if (rowCount === 0) {
                    continue;
                }
                // lets get all the rows of this table
                while (!isfinished) {
                    const result = await getRowsUntilMemoryLimit(config, db, table, offset, 70, chunkSize);
                    if (result.isFinished === true) {
                        data[db][table].push(...result.data);
                        offset = 0; // Reset offset for next table
                        isfinished = true;
                        errorcount = 0; // Reset error count for next table
                        break;
                    } else if (result.status === "memory_limit") {
                        const getmemheap = filefunctions.getMemoryHeaps();
                        const isNearlySame = isNearlySame(memStatus.availableMB, getmemheap.availableMB, 35);
                        data[db][table].push(...result.data);
                        result.data = null; // Clear chunk data to free memory
                        offset = result.nextOffset; // Update offset for next chunk
                        data = await makeDataReadable(config, data);
                        if (data.success === null) {
                            throw new Error(data.message);
                        } else {
                            const savableData = data.processed;
                            // Lets clear out the variable
                            data = cleanVariable(data.data);
                            if (!data.hasOwnProperty(db)) data[db] = {};
                            if (!data[db].hasOwnProperty(table)) data[db][table] = [];
                            // Variable cleening done
                            // lets data save to file
                            const writeFile = await filefunctions.writeJsonFile(links.databasefiles, savableData);
                            if (writeFile === null) {
                                throw new Error("Having problem writing database files to directory");
                            }
                        }
                        // If there is enough memory but still there is a problem
                        if (isNearlySame) {
                            // Lets run single row operation
                            // now we have enough memory to run next row process
                            const getmemheap = filefunctions.getMemoryHeaps();
                            const getsingle = await getSingleRowUntilMemoryLimit(config, db, table, offset, 200, forceDownload);

                        }
                    } else if (result.status === "error") {
                        console.error(cstyler.red("Error fetching rows:"), result.message);
                        if (errorcount < mec) {
                            errorcount++;
                            continue; // Try fetching the same chunk again
                        } else {
                            console.error(cstyler.red("Repeated errors fetching rows."));
                            errorHappened = true;
                            errorcount = 0; // Reset error count for next table
                            break; // Skip to next table
                        }
                    } else {
                        throw new Error(`Unable to get row data from Database: ${db} Table: ${table} Offset: ${offset}`)
                    }
                }
            }
        }
        console.log(cstyler.green("Successfully done requesting and storing all the row."));
        return data;
    } catch (err) {
        console.error(err.message);
        return { success: null, message: err.message };
    }
}

module.exports = {
    toReadable,
    checkMemoryLimit,
    toBuffer,
    bufferToHex,
    getallrows,
    getColumnValueByOffset,
    getRowsUntilMemoryLimit,
    getSingleRowAsJson,
    _subSavefile,
}