const mysql = require('mysql2/promise');
const ff = require("./filefunctions");
const links = require("./links");
const fncs = require("./functions");
const cstyler = require("cstyler");




function isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') return false;

    const trimmed = filename.trim();

    // 1. A filename cannot be empty or exceed 255 characters (filesystem standard)
    if (trimmed.length === 0 || trimmed.length > 255) return false;

    // 2. Cannot be just a single dot "." or double dot ".." (reserved for directories)
    if (trimmed === '.' || trimmed === '..') return false;

    // 3. Check for illegal characters across Windows, Mac, and Linux:
    // / \ ? % * : | " < > and control characters (0-31)
    const illegalCharsRegex = /[\\/:*?"<>|%\x00-\x1F]/;
    if (illegalCharsRegex.test(trimmed)) return false;

    // 4. Windows reserved filenames (case-insensitive, e.g., nul, con, com1.txt, aux)
    const windowsReservedRegex = /^(nul|prn|con|lpt[0-9]|com[0-9]|aux)(\.|$)/i;
    if (windowsReservedRegex.test(trimmed)) return false;

    // 5. Filenames cannot end with a trailing space or a trailing dot on Windows
    if (trimmed.endsWith(' ') || trimmed.endsWith('.')) return false;

    // If it passed all negative constraints, it's a valid file name structure!
    return true;
}
function getBaseNameWithoutExt(filename) {
    if (!filename || typeof filename !== 'string') return null;

    const trimmed = filename.trim();

    // Find the position of the very last dot
    const lastDotIndex = trimmed.lastIndexOf('.');

    // If there is no dot, or the only dot is the first character (like .gitignore),
    // then there is no extension to remove.
    if (lastDotIndex <= 0) {
        return trimmed;
    }

    // Return everything up to the final dot
    return trimmed.substring(0, lastDotIndex);
}
/**
 * Helper to extract connection details
 */
function getPoolOptions(config) {
    return {
        host: config.host || 'localhost',
        user: config.user,
        password: config.password,
        database: config.database,
        port: config.port || 3306,
        waitForConnections: true,
        connectionLimit: 1,
        queueLimit: 0
    };
}
/**
 * DYNAMIC FALLBACK HELPER
 * Connects to the database and discovers the server's actual native global defaults
 * to prevent hardcoding assumptions.
 */
async function getServerNativeDefaults(config) {
    try {
        const pool = mysql.createPool(getPoolOptions(config));
        // Query the active global system variables for character set and collation defaults
        const [rows] = await pool.query(`
            SELECT 
                (SELECT VARIABLE_VALUE FROM INFORMATION_SCHEMA.GLOBAL_VARIABLES WHERE VARIABLE_NAME = 'character_set_server') as charset,
                (SELECT VARIABLE_VALUE FROM INFORMATION_SCHEMA.GLOBAL_VARIABLES WHERE VARIABLE_NAME = 'collation_server') as collation
        `);

        return {
            fallbackCharset: rows[0]?.charset || 'utf8mb4',
            fallbackCollation: rows[0]?.collation || 'utf8mb4_unicode_ci'
        };
    } catch {
        // Absolute worst-case scenario fallback if the dynamic schema query fails
        return { fallbackCharset: 'utf8mb4', fallbackCollation: 'utf8mb4_unicode_ci' };
    }
}
/**
 * 1. DATABASE CONFIG VALIDATION
 */
