const mysql = require('mysql2/promise');
const cstyler = require("cstyler");
const getmtd = require("./getmetadata");
const fncs = require("./functions");
const links = require("./links");
const ff = require("./filefunctions");
const wkx = require('wkx'); // Required for rebuilding MySQL spatial buffers



function toOriginal(value) {
    // 0. Pass through null or undefined immediately
    if (value === null || value === undefined) {
        return value;
    }
    // Lets check if previously processed or not
    if (!fncs.isJsonObject(value) || (!Object.hasOwn(value, "type") && !Object.hasOwn(value, "ischanged") && !Object.hasOwn(value, "value"))) {
        return value;
    }
    if (fncs.isJsonObject(value) && Object.hasOwn(value, "isSaved") && Object.hasOwn(value, "fileName") && Object.hasOwn(value, "extention") && Object.hasOwn(value, "filepath") && Object.hasOwn(value, "type")) {
        return value;
    }
    if (value.ischanged === false) {
        return value.value;
    }
    if (Buffer.isBuffer(value)) {
        // 2. Return its converted value (e.g., 'utf8', 'hex', or 'base64')
        return value;
    }
    // --- HANDLE OBJECT METADATA ENVELOPS ---
    if (typeof value === 'object' && !Array.isArray(value)) {

        // Safety pass-through for files that were flagged as already saved
        if (Object.hasOwn(value, "isSaved") && Object.hasOwn(value, "fileName")) {
            return value;
        }

        const { type, value: innerValue, from } = value;

        switch (type) {
            // 1. MySQL Spatial Layer Reversal
            case 'point':
            case 'linestring':
            case 'polygon':
            case 'multipoint':
            case 'multilinestring':
            case 'multipolyon':
            case 'geometrycollection': {
                try {
                    const geometry = wkx.Geometry.parse(innerValue);
                    const wkbBuffer = geometry.toWkb();

                    // Rebuild MySQL spatial header wrapper (4-byte SRID + WKB)
                    const mysqlBuffer = Buffer.alloc(4 + wkbBuffer.length);
                    mysqlBuffer.writeUInt32LE(0, 0); // Default SRID 0
                    wkbBuffer.copy(mysqlBuffer, 4);

                    return mysqlBuffer;
                } catch (e) {
                    return innerValue;
                }
            }

            // 2. Binary Layer -> Crucial reversal back into raw Buffer
            case 'base64': {
                if (from === 'buffer') {
                    return Buffer.from(innerValue, 'base64');
                }
                return innerValue;
            }

            // 4. Dates
            case 'date': {
                const dateValue = new Date(innerValue);
                return dateValue.toISOString();
            }

            // 5. Special Numbers (NaN, Infinity)
            case 'special_num': {
                if (innerValue === 'NaN') return NaN;
                if (innerValue === 'Infinity') return Infinity;
                if (innerValue === '-Infinity') return -Infinity;
                return Number(innerValue);
            }

            // 6. JSON Object / Array Columns
            case 'json': {
                try {
                    return JSON.parse(innerValue);
                } catch (e) {
                    return innerValue;
                }
            }

            default:
                return value;
        }
    }

    // --- HANDLE FLAT PRIMITIVE STRINGS ---
    if (typeof value === 'string') {

        // 1. Revert Postgres/PostGIS Direct Objects (e.g., ST_GeomFromText('POINT(X Y)'))
        if (value.startsWith("ST_GeomFromText('POINT(")) {
            const match = value.match(/POINT\(([^ ]+)\s+([^)]+)\)/);
            if (match) {
                return {
                    x: parseFloat(match[1]),
                    y: parseFloat(match[2])
                };
            }
        }

        // 7. Revert Direct Native Hex & Base64 Strings BACK to Buffers if they qualified
        // (Matching your exact length > 64 and syntax validation parameters)
        if (value.length % 2 === 0 && value.length > 64) {
            // Check if it's a completely valid uppercase/lowercase hex structure
            if (/^[0-9A-FA-f]+$/.test(value)) {
                return Buffer.from(value, 'hex');
            }
        }

        if (value.length % 4 === 0 && value.length > 64) {
            if (!/[\s]/.test(value)) {
                // Validate base64 structure layout before blind conversion
                const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
                if (base64Regex.test(value)) {
                    return Buffer.from(value, 'base64');
                }
            }
        }
    }

    // 3 & 8. Default Fallback (Standard Strings, BigInt strings, standard Numbers, Booleans)
    return value;
}
function validateDefault(columnType, defaultValue, length_value, nullable = false) {
    const type = columnType.toUpperCase();

    // If default is undefined (not explicitly set) → usually valid
    if (defaultValue === undefined) return { valid: true, message: null };

    // NULL default
    if (defaultValue === null) {
        return nullable
            ? { valid: true, message: null }
            : { valid: false, message: "Column does not allow NULL as default" };
    }

    // Numeric types
    if (["INT", "BIGINT", "SMALLINT", "TINYINT", "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL"].includes(type)) {
        if (typeof defaultValue === "number") return { valid: true, message: null };
        if (typeof defaultValue === "string" && !isNaN(defaultValue)) return { valid: true, message: null };
        return { valid: false, message: "Invalid numeric default value" };
    }

    // BIT type
    if (type === "BIT") {
        if (typeof defaultValue === "number" && (defaultValue === 0 || defaultValue === 1)) return { valid: true, message: null };
        if (typeof defaultValue === "string" && (/^\d+$/.test(defaultValue) || /^0b[01]+$/i.test(defaultValue) || /^b'[01]+'$/i.test(defaultValue))) {
            return { valid: true, message: null };
        }
        return { valid: false, message: "Invalid BIT default value. Use an integer, '0b0001', or 'b\'0001\'' format" };
    }

    // ENUM / SET
    if (["ENUM", "SET"].includes(type)) {
        // Quick adjustment if you pass it directly to validateDefault:
        if (!length_value) return { valid: false, message: "Missing ENUM/SET options" };

        // Correctly split options by stripping the single quotes wrapping each string element
        let options = [];
        if (Array.isArray(length_value)) {
            options = length_value;
        } else {
            options = length_value.split(",").map(s => s.trim().replace(/^'(.*)'$/, "$1"));
        }

        if (type === "ENUM") {
            if (options.includes(defaultValue)) return { valid: true, message: null };
            return { valid: false, message: `Default value not in ENUM options [${options.join(", ")}]` };
        } else { // SET allows multiple comma-separated values (e.g. "read,write")
            const selectedValues = defaultValue.split(",").map(s => s.trim().replace(/^'(.*)'$/, "$1"));
            const allValid = selectedValues.every(val => options.includes(val));
            if (allValid) return { valid: true, message: null };
            return { valid: false, message: `One or more defaults not in SET options [${options.join(", ")}]` };
        }
    }

    // Character types
    if (["CHAR", "VARCHAR"].includes(type)) {
        return typeof defaultValue === "string"
            ? { valid: true, message: null }
            : { valid: false, message: "Default must be a string" };
    }

    // TEXT types
    if (["TEXT", "TINYTEXT", "MEDIUMTEXT", "LONGTEXT"].includes(type)) {
        if (typeof defaultValue === "string") return { valid: true, message: null };
        return { valid: false, message: "TEXT columns cannot have schema default values, but accept string payloads" };
    }

    // Binary / BLOB types
    if (["BINARY", "VARBINARY"].includes(type)) {
        return typeof defaultValue === "string" || Buffer.isBuffer(defaultValue) || /^x'[0-9A-Fa-f]+'$/.test(defaultValue)
            ? { valid: true, message: null }
            : { valid: false, message: "Invalid binary data format" };
    }
    if (["BLOB", "TINYBLOB", "MEDIUMBLOB", "LONGBLOB"].includes(type)) {
        if (typeof defaultValue === "string" || Buffer.isBuffer(defaultValue)) return { valid: true, message: null };
        return { valid: false, message: "BLOB columns cannot have schema default values, but accept binary/string payloads" };
    }

    // Date / Time types
    if (["DATETIME", "TIMESTAMP"].includes(type)) {
        if (typeof defaultValue !== "string") return { valid: false, message: "Default must be a string for DATETIME/TIMESTAMP" };
        if (/^(CURRENT_TIMESTAMP)(\(\d{0,6}\))?$/i.test(defaultValue)) return { valid: true, message: null };
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(defaultValue)) return { valid: true, message: null };
        return { valid: false, message: "Invalid DATETIME/TIMESTAMP default format" };
    }
    if (type === "DATE") {
        return /^\d{4}-\d{2}-\d{2}$/.test(defaultValue)
            ? { valid: true, message: null }
            : { valid: false, message: "Invalid DATE default format" };
    }
    if (type === "TIME") {
        return /^\d{2}:\d{2}:\d{2}$/.test(defaultValue)
            ? { valid: true, message: null }
            : { valid: false, message: "Invalid TIME default format" };
    }
    if (type === "YEAR") {
        return /^\d{4}$/.test(defaultValue)
            ? { valid: true, message: null }
            : { valid: false, message: "Invalid YEAR default format" };
    }

    // BOOLEAN
    if (type === "BOOLEAN") {
        return defaultValue === 0 || defaultValue === 1 || defaultValue === "true" || defaultValue === "false" || typeof defaultValue === "boolean"
            ? { valid: true, message: null }
            : { valid: false, message: "BOOLEAN default must be 0, 1, 'true', or 'false'" };
    }

    // JSON
    if (type === "JSON") {
        if (defaultValue === null || defaultValue === '{}' || defaultValue === '[]') return { valid: true, message: null };
        if (typeof defaultValue === "object") return { valid: true, message: null };
        if (typeof defaultValue === "string") {
            try {
                JSON.parse(defaultValue);
                return { valid: true, message: null };
            } catch (e) {
                return { valid: false, message: "Invalid JSON string formatting payload structural syntax" };
            }
        }
        return { valid: false, message: "JSON columns cannot have this default configuration" };
    }

    // Spatial / Geometry Types (Added support for runtime ST_ functions and aliases)
    if (["GEOMETRY", "POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION", "GEOMCOLLECTION"].includes(type)) {
        // Valid if it's a runtime spatial function payload string
        if (typeof defaultValue === "string" && /^ST_[A-Za-z0-9_]+\(.*\)$/i.test(defaultValue.trim())) {
            return { valid: true, message: null };
        }
        return { valid: false, message: `${type} columns require valid ST_GeomFromText spatial function payloads` };
    }

    // Unknown types
    return { valid: false, message: "Unknown column type or invalid default" };
}
function validatePayloadWithSchema(schemaLayout, rawData, isInsert = true) {
    try {
        const cleanData = {};

        const SPATIAL_TYPES = ["GEOMETRY", "POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION", "GEOMCOLLECTION"];
        const BINARY_TYPES = ["BINARY", "VARBINARY", "BLOB", "TINYBLOB", "MEDIUMBLOB", "LONGBLOB"];

        // --- THE COMPLETE PERFECTED RECURSIVE DEEP WKT PARSER ---
        function parseArrayToWkt(arr, targetType) {
            const parsePointNode = (node) => {
                if (node && typeof node === 'object' && 'x' in node && 'y' in node) {
                    return `${node.x} ${node.y}`;
                }
                if (Array.isArray(node) && node.length >= 2) {
                    return `${node[0]} ${node[1]}`;
                }
                return null;
            };

            // 1. Core Check: Is it an array of numbers [X, Y]?
            if (arr.length === 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
                return `POINT(${arr[0]} ${arr[1]})`;
            }

            // 2. Core Check: Is it a flat line array of coordinate objects [{x,y}, {x,y}]?
            if (arr.every(item => item && !Array.isArray(item) && typeof item === 'object' && 'x' in item)) {
                const pointsStr = arr.map(parsePointNode).filter(Boolean).join(', ');
                const cleanType = ["GEOMETRY", "GEOMETRYCOLLECTION", "GEOMCOLLECTION"].includes(targetType)
                    ? "LINESTRING"
                    : targetType;
                return `${cleanType}(${pointsStr})`;
            }

            // 3. Handle Explicit Multi-Dimensional Layer Compilations
            if (targetType === "MULTIPOLYGON") {
                // MULTIPOLYGON structure: Array of Polygons -> Array of Rings -> Array of Points
                const polygons = arr.map(polygon => {
                    const rings = polygon.map(ring => {
                        const pointsStr = ring.map(parsePointNode).filter(Boolean).join(', ');
                        return `(${pointsStr})`;
                    }).join(', ');
                    return `(${rings})`;
                }).join(', ');
                return `MULTIPOLYGON(${polygons})`;
            }

            if (targetType === "MULTILINESTRING") {
                // MULTILINESTRING structure: Array of Lines -> Array of Points
                const lines = arr.map(line => {
                    const pointsStr = line.map(parsePointNode).filter(Boolean).join(', ');
                    return `(${pointsStr})`;
                }).join(', ');
                return `MULTILINESTRING(${lines})`;
            }

            if (targetType === "POLYGON") {
                // POLYGON structure: Array of Rings -> Array of Points
                const rings = arr.map(ring => {
                    const pointsStr = ring.map(parsePointNode).filter(Boolean).join(', ');
                    return `(${pointsStr})`;
                }).join(', ');
                return `POLYGON(${rings})`;
            }

            // 4. Fallback Router for Heterogeneous Data (e.g. GEOMETRYCOLLECTION)
            const elementWKTs = arr.map(element => {
                if (Array.isArray(element)) {
                    return parseArrayToWkt(element, "GEOMETRYCOLLECTION");
                } else if (element && typeof element === 'object' && 'x' in element) {
                    return `POINT(${element.x} ${element.y})`;
                }
                return null;
            }).filter(Boolean);

            // If it's wrapped internally by sub-parsers, strip redundant top-level labels
            const cleanElements = elementWKTs.map(el => {
                if (el.startsWith("GEOMETRYCOLLECTION(")) {
                    return el.substring(19, el.length - 1);
                }
                return el;
            });

            return `GEOMETRYCOLLECTION(${cleanElements.join(', ')})`;
        }

        for (const colName of Object.keys(schemaLayout)) {
            const colDef = schemaLayout[colName];
            const dataType = colDef.type.toUpperCase();

            const lengthValue = Array.isArray(colDef.value)
                ? colDef.value.map(v => `'${v}'`).join(',')
                : colDef.value;

            let value = rawData[colName];

            // Smart Normalization for Date / Time Types
            if (["TIMESTAMP", "DATETIME"].includes(dataType) && typeof value === 'string' && value !== "CURRENT_TIMESTAMP") {
                const trimmedDate = value.trim();
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/i.test(trimmedDate)) {
                    const parsedDate = new Date(trimmedDate);
                    if (!isNaN(parsedDate.getTime())) {
                        const pad = (num) => String(num).padStart(2, '0');
                        value = `${parsedDate.getFullYear()}-${pad(parsedDate.getMonth() + 1)}-${pad(parsedDate.getDate())} ${pad(parsedDate.getHours())}:${pad(parsedDate.getMinutes())}:${pad(parsedDate.getSeconds())}`;
                    }
                }
            }

            // Smart Normalization for Binary / BLOB Types
            if (BINARY_TYPES.includes(dataType) && typeof value === 'string') {
                const trimmedStr = value.trim();
                if (/^x'[0-9A-Fa-f]+'$/i.test(trimmedStr)) {
                    value = Buffer.from(trimmedStr.replace(/^x'/i, '').replace(/'$/, ''), 'hex');
                } else if (/^0x[0-9A-Fa-f]+$/i.test(trimmedStr)) {
                    value = Buffer.from(trimmedStr.replace(/^0x/i, ''), 'hex');
                } else if (trimmedStr.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(trimmedStr)) {
                    value = Buffer.from(trimmedStr, 'hex');
                } else {
                    const cleanBase64 = trimmedStr.replace(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/, '');
                    if (cleanBase64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
                        value = Buffer.from(cleanBase64, 'base64');
                    }
                }
            }

            // --- FIXED: ADVANCED SPATIAL DATA PARSING LAYER ---
            let rawWktBody = "";
            let fullWrappedExpression = "";
            let isSpatial = false;

            if (SPATIAL_TYPES.includes(dataType) && value !== undefined && value !== null) {
                isSpatial = true;

                if (typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'value')) {
                    value = value.value;
                }

                // 1. Intercept Standalone Coordinate Objects (e.g., { x: 0, y: 0 })
                if (value && typeof value === 'object' && !Array.isArray(value) && 'x' in value && 'y' in value) {
                    const cleanType = (dataType === "GEOMETRY" || dataType === "GEOMCOLLECTION" || dataType === "GEOMETRYCOLLECTION") ? "POINT" : dataType;
                    rawWktBody = `${cleanType}(${value.x} ${value.y})`;
                }
                // 2. Fire recursive structural tracker for coordinate arrays
                else if (Array.isArray(value)) {
                    rawWktBody = parseArrayToWkt(value, dataType);
                }
                // 3. Fallback for raw string configurations
                else if (typeof value === 'string') {
                    let trimmed = value.trim();
                    if (/^ST_GeomFromText\(/i.test(trimmed)) {
                        trimmed = trimmed.replace(/^ST_GeomFromText\(/i, '').replace(/\)$/, '').trim();
                    }
                    rawWktBody = trimmed.replace(/^['"](.*)['"]$/, "$1").trim();
                }

                // Clean out redundant wrapping if the generators already appended the keyword
                if (/^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)/i.test(rawWktBody)) {
                    fullWrappedExpression = `ST_GeomFromText('${rawWktBody}')`;
                } else {
                    fullWrappedExpression = `ST_GeomFromText('${dataType}(${rawWktBody})')`;
                }
            }

            // Smart Normalization for ENUM and SET types
            if (["ENUM", "SET"].includes(dataType) && Array.isArray(colDef.value) && value !== undefined && value !== null) {
                const allowedOptions = colDef.value;
                let incomingItems = [];

                if (Array.isArray(value)) {
                    incomingItems = value.map(v => String(v).trim());
                } else if (typeof value === 'string') {
                    incomingItems = value.split(",").map(s => s.trim().replace(/^['"](.*)['"]$/, "$1"));
                } else {
                    incomingItems = [String(value).trim()];
                }

                const normalizedItems = incomingItems.map(incomingItem => {
                    const matchedOption = allowedOptions.find(opt => opt.toLowerCase() === incomingItem.toLowerCase());
                    return matchedOption ? matchedOption : incomingItem;
                });

                value = dataType === "ENUM" ? normalizedItems[0] : normalizedItems.join(",");
            }

            // Check for explicit timestamp generation on INSERT rules
            if (isInsert && value === undefined && ["TIMESTAMP", "DATETIME"].includes(dataType)) {
                if (colDef.default && typeof colDef.default === 'string' && colDef.default.toUpperCase().includes("CURRENT_TIMESTAMP")) {
                    value = "CURRENT_TIMESTAMP";
                }
            }

            // Fall back to general defaults if missing on an insertion event
            if (isInsert && value === undefined) {
                if (colDef.default !== undefined && colDef.default !== null) {
                    value = colDef.default;
                } else if (colDef.nullable === false) {
                    throw new Error(`Field '${colName}' is required but missing a value or default constraint.`);
                } else {
                    value = null;
                }
            }

            // --- DOUBLE CHECK VALIDATION FOR SPATIAL DATA ---
            let validation = { valid: false };

            if (isSpatial) {
                validation = validateDefault(dataType, fullWrappedExpression, lengthValue, colDef.nullable ?? true);
                if (!validation.valid) {
                    validation = validateDefault(dataType, rawWktBody, lengthValue, colDef.nullable ?? true);
                }
                value = fullWrappedExpression;
            } else {
                validation = validateDefault(dataType, value, lengthValue, colDef.nullable ?? true);
            }

            const normalizedStr = typeof value === 'string' ? value.toUpperCase().trim() : '';
            const isBypassKeyword = ["CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP()", "NOW()", "NULL"].includes(normalizedStr);

            if (!validation.valid && !isBypassKeyword) {
                throw new Error(`Validation failed for column '${colName}': ${validation.message}`);
            }

            cleanData[colName] = value;
        }

        return cleanData;

    } catch (error) {
        console.error(`[Schema Validation Error]: ${error.message}`);
        return null;
    }
}
async function addRecord(config, databaseName, tableName, validatedData) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let pool;
        try {
            console.log(`[Attempt ${attempt}/${maxRetries}] Validated data: `, validatedData);

            pool = await mysql.createConnection({
                ...config,
                database: databaseName
            });

            const keys = Object.keys(validatedData);
            const placeholders = [];
            const queryValues = [];

            if (keys.length === 0) {
                throw new Error("No payload parameters mapped to execute insertion.");
            }

            for (const key of keys) {
                const value = validatedData[key];

                if (value === "CURRENT_TIMESTAMP") {
                    placeholders.push("CURRENT_TIMESTAMP");
                }
                // Handle pre-wrapped geometry helper strings securely via binding parameters
                else if (typeof value === 'string' && /^ST_GeomFromText\(['"]?(.*?)['"]?\)$/i.test(value.trim())) {
                    const match = value.trim().match(/^ST_GeomFromText\(['"]?(.*?)['"]?\)$/i);
                    const rawWktBody = match[1]; // Extract just the raw coordinates: e.g. "POINT(0 0)"

                    placeholders.push("ST_GeomFromText(?)");
                    queryValues.push(rawWktBody); // Pass safely as an isolated data binding variable
                }
                else {
                    placeholders.push('?');
                    queryValues.push(value);
                }
            }

            // Build and execute the SQL string
            const query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`;

            // This is now fully safe, optimized, and prepared-statement friendly!
            const [result] = await pool.execute(query, queryValues);

            return { success: true, result: result };

        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed adding record in ${tableName}: ${error.message}`);

            if (attempt < maxRetries) {
                // Wait for 1 second before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed adding record:`, error.message);
                return null;
            }
        } finally {
            if (pool) {
                await pool.end();
            }
        }
    }
}
async function updateRecord(config, databaseName, tableName, validatedData, primaryKeyColumn, columnTypesMap) {
    const maxRetries = 3;

    const spatialTypes = [
        'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
        'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'
    ];

    const normalizeSpatialValue = (input) => {
        let parsedValue = input;
        if (typeof parsedValue === 'string') {
            try {
                const parsed = JSON.parse(parsedValue);
                if (parsed && typeof parsed === 'object') parsedValue = parsed;
            } catch { }
        }

        if (typeof parsedValue === 'object' && parsedValue !== null) {
            const x = parsedValue.x ?? parsedValue.lng ?? parsedValue.longitude;
            const y = parsedValue.y ?? parsedValue.lat ?? parsedValue.latitude;
            if (x !== undefined && y !== undefined) return `POINT(${x} ${y})`;
        } else if (typeof parsedValue === 'string') {
            let cleaned = parsedValue.trim();
            const geomMatch = cleaned.match(/^ST_GeomFromText\(['"]?(.*?)['"]?\)$/i);
            if (geomMatch) cleaned = geomMatch[1].trim();

            if (/^\([+-]?\d+(\.\d+)?([,\s]+[+-]?\d+(\.\d+)?)*\)$/.test(cleaned)) {
                return `POINT(${cleaned.replace(/[()]/g, '').split(/[\s,]+/).join(' ')})`;
            }
            return cleaned;
        }
        return input;
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let connection;
        try {
            connection = await mysql.createConnection({
                ...config,
                database: databaseName
            });

            const pkValue = validatedData[primaryKeyColumn];
            if (pkValue === undefined || pkValue === null) {
                throw new Error(`Primary key value for "${primaryKeyColumn}" is missing in the data.`);
            }

            const updateData = { ...validatedData };
            delete updateData[primaryKeyColumn];

            const keys = Object.keys(updateData);
            const queryParams = [tableName];

            // Construct Dynamic SET clauses using columnTypesMap[key].type
            const setClauseArray = keys.map(key => {
                const colType = (columnTypesMap[key]?.type || '').toUpperCase();
                const isSpatial = spatialTypes.includes(colType);
                let value = updateData[key] === undefined ? null : updateData[key];

                if (isSpatial && value !== null) {
                    value = normalizeSpatialValue(value);
                    queryParams.push(key, value);
                    return `?? = ST_GeomFromText(?)`;
                } else {
                    queryParams.push(key, value);
                    return `?? = ?`;
                }
            });

            const setClause = setClauseArray.join(', ');

            // Construct Dynamic WHERE clause using columnTypesMap[primaryKeyColumn].type
            let whereClause = '';
            const pkType = (columnTypesMap[primaryKeyColumn]?.type || '').toUpperCase();
            const isPkSpatial = spatialTypes.includes(pkType);
            let finalPkValue = pkValue;

            if (isPkSpatial) {
                finalPkValue = normalizeSpatialValue(finalPkValue);
                whereClause = `ST_Equals(??, ST_GeomFromText(?))`;
            } else {
                whereClause = `?? = ?`;
            }

            queryParams.push(primaryKeyColumn, finalPkValue);

            const query = `UPDATE ?? SET ${setClause} WHERE ${whereClause}`;

            const [result] = await connection.query(query, queryParams);

            return {
                success: true,
                affectedRows: result.affectedRows,
                message: "Record updated successfully"
            };

        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed updating record in ${tableName}: ${error.message}`);

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed updating record:`, error.message);
                return { success: null, error: error.message };
            }
        } finally {
            if (connection) await connection.end();
        }
    }
}
async function checkRowExists(config, database, table, column, columnValue, columnType) {
    const maxRetries = 3;
    const type = columnType.toUpperCase();

    // All known MySQL native spatial geometry types
    const spatialTypes = [
        'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
        'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'
    ];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let connection;
        try {
            connection = await mysql.createConnection({
                ...config,
                database: database
            });

            let sql;
            let finalValue = columnValue;

            // Contextual Routing: Apply spatial preprocessing if the type is a geometry
            if (spatialTypes.includes(type)) {
                let parsedValue = columnValue;

                // Detect and extract JSON strings if applicable
                if (typeof parsedValue === 'string') {
                    try {
                        const parsed = JSON.parse(parsedValue);
                        if (parsed && typeof parsed === 'object') parsedValue = parsed;
                    } catch {
                        // Not a JSON string
                    }
                }

                // Format Normalization Pipeline
                if (typeof parsedValue === 'object' && parsedValue !== null) {
                    const x = parsedValue.x ?? parsedValue.lng ?? parsedValue.longitude;
                    const y = parsedValue.y ?? parsedValue.lat ?? parsedValue.latitude;
                    if (x !== undefined && y !== undefined) {
                        finalValue = `POINT(${x} ${y})`;
                    }
                } else if (typeof parsedValue === 'string') {
                    let cleaned = parsedValue.trim();

                    // Strip any explicit 'ST_GeomFromText' prefixes
                    const geomMatch = cleaned.match(/^ST_GeomFromText\(['"]?(.*?)['"]?\)$/i);
                    if (geomMatch) {
                        cleaned = geomMatch[1].trim();
                    }

                    // Convert comma tuple definitions like '(1,2)' into a valid WKT 'POINT(1 2)'
                    if (/^\([+-]?\d+(\.\d+)?([,\s]+[+-]?\d+(\.\d+)?)*\)$/.test(cleaned)) {
                        const coords = cleaned.replace(/[()]/g, '').split(/[\s,]+/).join(' ');
                        finalValue = `POINT(${coords})`;
                    } else {
                        finalValue = cleaned;
                    }
                }

                sql = "SELECT 1 FROM ?? WHERE ST_Equals(??, ST_GeomFromText(?)) LIMIT 1";
            } else {
                // Standard structural data type path (INT, VARCHAR, etc.)
                sql = "SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1";
            }

            const [rows] = await connection.query(sql, [table, column, finalValue]);
            return rows.length;

        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed checking row existence: ${error.message}`);

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.error(`❌ All ${maxRetries} attempts failed checking row existence:`, error.message);
                return null;
            }
        } finally {
            if (connection) await connection.end();
        }
    }
}
async function uploadData(config, databaseName, tableName, data, schemaLayout = null, type = "replace") {
    try {
        if (schemaLayout === null) {
            return null;
        }
        for (const col of Object.keys(data)) {
            const colData = data[col];
            if (fncs.isJsonObject(colData) && Object.hasOwn(colData, "isSaved") && colData.isSaved === true && Object.hasOwn(colData, "fileName") && Object.hasOwn(colData, "extention") && Object.hasOwn(colData, "filepath")) {
                const filePath = colData.filepath;
                const getBuffer = await ff.fileToBuffer(filePath);
                if (getBuffer === null) {
                    throw new Error("Having some issue with files. Can not find required files.");
                }
                data[col] = getBuffer;
            } else {
                //{ isSaved: true, fileName: savefile.fileName, extention: savefile.extension, filepath: path.join(filePath, savefile.fileName), type: 'file' }
                data[col] = toOriginal(data[col]);
            }
        }
        // Lets validate data
        const validatedData = validatePayloadWithSchema(schemaLayout, data);
        if (validatedData === null) {
            throw new Error("Unable to validate data.");
        }
        // Lets get primary column information
        let primaryCol = null;
        let priExist = false;
        for (const col of Object.keys(schemaLayout)) {
            const colSchema = schemaLayout[col];
            if (colSchema.isPrimary === true) {
                primaryCol = col;
                const priColVal = validatedData[col];
                const ifExist = await checkRowExists(config, databaseName, tableName, col, priColVal, colSchema.type);
                if (ifExist === null) {
                    throw new Error("Having problem cheching if row exist or not. Must be a server problem. Please try again.");
                }
                priExist = ifExist;
            }
        }

        if (type === "merge") {
            if (primaryCol === null || !priExist) {
                const addRC = await addRecord(config, databaseName, tableName, validatedData);
                if (addRC === null) {
                    throw new Error(`Unable to add Record to ${cstyler.purple("Database:")} ${cstyler.blue(databaseName)} ${cstyler.purple("Table:")} ${cstyler.blue(tableName)}`);
                }
                return true;
            }
        } else if (type === "replace") {
            if (primaryCol === null || !priExist) {
                const addRC = await addRecord(config, databaseName, tableName, validatedData);
                if (addRC === null) {
                    throw new Error(`Unable to add Record to ${cstyler.purple("Database:")} ${cstyler.blue(databaseName)} ${cstyler.purple("Table:")} ${cstyler.blue(tableName)}`);
                }
                return true;
            } else {
                const updateRC = await updateRecord(config, databaseName, tableName, validatedData, primaryCol, schemaLayout);
                if (updateRC.success === null) {
                    throw new Error(`Unable to update Record to ${cstyler.purple("Database:")} ${cstyler.blue(databaseName)} ${cstyler.purple("Table:")} ${cstyler.blue(tableName)}`);
                }
                return true;
            }
        } else {
            const addRC = await addRecord(config, databaseName, tableName, validatedData);
            if (addRC === null) {
                throw new Error(`Unable to add Record to ${cstyler.purple("Database:")} ${cstyler.blue(databaseName)} ${cstyler.purple("Table:")} ${cstyler.blue(tableName)}`);
            }
            return true;
        }
    } catch (e) {
        console.error(`Having problem uploading data to the server ${cstyler.purple("Database")} ${cstyler.blue(databaseName)} ${cstyler.purple("Table Name")} ${cstyler.blue(tableName)} - Error message: ${e.message}`);
        return null;
    }
}
async function uploadMultiRow(config, databaseName, tableName, data, type = "replace") {
    let count = 0;
    try {
        const schemaLayout = await getmtd.getTableSchemaLayout(config, databaseName, tableName);
        if (schemaLayout === null) {
            throw new Error("Having problem getting table schema layout.");
        } else if (schemaLayout === false) {
            console.warn(`No table found on ${cstyler.purple("Database")} ${cstyler.purple(databaseName)} ${cstyler.purple("Table Name")} ${cstyler.purple(tableName)} - it means there is a problem in database setting data. Please upload proper zipped file and try again.`);
            return { success: false, count: count };
        }
        if (!Array.isArray(data)) {
            throw new Error("Valid array data required.");
        }
        while (data.length > 0) {
            const item = data.pop();
            const upload = await uploadData(config, databaseName, tableName, item, schemaLayout, type);
            if (upload === null) {
                throw new Error("Unable to upload data to database");
            }
            count++;
        }
        return { success: true, count: count }
    } catch (err) {
        console.error(`Having problem adding record multiple row on ${cstyler.purple("Database")} ${cstyler.blue(databaseName)} ${cstyler.purple("Table Name")} ${cstyler.blue(tableName)} - Error message: ${err.message}`);
        return { success: null, count: count }
    }
}
async function uploadAllData(config, type = "replace") {
    let offsetData = {}
    try {
        // Lets get folder tree
        console.log(cstyler.bold.yellow("Please wait. We are uploading data..."));
        const fldrTree = await ff.getFolderTree(links.database);
        if (fldrTree === null) {
            throw new Error("Having problem getting folder content from extracted backup file. Please check permission.");
        }
        // lets check file folder exist or not
        let filesFolderExist = false;
        if (Object.hasOwn(fldrTree, "files") && Object.hasOwn(fldrTree.files, "contents") && fncs.isJsonObject(fldrTree.files.contents)) {
            filesFolderExist = true;
        }
        // Lets check all json files one by one
        for (const item of Object.keys(fldrTree)) {
            const fileItem = fldrTree[item];
            if (fileItem.name === "dbtaskerdata.json" || fileItem.name === "raw.json" || (fileItem.type === "folder" && fileItem.name === "files")) {
                continue;
            }
            if (fileItem.type === "folder" && fileItem.name !== "files") {
                throw new Error("Unwanted folder found inside backup compressed zip file. File have changed. Please do not use un protected file. Pleae upload file that was backup by DBBACKUPER tool. Please upload a proper file.");
            }
            if (fileItem.extension !== ".json" || !fncs.isNumber(ff.getBaseNameWithoutExt(fileItem.name))) {
                throw new Error("We have found differant file name or type than we normally backup using DBBACKUPER. File must be changed. For your security we are abborting. Please upload a right file.");
            }
            // Lets check backedup file now
            const readfile = await ff.readJsonFile(fileItem.path);
            if (readfile === null) {
                throw new Error("Having problem reading JSON data from files. Please check permission and try agina.");
            }
            for (const db of Object.keys(readfile)) {
                if (!fncs.isJsonObject(readfile[db])) {
                    throw new Error("File must be damaged, deprecated or changed. We are abborting for your security.");
                }
                if (!Object.hasOwn(offsetData, db) && type === "merge") offsetData[db] = {};
                for (const table of Object.keys(readfile[db])) {
                    const tableData = readfile[db][table];
                    if (!Array.isArray(tableData)) {
                        throw new Error("File must be damaged, deprecated or changed. We are abborting for your security.");
                    }
                    if (tableData.length > 0) {
                        console.log(cstyler.hex("#00e1ff")(`We are working on ${cstyler.purple("Database:")} ${cstyler.blue(db)} ${cstyler.purple("Table:")} ${cstyler.blue(table)}`));
                    } else {
                        continue;
                    }
                    if (!Object.hasOwn(offsetData[db], table) && type === "merge") offsetData[db][table] = { start: 0, count: 0 };
                    if (type === "merge") {
                        const totalRow = await getmtd.getTableRowCount(config, db, table);
                        if (totalRow === null) {
                            throw new Error(`Having problem getting total row count on Database: ${db} Table: ${table}`);
                        }
                        offsetData[db][table].start = totalRow;
                    }
                    const addTableRows = await uploadMultiRow(config, db, table, tableData, type);
                    offsetData[db][table].count = addTableRows.count;
                    if (addTableRows.success !== true) {
                        throw new Error("Unable to upload data to database. Please try again. We may have added few rows. Count as follows:", offsetData);
                    }
                }
            }
        }
        return { success: true, message: "Successfully uploaded all data to database." };
    } catch (e) {
        console.error("Having problem in backup process. Error message: ", e.message);
        return { success: null, message: e.message };
    }
}
async function clearAllRows(config, databaseName, tableName) {
    let pool;
    try {
        pool = await mysql.createConnection({
            ...config,
            database: databaseName
        });

        // TRUNCATE drops all data and instantly resets auto-increment indexes back to 1
        const query = `TRUNCATE TABLE \`${tableName}\``;
        await pool.execute(query);

        return { success: true, message: `All records cleared and layout reset for ${tableName}.` };

    } catch (error) {
        console.error(`Error dropping rows in ${tableName}:`, error.message);
        return { success: false, error: error.message };
    } finally {
        if (pool) await pool.end();
    }
}


module.exports = {
    toOriginal,
    validateDefault,
    validatePayloadWithSchema,
    addRecord,
    uploadData,
    uploadMultiRow,
    clearAllRows,
    uploadAllData,
    updateRecord,
    checkRowExists
}