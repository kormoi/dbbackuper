const mysql = require('mysql2/promise');
const cstyler = require("cstyler");
const getmtd = require("./getmetadata");
const fncs = require("./functions");
const links = require("./links");
const wkx = require('wkx'); // Required for rebuilding MySQL spatial buffers



function toOriginal(value) {
    // 0. Pass through null or undefined immediately
    if (value === null || value === undefined) {
        return value;
    }
    // Lets check if previously processed or not
    if (!fncs.isJsonObject(value) || (!value.hasOwnProperty("type") && !value.hasOwnProperty("ischanged") && !value.hasOwnProperty("value"))) {
        return value;
    }
    if (fncs.isJsonObject(value) && value.hasOwnProperty("isSaved") && value.hasOwnProperty("fileName") && value.hasOwnProperty("extention") && value.hasOwnProperty("filepath") && value.hasOwnProperty("type")) {
        return value;
    }
    if (value.ischanged === false) {
        return value.value;
    }

    // --- HANDLE OBJECT METADATA ENVELOPS ---
    if (typeof value === 'object' && !Array.isArray(value)) {

        // Safety pass-through for files that were flagged as already saved
        if (value.hasOwnProperty("isSaved") && value.hasOwnProperty("fileName")) {
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
                return new Date(innerValue);
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

                if (typeof value === 'object' && !Array.isArray(value) && value.hasOwnProperty('value')) {
                    value = value.value;
                }

                if (Array.isArray(value)) {
                    // Fire the recursive structural scanner
                    rawWktBody = parseArrayToWkt(value, dataType);
                } else if (typeof value === 'string') {
                    let trimmed = value.trim();
                    if (/^ST_GeomFromText\(/i.test(trimmed)) {
                        trimmed = trimmed.replace(/^ST_GeomFromText\(/i, '').replace(/\)$/, '').trim();
                    }
                    rawWktBody = trimmed.replace(/^['"](.*)['"]$/, "$1").trim();
                }

                // Clean out redundant wrapping if the recursive checker already appended the keyword
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
    let pool;
    try {
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
        console.error(`Error adding record in ${tableName}:`, error.message);
        return null;
    } finally {
        if (pool) await pool.end();
    }
}



module.exports = {
    toOriginal,
    validateDefault,
    validatePayloadWithSchema,
    addRecord,
}