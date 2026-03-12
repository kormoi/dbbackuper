const fncs = require('./functions');
const cstyler = require('cstyler');
const mysql = require('mysql2/promise');
const v8 = require('v8');
const fs = require('fs');


function toReadable(value) {
    // 1. Binary (Buffer / Uint8Array)
    if (Buffer.isBuffer(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))) {
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        return { ischanged: true, value: buf.toString('base64'), type: 'buffer' };
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
    // PostgreSQL driver returns objects/arrays directly. We must stringify for JSON storage.
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        // Check for Spatial (PostGIS/MySQL)
        if (value.x !== undefined && value.y !== undefined) {
            return { ischanged: true, value: `POINT(${value.x} ${value.y})`, type: 'point' };
        }
        // Standard JSONB / Array
        return { ischanged: true, value: JSON.stringify(value), type: 'json' };
    }

    // 5. Special Numbers
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
        return { ischanged: true, value: value.toString(), type: 'special_num' };
    }

    // 6. Existing Base64 Detection (Fallback)
    if (typeof value === 'string') {
        const start = value.substring(0, 16);
        const isFileBase64 = /^(?:\/9j\/|iVBOR|R0lGO|UklGR|JVBER|UEsDB|ey|OEJQU|AAAAG|GkXfo|UmFyI|N3q8r)/.test(start);
        if (isFileBase64 || (value.length > 100 && /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(value))) {
            return { ischanged: true, value: value, type: 'buffer' };
        }
    }

    return { ischanged: false, value: value, type: typeof value };
}
function toPrevious(value, explicitType = null) {
    if (explicitType) {
        switch (explicitType) {
            case 'buffer':
                return { ischanged: true, value: Buffer.from(value, 'base64') };
            case 'date':
                return { ischanged: true, value: new Date(value) };
            case 'bigint':
                return { ischanged: true, value: BigInt(value) };
            case 'json':
                try {
                    return { ischanged: true, value: JSON.parse(value) };
                } catch (e) {
                    return { ischanged: false, value: value };
                }
            case 'special_num':
                if (value === 'NaN') return { ischanged: true, value: NaN };
                return { ischanged: true, value: parseFloat(value) };
            case 'point':
                // Restores to {x, y} which both PG and MySQL drivers can map
                const coords = value.match(/-?\d+\.?\d*/g);
                return { ischanged: true, value: { x: parseFloat(coords[0]), y: parseFloat(coords[1]) } };
            default:
                return { ischanged: false, value: value };
        }
    }

    // Fallback detection (if no type provided)
    if (typeof value !== 'string') return { ischanged: false, value: value };
    
    // Quick JSON detect
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
        try { return { ischanged: true, value: JSON.parse(value), type: 'json' }; } catch(e) {}
    }

    // ... (rest of previous auto-detection logic for buffer/date/bigint)
    return { ischanged: false, value: value };
}
function getmemorypercent() {
    const stats = v8.getHeapStatistics();
    const heapLimit = stats.heap_size_limit / 1024 / 1024; // Convert to MB
    const usedHeap = stats.used_heap_size / 1024 / 1024;
    return (usedHeap * 100 / heapLimit);
}
// Insert a new row into the database, restoring any Base64 or ISO Date strings back to Buffers or Dates
async function addRowWithRestore(connection, tableName, rowData) {
    const restoredData = {};

    // 1. Loop through every column in the row
    for (const key in rowData) {
        const item = rowData[key];
        
        // Handle both formats: 
        // A) The new structure: { value: "...", type: "buffer" }
        // B) The old structure: "standard_string" (fallback to auto-detect)
        const val = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
        const type = (item && typeof item === 'object' && 'type' in item) ? item.type : null;

        // Use toPrevious with the explicit type for 100% accuracy
        const result = toPrevious(val, type);
        
        let finalValue = result.value;

        // 2. Database Compatibility Layer
        // MySQL doesn't support NaN in numeric columns, convert to null
        if (type === 'special_num' && typeof finalValue === 'number' && isNaN(finalValue)) {
            finalValue = null;
        }

        restoredData[key] = finalValue;
    }

    // 3. Insert into the database
    // Placeholders ?? (table) and ? (data object) prevent SQL injection
    const sql = `INSERT INTO ?? SET ?`;

    try {
        const [result] = await connection.query(sql, [tableName, restoredData]);
        return { 
            success: true, 
            insertId: result.insertId,
            // A quick check to see if we restored any binary data for logging
            hasBinary: Object.values(restoredData).some(v => Buffer.isBuffer(v))
        };
    } catch (err) {
        // Detailed error logging is crucial for 1GB RAM environments 
        // to catch "Packet Too Large" or "Connection Timeout"
        console.error(`Database Insert Error [${tableName}]:`, err.message);
        return { success: false, error: err.message, code: err.code };
    }
}



// Fetch rows in chunks until memory limit is approached
async function getRowsUntilMemoryLimit(config, databaseName, tableName, startOffset = 0) {
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
        const memoryThreshold = heapLimit * 0.70; // 70% threshold

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

                console.log(`Progress: ${currentOffset}/${totalRows} (RAM: ${(currentUsage / 1024 / 1024).toFixed(0)}MB)`);

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
        return { data: allData, nextOffset: currentOffset, status: "error", isFinished: false };
    } finally {
        if (connection) await connection.end();
    }
}
// Lets get all the rows of all tables of all databases and write to file
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
                const result = await getRowsUntilMemoryLimit(config, db, table, offset);


                // 1. Send data to your Write/Merge function
                await writeDataToFile(result.data);


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
    getRowsUntilMemoryLimit
}