async function validateDatabaseConfig(config, characterSet, collation) {
    const cleanCharset = typeof characterSet === 'string' ? characterSet.trim() : '';
    const cleanCollation = typeof collation === 'string' ? collation.trim() : '';

    const pool = mysql.createPool(getPoolOptions(config));

    try {
        // Look up what this specific database server prefers natively
        const { fallbackCharset, fallbackCollation } = await getServerNativeDefaults(pool);

        if (!cleanCharset && !cleanCollation) {
            return { characterSet: fallbackCharset, collation: fallbackCollation };
        }

        let isCharsetValid = false;
        let isCollationValid = false;

        if (cleanCharset) {
            const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?`, [cleanCharset]);
            isCharsetValid = rows.length > 0;
        }
        if (cleanCollation) {
            const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLLATIONS WHERE COLLATION_NAME = ?`, [cleanCollation]);
            isCollationValid = rows.length > 0;
        }

        if (isCharsetValid && isCollationValid) {
            const [match] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLLATIONS WHERE CHARACTER_SET_NAME = ? AND COLLATION_NAME = ?`, [cleanCharset, cleanCollation]);
            if (match.length > 0) return { characterSet: cleanCharset, collation: cleanCollation };
        }
        if (isCharsetValid && !isCollationValid) {
            const [defCol] = await pool.query(`SELECT DEFAULT_COLLATE_NAME FROM INFORMATION_SCHEMA.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?`, [cleanCharset]);
            return { characterSet: cleanCharset, collation: defCol[0]?.DEFAULT_COLLATE_NAME || fallbackCollation };
        }
        if (!isCharsetValid && isCollationValid) {
            const [infChar] = await pool.query(`SELECT CHARACTER_SET_NAME FROM INFORMATION_SCHEMA.COLLATIONS WHERE COLLATION_NAME = ?`, [cleanCollation]);
            return { characterSet: infChar[0]?.CHARACTER_SET_NAME || fallbackCharset, collation: cleanCollation };
        }

        return { characterSet: fallbackCharset, collation: fallbackCollation };
    } catch (error) {
        console.error("Database config validation failed:", error);
        return { characterSet: 'utf8mb4', collation: 'utf8mb4_unicode_ci' };
    } finally {
        await pool.end();
    }
}
/**
 * 2. TABLE CONFIG VALIDATION
 */
async function validateTableConfig(config, characterSet, collation, engine) {
    const cleanEngine = typeof engine === 'string' ? engine.trim() : '';
    const cleanCharset = typeof characterSet === 'string' ? characterSet.trim() : '';
    const cleanCollation = typeof collation === 'string' ? collation.trim() : '';

    const pool = mysql.createPool(getPoolOptions(config));

    try {
        const { fallbackCharset, fallbackCollation } = await getServerNativeDefaults(pool);
        const report = { isValidEngine: false, characterSet: fallbackCharset, collation: fallbackCollation };

        if (cleanEngine) {
            const [engineRows] = await pool.query(
                `SELECT 1 FROM INFORMATION_SCHEMA.ENGINES WHERE ENGINE = ? AND SUPPORT IN ('YES', 'DEFAULT')`,
                [cleanEngine]
            );
            if (engineRows.length > 0) report.isValidEngine = true;
        }

        let isCharsetValid = false;
        let isCollationValid = false;

        if (cleanCharset) {
            const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?`, [cleanCharset]);
            isCharsetValid = rows.length > 0;
        }
        if (cleanCollation) {
            const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLLATIONS WHERE COLLATION_NAME = ?`, [cleanCollation]);
            isCollationValid = rows.length > 0;
        }

        if (isCharsetValid && isCollationValid) {
            const [match] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLLATIONS WHERE CHARACTER_SET_NAME = ? AND COLLATION_NAME = ?`, [cleanCharset, cleanCollation]);
            if (match.length > 0) {
                report.characterSet = cleanCharset;
                report.collation = cleanCollation;
            }
        }
        else if (isCharsetValid && !isCollationValid) {
            const [defCol] = await pool.query(`SELECT DEFAULT_COLLATE_NAME FROM INFORMATION_SCHEMA.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?`, [cleanCharset]);
            report.characterSet = cleanCharset;
            report.collation = defCol[0]?.DEFAULT_COLLATE_NAME || fallbackCollation;
        }
        else if (!isCharsetValid && isCollationValid) {
            const [infChar] = await pool.query(`SELECT CHARACTER_SET_NAME FROM INFORMATION_SCHEMA.COLLATIONS WHERE COLLATION_NAME = ?`, [cleanCollation]);
            report.characterSet = infChar[0]?.CHARACTER_SET_NAME || fallbackCharset;
            report.collation = cleanCollation;
        }

        return report;
    } catch (error) {
        console.error("Table config validation failed:", error);
        return { isValidEngine: false, characterSet: 'utf8mb4', collation: 'utf8mb4_unicode_ci' };
    } finally {
        await pool.end();
    }
}
/**
 * 3. COLUMN CONFIG VALIDATION
 */
async function validateColumnConfig(config, characterSet, collation) {
    const cleanCharset = typeof characterSet === 'string' ? characterSet.trim() : '';
    const cleanCollation = typeof collation === 'string' ? collation.trim() : '';

    const pool = mysql.createPool(getPoolOptions(config));
    try {
        const { fallbackCharset, fallbackCollation } = await getServerNativeDefaults(pool);

        if (!cleanCharset && !cleanCollation) {
            return { characterSet: fallbackCharset, collation: fallbackCollation };
        }

        let isCharsetValid = false;
        let isCollationValid = false;

        if (cleanCharset) {
            const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?`, [cleanCharset]);
            isCharsetValid = rows.length > 0;
        }
        if (cleanCollation) {
            const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLLATIONS WHERE COLLATION_NAME = ?`, [cleanCollation]);
            isCollationValid = rows.length > 0;
        }

        if (isCharsetValid && isCollationValid) {
            const [match] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLLATIONS WHERE CHARACTER_SET_NAME = ? AND COLLATION_NAME = ?`, [cleanCharset, cleanCollation]);
            if (match.length > 0) return { characterSet: cleanCharset, collation: cleanCollation };
        }
        if (isCharsetValid && !isCollationValid) {
            const [defCol] = await pool.query(`SELECT DEFAULT_COLLATE_NAME FROM INFORMATION_SCHEMA.CHARACTER_SETS WHERE CHARACTER_SET_NAME = ?`, [cleanCharset]);
            return { characterSet: cleanCharset, collation: defCol[0]?.DEFAULT_COLLATE_NAME || fallbackCollation };
        }
        if (!isCharsetValid && isCollationValid) {
            const [infChar] = await pool.query(`SELECT CHARACTER_SET_NAME FROM INFORMATION_SCHEMA.COLLATIONS WHERE COLLATION_NAME = ?`, [cleanCollation]);
            return { characterSet: infChar[0]?.CHARACTER_SET_NAME || fallbackCharset, collation: cleanCollation };
        }

        return { characterSet: fallbackCharset, collation: fallbackCollation };
    } catch (error) {
        console.error("Column config validation failed:", error);
        return { characterSet: 'utf8mb4', collation: 'utf8mb4_unicode_ci' };
    } finally {
        await pool.end();
    }
}

async function validateJsonRowData() {
    try {
        console.log(cstyler.bold.yellow("Please wait. We are validating data."));
        // Lets get folder tree
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
            if (item === "files" && Object.hasOwn(fileItem, "contents") && fileItem.type === "folder") {
                continue;
            } else {
                if (fileItem.type === "folder") {
                    throw new Error("Unwanted folder found inside backup compressed zip file. File have changed. Please do not use un protected file. Pleae upload file that was backup by DBBACKUPER tool.");
                } else {
                    if (fileItem.name === "dbtaskerdata.json" || fileItem.name === "raw.json") {
                        continue;
                    } else if (fileItem.extension !== ".json" || !fncs.isNumber(getBaseNameWithoutExt(fileItem.name))) {
                        throw new Error("We have found differant file name or type than we normally backup using DBBACKUPER. File must be changed. For your security we are abborting.");
                    } else {
                        // Lets check backedup file now
                        const readfile = await ff.readJsonFile(fileItem.path);
                        if (readfile === null) {
                            throw new Error("Having problem reading JSON data from files. Please check permission and try agina.");
                        }
                        else {
                            for (const db of Object.keys(readfile)) {
                                if (!fncs.isJsonObject(readfile[db])) {
                                    throw new Error("File must be damaged, deprecated or changed. We are abborting for your security.");
                                }
                                for (const table of Object.keys(readfile[db])) {
                                    if (!Array.isArray(readfile[db][table])) {
                                        throw new Error("File must be damaged, deprecated or changed. We are abborting for security reason.");
                                    }
                                    for (const row of readfile[db][table]) {
                                        if (!fncs.isJsonObject(row)) {
                                            throw new Error("File must be damaged, deprecated or changed. We are abborting for security reason.");
                                        }
                                        for (const col of Object.keys(row)) {
                                            if (!fncs.isJsonObject(row[col])) {
                                                continue;
                                            }
                                            if (Object.hasOwn(row[col], "isSaved") && row[col].isSaved === true) {
                                                const isfile = await ff.isfilepath(row[col].filepath);
                                                if (isfile !== true) {
                                                    throw new Error("Unable to find backup files that were saved when preparing the backup of your database.");
                                                }
                                            }

                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return true;
    } catch (e) {
        console.error("Having problem validating JSON row data. Error message: ", e.message);
        return null;
    }
}


module.exports = {
    isValidFilename,
    getBaseNameWithoutExt,
    validateDatabaseConfig,
    validateTableConfig,
    validateColumnConfig,
    validateJsonRowData,
}