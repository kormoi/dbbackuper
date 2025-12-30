const mysql = require('mysql2/promise');
const fs = require("fs/promises");  // Importing fs.promises for async operations
const path = require("path");  // Importing Node's path module
const cstyler = require("cstyler");



function isNumber(str) {
  if (str === null || str === undefined) {
    return false;
  }
  if (typeof str === "number") {
    return true;
  }
  if (Array.isArray(str) || typeof str === "object") {
    return false;
  }
  return !isNaN(str) && str.trim() !== "";
}
function getDateTime(separator = "/") {
  const today = new Date();
  const formattedDateTime =
    today.getFullYear() +
    separator +
    (today.getMonth() + 1).toString().padStart(2, "0") +
    separator +
    today.getDate().toString().padStart(2, "0") +
    " " +
    today.getHours().toString().padStart(2, "0") +
    separator +
    today.getMinutes().toString().padStart(2, "0") +
    separator +
    today.getSeconds().toString().padStart(2, "0");

  const formatedDate =
    today.getFullYear() +
    separator +
    (today.getMonth() + 1).toString().padStart(2, "0") +
    separator +
    today.getDate().toString().padStart(2, "0");
  const formatedTime =
    today.getHours().toString().padStart(2, "0") +
    separator +
    today.getMinutes().toString().padStart(2, "0") +
    separator +
    today.getSeconds().toString().padStart(2, "0");
  return {
    year: today.getFullYear(),
    month: (today.getMonth() + 1).toString().padStart(2, "0"),
    day: today.getDate().toString().padStart(2, "0"),
    date: formatedDate,
    time: formatedTime,
    hours: today.getHours().toString().padStart(2, "0"),
    minutes: today.getMinutes().toString().padStart(2, "0"),
    seconds: today.getSeconds().toString().padStart(2, "0"),
    datetime: formattedDateTime,
  };
}
async function getMySQLVersion(config) {
  const connection = await mysql.createConnection(config);
  try {
    const [rows] = await connection.execute('SELECT VERSION() AS version');
    const version = rows[0].version;
    console.log("Mysql database version is: ", cstyler.green(version));
    return version;
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
async function getCharsetAndCollations(config) {
  try {
    const conn = await mysql.createConnection(config);

    const [charsetRows] = await conn.query("SHOW CHARACTER SET");
    const characterSets = charsetRows.map(row => row.Charset);

    const [collationRows] = await conn.query("SHOW COLLATION");
    const collations = collationRows.map(row => row.Collation);

    await conn.end();
    return { characterSets, collations };
  } catch (err) {
    return null;
  }
}
async function isCharsetCollationValid(config, charset, collation) {
  let connection;

  try {
    connection = await mysql.createConnection(config);

    const [rows] = await connection.execute(`
            SELECT 1
            FROM information_schema.COLLATIONS
            WHERE COLLATION_NAME = ?
              AND CHARACTER_SET_NAME = ?
        `, [collation, charset]);

    return rows.length > 0;

  } catch (err) {
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function getMySQLEngines(config) {
  let connection;

  try {
    connection = await mysql.createConnection(config);

    const [rows] = await connection.query("SHOW ENGINES");

    const engines = {};

    for (const row of rows) {
      engines[row.Engine] = {
        support: row.Support,
        comment: row.Comment
      };
    }

    return engines;

  } catch (err) {
    console.error(`Failed to fetch MySQL engines: ${err.message}`);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
function isValidMySQLConfig(config) {
  if (typeof config !== 'object' || config === null) return false;

  const requiredKeys = ['host', 'user', 'password', 'port'];

  for (const key of requiredKeys) {
    if (!(key in config)) return false;

    const value = config[key];
    const type = typeof value;

    // Allow string, number, boolean
    if (!['string', 'number', 'boolean'].includes(type)) return false;

    // Extra string validation
    if (type === 'string' && value.trim() === '') return false;
  }

  return true;
}
async function isMySQLDatabase(config) {
  const isvalidconfig = isValidMySQLConfig(config);
  if (isvalidconfig === false) {
    throw new Error("There is some information missing in config.");
  }
  console.log("Config is okay. We are good to go.");
  let connection;
  try {
    connection = await mysql.createConnection(config);
    const [rows] = await connection.query('SELECT VERSION() AS version');

    const version = rows?.[0]?.version;

    // Check that version is a non-empty string
    return typeof version === 'string' && version.length > 0;
  } catch (err) {
    console.error('Connection error:', err.message);
    return false;
  } finally {
    if (connection) await connection.end();
  }
}
async function checkDatabaseExists(config, dbName) {
  try {
    const connection = await mysql.createConnection({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port || 3306
    });

    const [rows] = await connection.query("SHOW DATABASES LIKE ?", [dbName]);
    await connection.end();

    return rows.length > 0;
  } catch (err) {
    console.error(err.message);
    return null;
  }
}
async function dropDatabase(config, databaseName) {
  let connection;
  try {
    // Connect to server without specifying database
    connection = await mysql.createConnection({
      port: config.port,
      host: config.host,
      user: config.user,
      password: config.password
    });

    // Check if database exists
    const [rows] = await connection.query(
      `SELECT SCHEMA_NAME 
       FROM INFORMATION_SCHEMA.SCHEMATA 
       WHERE SCHEMA_NAME = ?`,
      [databaseName]
    );

    if (rows.length === 0) {
      return false;
    }

    // Drop the database
    await connection.query(`DROP DATABASE \`${databaseName}\``);
    return true;
  } catch (err) {
    console.error("Error dropping database:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function dropTable(config, databaseName, tableName) {
  let connection;
  try {
    config.database = databaseName;
    connection = await mysql.createConnection({ ...config, database: databaseName });

    // Check if table exists
    const [tables] = await connection.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [databaseName, tableName]
    );

    if (tables.length === 0) {
      console.log(`Table '${tableName}' does not exist in ${databaseName}`);
      return false;
    }

    // Drop foreign keys from other tables referencing this table
    const [fkRefs] = await connection.query(
      `SELECT TABLE_NAME, CONSTRAINT_NAME 
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
       WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?`,
      [databaseName, tableName]
    );

    for (const ref of fkRefs) {
      console.log(`Dropping foreign key '${ref.CONSTRAINT_NAME}' from table '${ref.TABLE_NAME}'`);
      await connection.query(
        `ALTER TABLE \`${ref.TABLE_NAME}\` DROP FOREIGN KEY \`${ref.CONSTRAINT_NAME}\``
      );
    }

    // Drop the table
    await connection.query(`DROP TABLE \`${tableName}\``);

    console.log(`Table '${tableName}' dropped successfully from ${databaseName}`);
    return true;
  } catch (err) {
    console.error("Error dropping table:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function dropColumn(config, databaseName, tableName, columnName) {
  let connection;
  try {
    config.database = databaseName;
    connection = await mysql.createConnection(config);

    // 1️⃣ Check if column exists
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME, COLUMN_KEY
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [databaseName, tableName, columnName]
    );

    // ❌ Column does not exist → return false
    if (columns.length === 0) {
      console.log(
        `Column '${columnName}' does not exist in ${databaseName}.${tableName}`
      );
      return false;
    }

    const columnKey = columns[0].COLUMN_KEY;

    // 2️⃣ Drop foreign key constraints
    const [fkConstraints] = await connection.query(
      `SELECT CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [databaseName, tableName, columnName]
    );

    for (const fk of fkConstraints) {
      await connection.query(
        `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``
      );
    }

    // 3️⃣ Drop primary key if needed
    if (columnKey === "PRI") {
      await connection.query(
        `ALTER TABLE \`${tableName}\` DROP PRIMARY KEY`
      );
    }

    // 4️⃣ Drop column
    await connection.query(
      `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``
    );

    console.log(
      `Column '${columnName}' dropped successfully from ${databaseName}.${tableName}`
    );

    return true;
  } catch (err) {
    console.error("Error dropping column:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}

async function getAllDatabaseNames(config) {
  let connection;

  try {
    connection = await mysql.createConnection(config);
    const [rows] = await connection.query('SHOW DATABASES');

    // Extract database names from result
    const databases = rows.map(row => row.Database);
    return databases;
  } catch (err) {
    console.error('❌ Error fetching database names:', err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
function isValidMySQLIdentifier(name) {
  if (typeof name !== "string") return false;
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}
function isValidDatabaseName(name) {
  if (typeof name !== 'string') return false;

  const maxLength = 64;

  const reservedKeywords = new Set([
    "select", "insert", "update", "delete", "create", "drop", "alter", "table",
    "from", "where", "join", "and", "or", "not", "null", "group", "by", "order",
    "having", "into", "as", "like", "union", "distinct", "case", "when", "then",
    "else", "end", "in", "exists", "between", "index", "primary", "foreign", "key",
    "check", "constraint", "default", "trigger", "view", "procedure", "function",
    "grant", "revoke", "all", "any", "asc", "desc", "count", "limit", "offset",
    "schema", "cursor", "declare", "begin", "end", "fetch", "loop", "exit",
    "handler", "leave", "open", "close", "temporary", "replace", "if", "while",
    "repeat", "do", "admin", "root", "master", "mysql", "postgres", "test", "sys",
    "system", "public", "information_schema", "performance_schema", "pg_catalog"
  ]);

  const osReserved = new Set([
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6",
    "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6",
    "lpt7", "lpt8", "lpt9"
  ]);

  const lowerName = name.toLowerCase();

  // Basic rules
  if (name.length === 0 || name.length > maxLength) return false;
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return false;
  if (reservedKeywords.has(lowerName)) return false;
  if (osReserved.has(lowerName)) return false;

  return true;
}
function isValidTableName(name) {
  if (typeof name !== 'string') return false;

  const maxLength = 64;

  const reservedKeywords = new Set([
    "select", "insert", "update", "delete", "create", "drop", "alter", "table",
    "from", "where", "join", "and", "or", "not", "null", "group", "by", "order",
    "having", "into", "as", "like", "union", "distinct", "case", "when", "then",
    "else", "end", "in", "exists", "between", "index", "primary", "foreign", "key",
    "check", "constraint", "default", "trigger", "view", "procedure", "function",
    "grant", "revoke", "all", "any", "asc", "desc", "count", "limit", "offset",
    "schema", "cursor", "declare", "begin", "end", "fetch", "loop", "exit",
    "handler", "leave", "open", "close", "temporary", "replace", "if", "while",
    "repeat", "do", "admin", "root", "master", "mysql", "postgres", "test", "sys",
    "system", "public", "information_schema", "performance_schema", "pg_catalog"
  ]);

  const invalidCharacters = /[^a-zA-Z0-9_]/;
  const startsInvalid = /^[^a-zA-Z]/;
  const lowerName = name.toLowerCase();

  if (name.length === 0 || name.length > maxLength) return false;
  if (invalidCharacters.test(name)) return false;
  if (startsInvalid.test(name)) return false;
  if (reservedKeywords.has(lowerName)) return false;

  return true;
}
function isValidColumnName(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0) return false;
  const maxLength = 64;

  const reservedKeywords = new Set([
    "select", "insert", "update", "delete", "create", "drop", "alter", "table",
    "column", "from", "where", "join", "and", "or", "not", "null", "group", "by",
    "order", "having", "into", "as", "like", "union", "distinct", "case", "when",
    "then", "else", "end", "in", "exists", "between", "index", "primary", "foreign",
    "key", "check", "constraint", "default", "trigger", "view", "procedure",
    "function", "grant", "revoke", "asc", "desc", "limit", "offset", "schema",
    "if", "while", "do", "loop", "replace", "return", "all", "any", "begin", "end"
  ]);

  const startsInvalid = /^[^a-zA-Z]/;
  const invalidChars = /[^a-zA-Z0-9_]/;
  const lowerName = name.toLowerCase();

  if (name.length === 0 || name.length > maxLength) return false;
  if (startsInvalid.test(name)) return false;           // Must start with a letter
  if (invalidChars.test(name)) return false;            // Only letters, numbers, _
  if (reservedKeywords.has(lowerName)) return false;    // Not a SQL keyword

  return true;
}
function createloopname(text, separator = "_") {
  if (!isJsonObject(text)) {
    return null;
  }
  separator = separator.toString();
  if (text.loop === null) {
    return text.name;
  } else if (['year', 'years'].includes(text.loop)) {
    return text.name + separator + getDateTime().year + separator;
  } else if (['month', 'months'].includes(text.loop)) {
    return text.name + separator + getDateTime().year + separator + getDateTime().month + separator;
  } else if (['day', 'days'].includes(text.loop)) {
    return text.name + separator + getDateTime().year + separator + getDateTime().month + separator + getDateTime().day + separator;
  } else {
    return false;
  }
}
function getloop(text) {
  if (typeof text !== "string") {
    return null;
  }
  if (text.startsWith("(year)") || text.endsWith("(year)")) {
    return { name: text.replace("(year)", ""), loop: "year" };
  } else if (text.startsWith("(years)") || text.endsWith("(years)")) {
    return { name: text.replace("(years)", ""), loop: "year" };
  } else if (text.startsWith("(month)") || text.endsWith("(month)")) {
    return { name: text.replace("(month)", ""), loop: "month" };
  } else if (text.startsWith("(months)") || text.endsWith("(months)")) {
    return { name: text.replace("(months)", ""), loop: "month" };
  } else if (text.startsWith("(day)") || text.endsWith("(day)")) {
    return { name: text.replace("(day)", ""), loop: "day" };
  } else if (text.startsWith("(days)") || text.endsWith("(days)")) {
    return { name: text.replace("(days)", ""), loop: "day" };
  } else {
    return { name: text, loop: null }
  }
}
function perseTableNameWithLoop(text, separator = "_") {
  if (typeof text !== 'string') return null;
  text = text.trim();
  let gtlp = getloop(text);
  if (gtlp.loop === null) {
    if (isValidTableName(gtlp.name)) {
      gtlp.loopname = gtlp.name;
      return gtlp;
    } else {
      return false;
    }
  } else if (gtlp === null) {
    return false;
  } else {
    const loopname = createloopname(gtlp, separator);
    if (isValidTableName(loopname)) {
      return { name: gtlp.name, loop: gtlp.loop, loopname: loopname }
    } else {
      return false;
    }
  }
}
function perseDatabaseNameWithLoop(text, separator = "_") {
  if (typeof text !== 'string') return false;
  text = text.trim();
  let gtlp = getloop(text);
  if (gtlp.loop === null) {
    if (isValidDatabaseName(gtlp.name)) {
      gtlp.loopname = gtlp.name;
      return gtlp;
    } else {
      return false;
    }
  } else if (gtlp === null) {
    return false;
  } else {
    const loopname = createloopname(gtlp, separator);
    if (isValidDatabaseName(loopname)) {
      return { name: gtlp.name, loop: gtlp.loop, loopname: loopname }
    } else {
      return false;
    }
  }
}
function reverseLoopName(text) {
  if (typeof text !== "string" || text.length === 0) return text;

  const nowYear = new Date().getFullYear();
  const sep = text[text.length - 1]; // The separator "_"
  const core = text.slice(0, -1);    // Remove trailing separator

  // This Regex looks for the structure:
  // [sep] + YEAR + optional([sep]+MONTH) + optional([sep]+DAY)
  const dateRegex = new RegExp(`[${sep}](\\d{4})(?:[${sep}](\\d{2}))?(?:[${sep}](\\d{2}))?$`);
  const match = core.match(dateRegex);

  if (!match) return text;

  const [fullMatch, year, month, day] = match;

  // Validate Year
  if (parseInt(year) > nowYear) return text;

  // Determine granularity based on what was provided in the string
  let type = "year";
  if (day) {
    type = "day";
  } else if (month) {
    type = "month";
  }

  // To get the "previous form":
  // We take the core and remove the entire date block (fullMatch).
  // Then we add the separator back to match your "base + _" rule.
  const basePart = core.slice(0, core.length - fullMatch.length);
  const baseWithSep = basePart;

  return [
    `${baseWithSep}(${type})`,
    `${baseWithSep}(${type}s)`,
    `(${type})${baseWithSep}`,
    `(${type}s)${baseWithSep}`
  ];
}








async function getLastSavedFile(directory) {
  try {
    // Read the directory
    const files = await fs.readdir(directory);

    // Handle empty directory
    if (files.length === 0) {
      throw new Error(`No files found in the directory: ${directory}`);
    }

    // Get file stats and sort by modification time
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(directory, file);
        const stats = await fs.stat(filePath);
        return { file, stats };
      })
    );

    const sortedFiles = fileStats.sort((a, b) => b.stats.mtime - a.stats.mtime);

    // Return the most recently saved file
    const lastSavedFile = sortedFiles[0]?.file; // Use optional chaining
    return lastSavedFile;
  } catch (err) {
    console.error(
      `Error getting last saved file from directory "${directory}": ${err.message}`
    );
    return null; // Return `null` if an error occurs
  }
}
async function compareJsonFiles(filePath1, filePath2) {
  try {
    // Ensure both files exist
    await fs.access(filePath1);
    await fs.access(filePath2);

    // Read the content of both files
    const fileContent1 = await fs.readFile(filePath1, "utf-8");
    const fileContent2 = await fs.readFile(filePath2, "utf-8");

    // Check if either file is empty
    if (!fileContent1.trim()) {
      console.error("File 1 is empty.");
      return false;
    }
    if (!fileContent2.trim()) {
      console.error("File 2 is empty.");
      return false;
    }

    // Parse the JSON content of both files
    let jsonData1, jsonData2;
    try {
      jsonData1 = JSON.parse(fileContent1);
    } catch (parseError) {
      console.error("Failed to parse File 1:", parseError.message);
      return false;
    }

    try {
      jsonData2 = JSON.parse(fileContent2);
    } catch (parseError) {
      console.error("Failed to parse File 2:", parseError.message);
      return false;
    }

    // Compare the two JSON objects using deepEqual
    const isEqual = JSON.stringify(jsonData1) === JSON.stringify(jsonData2);
    console.log("Are the JSON files equal?", isEqual);
    return isEqual;
  } catch (error) {
    // Log specific errors
    if (error.code === "ENOENT") {
      console.warn(`File not found: ${error.path}`);
      return false;
    } else {
      console.error("Error comparing JSON files:", error.message);
      return null;
    }
  }
}
async function readJsonFile(filePath) {
  try {
    // Check if the file has a .json extension
    if (path.extname(filePath).toLowerCase() !== ".json") {
      throw new Error(`The file at ${filePath} is not a JSON file.`);
    }

    // Read the file as a string
    const fileContent = await fs.readFile(filePath, "utf-8");

    // Parse the JSON string into an object
    const jsonData = JSON.parse(fileContent);
    return jsonData;
  } catch (error) {
    // Handle errors (e.g., file not found, invalid JSON)
    console.error(`Error reading or parsing JSON file at ${filePath}:`, error);
    return null;
  }
}
async function writeJsonFile(filePath, data) {
  try {
    // Ensure the directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Convert the data object to a JSON string with indentation
    const jsonString = JSON.stringify(data, null, 2);

    // Write the JSON string to the file
    await fs.writeFile(filePath, jsonString, "utf-8");
    const successMessage = `File written successfully to ${filePath}`;
    console.log(successMessage);
    return successMessage;
  } catch (error) {
    // Handle errors (e.g., permission issues, invalid data)
    console.error(`Error writing JSON file at ${filePath}:`, error);
    return null;
  }
}
const writeJsFile = async (filePath, content) => {
  try {
    await fs.access(filePath).catch(() => fs.mkdir(path.dirname(filePath), { recursive: true }));
    await fs.writeFile(filePath, content, 'utf8');
    console.log(`File written successfully to ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Error writing file at ${filePath}:`, error);
    return false;
  }
};


function stringifyAny(data) {
  // If the data is undefined or a symbol, handle it explicitly.
  if (typeof data === 'undefined') {
    return 'undefined';
  } else if (data === null) {
    return 'null';
  } else if (data === true) {
    return "true";
  } else if (data === false) {
    return "false";
  }
  if (typeof data === 'symbol') {
    return data.toString();
  }
  // For non-objects (primitives) that are not undefined, simply convert them.
  if (typeof data !== 'object' && typeof data !== 'function') {
    return String(data);
  }
  if (typeof data === "string") {
    return data;
  }
  // Handle objects and functions using JSON.stringify with a custom replacer.
  const seen = new WeakSet();
  const replacer = (key, value) => {
    if (typeof value === 'function') {
      // Convert functions to their string representation.
      return value.toString();
    }
    if (typeof value === 'undefined') {
      return 'undefined';
    }
    if (typeof value === 'object' && value !== null) {
      // Check for circular references
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
  try {
    return JSON.stringify(data, replacer, 2);
  } catch (error) {
    // Fallback to a simple string conversion if JSON.stringify fails
    return String(data);
  }
}
function removefromarray(arr, text = "") {
  if (!Array.isArray(arr)) {
    return false;
  }
  let index = arr.indexOf(text);
  if (index !== -1) {
    arr.splice(index, 1);
  }
  return arr
}
function isSameArray(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (!arr1.includes(arr2[i])) return false;
  }
  return true;
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isJsonString(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch (error) {
    return false;
  }
}
function isJsonSame(a, b) {
  if (isJsonString(a)) a = JSON.parse(a);
  if (isJsonString(b)) b = JSON.parse(b);

  if (a === b) return true;

  if (typeof a !== typeof b || a === null || b === null) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (let key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!isJsonSame(a[key], b[key])) return false;
  }

  return true;
}
function JoinJsonObjects(target = {}, source = {}) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepJoinObjects(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

function bypassQuotes(data) {
  let stringData = "";

  if (typeof data !== "string") {
    stringData = safeStringify(data);
  } else {
    stringData = data;
  }

  // First unescape any previously escaped quotes and backslashes
  stringData = stringData.replace(/\\(["'\\])/g, "$1");

  // Now escape all quotes and backslashes
  return stringData.replace(/(["'\\])/g, "\\$1");
}
async function getTableNames(config, databaseName) {
  const dbName = databaseName || config.database;

  if (!dbName) throw new Error("No database name provided.");

  const query = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = ?
  `;

  const pool = mysql.createPool(config);
  try {
    const [results] = await pool.query(query, [dbName]);
    return results.map(row => row.TABLE_NAME || row.table_name);
  } catch (err) {
    console.error("Query failed:", err.message);
    return null;
  } finally {
    await pool.end();
  }
}
async function getColumnNames(config, databaseName, tableName) {
  let connection;

  try {
    // Create a new connection using the provided config
    connection = await mysql.createConnection({ ...config, database: databaseName });

    const query = `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
    `;

    const [rows] = await connection.execute(query, [databaseName, tableName]);

    return rows.map(row => row.COLUMN_NAME);
  } catch (err) {
    console.error("Error fetching column names:", err.message);
    return null;
  } finally {
    if (connection) await connection.end(); // Ensure connection is closed
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
async function getColumnDetails(config, dbName, tableName, columnName) {
  let connection;
  try {
    connection = await mysql.createConnection({ ...config, database: dbName });

    // 1. Column metadata
    const [cols] = await connection.execute(
      `
      SELECT 
        COLUMN_TYPE,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        EXTRA,
        CHARACTER_SET_NAME,
        COLLATION_NAME,
        COLUMN_COMMENT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      `,
      [dbName, tableName, columnName]
    );

    if (!cols.length) return false;
    const c = cols[0];

    // 2. Parse ENUM / SET / lengths
    let length_value = null;
    if (["decimal", "float", "double"].includes(c.DATA_TYPE)) {
      length_value =
        c.NUMERIC_SCALE !== null
          ? [c.NUMERIC_PRECISION, c.NUMERIC_SCALE]
          : c.NUMERIC_PRECISION;
    } else if (["tinyint", "smallint", "mediumint", "int", "bigint"].includes(c.DATA_TYPE)) {
      length_value = null;
    } else if (c.DATA_TYPE === "enum" || c.DATA_TYPE === "set") {
      length_value = c.COLUMN_TYPE
        .slice(c.DATA_TYPE.length + 1, -1)
        .split(",")
        .map(v => v.trim().replace(/^'(.*)'$/, "$1"));
    } else if (c.CHARACTER_MAXIMUM_LENGTH !== null) {
      length_value = c.CHARACTER_MAXIMUM_LENGTH;
    }

    // 3. Index metadata from STATISTICS
    const [idx] = await connection.execute(
      `
      SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `,
      [dbName, tableName, columnName]
    );

    let index = "";
    if (idx.some(i => i.INDEX_NAME === "PRIMARY")) index = "PRIMARY KEY";
    else if (idx.some(i => i.NON_UNIQUE === 0)) index = "UNIQUE";
    else if (idx.length) index = "KEY";

    return {
      columntype: c.DATA_TYPE.toUpperCase(),
      length_value,
      unsigned: /unsigned/i.test(c.COLUMN_TYPE),
      zerofill: /zerofill/i.test(c.COLUMN_TYPE),
      nulls: c.IS_NULLABLE === "YES",
      defaults: c.COLUMN_DEFAULT,
      autoincrement: c.EXTRA.includes("auto_increment"),
      index,
      _charset_: c.CHARACTER_SET_NAME,
      _collate_: c.COLLATION_NAME,
      comment: c.COLUMN_COMMENT
    };

  } catch (err) {
    console.error(err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function inspectColumnConstraint(config, database, table, column, options = {}) {
  const loose = options.loose !== false; // default true: include composite constraints that contain the column

  if (!database || !table || !column) {
    throw new Error('database, table and column are required');
  }

  // simple identifier checks to avoid injection via identifiers
  const validIdent = s => typeof s === 'string' && /^[A-Za-z0-9$_]+$/.test(s);
  if (!validIdent(database) || !validIdent(table) || !validIdent(column)) {
    throw new Error('Invalid database/table/column name');
  }

  const conn = await mysql.createConnection(config);
  try {
    // 1) Find constraints (from KEY_COLUMN_USAGE) that include the specific column in this table
    const [kcuRows] = await conn.execute(
      `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      [database, table, column]
    );

    // If no constraint rows found, constraints list is empty
    const constraints = [];
    const constraintNames = Array.from(new Set(kcuRows.map(r => r.CONSTRAINT_NAME)));

    if (constraintNames.length > 0) {
      // Build constraint -> columns and referenced columns
      const consMap = new Map();
      for (const r of kcuRows) {
        const name = r.CONSTRAINT_NAME;
        if (!consMap.has(name)) {
          consMap.set(name, {
            constraintName: name,
            columns: [],
            referencedTableSchema: r.REFERENCED_TABLE_SCHEMA || null,
            referencedTable: r.REFERENCED_TABLE_NAME || null,
            referencedColumns: []
          });
        }
        const entry = consMap.get(name);
        entry.columns.push(r.COLUMN_NAME);
        if (r.REFERENCED_COLUMN_NAME) entry.referencedColumns.push(r.REFERENCED_COLUMN_NAME);
      }

      // Get constraint types for these constraint names
      const placeholders = constraintNames.map(() => '?').join(',');
      const [tcRows] = await conn.execute(
        `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME IN (${placeholders})`,
        [database, table, ...constraintNames]
      );
      const typeByName = new Map(tcRows.map(r => [r.CONSTRAINT_NAME, r.CONSTRAINT_TYPE]));

      // If there are foreign keys, fetch their ON DELETE/ON UPDATE rules
      const fkNames = tcRows.filter(r => r.CONSTRAINT_TYPE === 'FOREIGN KEY').map(r => r.CONSTRAINT_NAME);
      const fkRules = new Map();
      if (fkNames.length > 0) {
        const fkPlaceholders = fkNames.map(() => '?').join(',');
        const [rcRows] = await conn.execute(
          `SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE
           FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME IN (${fkPlaceholders})`,
          [database, ...fkNames]
        );
        for (const r of rcRows) fkRules.set(r.CONSTRAINT_NAME, { deleteRule: r.DELETE_RULE, updateRule: r.UPDATE_RULE });
      }

      // Compose final constraint objects
      for (const [name, info] of consMap.entries()) {
        const ctype = typeByName.get(name) || null; // could be null for some implicitly created indexes
        const isPrimary = ctype === 'PRIMARY KEY';
        const isUnique = ctype === 'UNIQUE' || isPrimary;
        const isForeignKey = ctype === 'FOREIGN KEY';
        const rule = isForeignKey ? fkRules.get(name) || {} : {};

        // Apply strict/loose filtering:
        if (loose || (info.columns.length === 1 && info.columns[0] === column)) {
          constraints.push({
            constraintName: name,
            constraintType: ctype,
            columns: info.columns,
            isPrimary,
            isUnique,
            isForeignKey,
            referencedTableSchema: info.referencedTableSchema,
            referencedTable: info.referencedTable,
            referencedColumns: info.referencedColumns,
            deleteRule: rule.deleteRule || null,
            updateRule: rule.updateRule || null
          });
        }
      }
    }

    // 2) Indexes: find index names that include the column, then assemble full column lists for those indexes
    const [idxNameRows] = await conn.execute(
      `SELECT DISTINCT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, table, column]
    );

    const indexes = [];
    if (idxNameRows.length > 0) {
      const idxNames = idxNameRows.map(r => r.INDEX_NAME);
      const placeholders2 = idxNames.map(() => '?').join(',');
      // fetch full index definitions for those indexes
      const [idxRows] = await conn.execute(
        `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME IN (${placeholders2})
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [database, table, ...idxNames]
      );

      const idxMap = new Map();
      for (const r of idxRows) {
        const iname = r.INDEX_NAME;
        if (!idxMap.has(iname)) {
          idxMap.set(iname, { indexName: iname, nonUnique: Number(r.NON_UNIQUE), indexColumns: [] });
        }
        idxMap.get(iname).indexColumns.push(r.COLUMN_NAME);
      }
      // filter by loose/strict: if strict, only include indexes where column list is exactly [column]
      for (const idx of Array.from(idxMap.values())) {
        if (loose || (idx.indexColumns.length === 1 && idx.indexColumns[0] === column)) {
          indexes.push(idx);
        }
      }
    }

    // 3) CHECK constraints: search check clauses for the column (only checks defined on this table)
    const [checkRows] = await conn.execute(
      `SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
         ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
         AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
       WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`,
      [database, table]
    );

    const checks = [];
    if (checkRows.length > 0) {
      // simple text search to see if check clause mentions the column (best-effort)
      const colPattern = new RegExp('(^|[^A-Za-z0-9_`])' + column.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1') + '($|[^A-Za-z0-9_`])', 'i');
      for (const r of checkRows) {
        const clause = r.CHECK_CLAUSE || '';
        if (loose) {
          if (colPattern.test(clause) || clause.includes('`' + column + '`')) {
            checks.push({ constraintName: r.CONSTRAINT_NAME, checkClause: clause });
          }
        } else {
          // strict: only include if the clause explicitly mentions the exact column token (best-effort)
          if (clause.includes('`' + column + '`') || colPattern.test(clause)) {
            checks.push({ constraintName: r.CONSTRAINT_NAME, checkClause: clause });
          }
        }
      }
    }

    const found = constraints.length > 0 || indexes.length > 0 || checks.length > 0;
    return { found, constraints, indexes, checks };
  } catch (err) {
    console.error(err.message);
    return null;
  } finally {
    await conn.end();
  }
}
async function _fetchIndexes(conn, database, tableName) {
  const sql = `
    SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `;
  const [rows] = await conn.execute(sql, [database, tableName]);

  const map = new Map();
  for (const r of rows) {
    const name = r.INDEX_NAME;
    if (!map.has(name)) map.set(name, { indexName: name, columns: [], nonUnique: Boolean(r.NON_UNIQUE) });
    map.get(name).columns.push(r.COLUMN_NAME);
  }

  return Array.from(map.values());
}
async function checkIndexExists(config, database, tableName, indexKey) {
  if (!config || !database || !tableName || indexKey === undefined || indexKey === null) {
    throw new Error('config, database, tableName and indexKey are required');
  }

  const conn = await mysql.createConnection(config);
  try {
    const indexes = await _fetchIndexes(conn, database, tableName);
    if (!indexes.length) {
      return { found: false, matches: [] };
    }

    // Normalize input
    let wantIndexName = null;
    let wantCols = null;

    if (Array.isArray(indexKey)) {
      wantCols = indexKey.map(c => String(c).trim()).filter(Boolean);
    } else if (typeof indexKey === 'string') {
      const s = indexKey.trim();
      if (s.indexOf(',') !== -1) {
        wantCols = s.split(',').map(x => x.replace(/`/g, '').trim()).filter(Boolean);
      } else {
        // try index name first, but also allow single-column match
        wantIndexName = s.replace(/`/g, '');
        wantCols = [s.replace(/`/g, '')];
      }
    } else {
      wantCols = [String(indexKey)];
    }

    const lowerWantName = wantIndexName ? wantIndexName.toLowerCase() : null;
    const lowerWantCols = wantCols ? wantCols.map(c => c.toLowerCase()) : null;

    const matches = [];

    for (const idx of indexes) {
      const idxNameLower = String(idx.indexName).toLowerCase();
      const idxColsLower = idx.columns.map(c => String(c).toLowerCase());

      // If user provided an index name and it matches exactly -> match
      if (lowerWantName && idxNameLower === lowerWantName) {
        matches.push({ indexName: idx.indexName, columns: idx.columns.slice(), nonUnique: idx.nonUnique });
        continue;
      }

      // Otherwise check leftmost-prefix column match (only if wantCols provided)
      if (lowerWantCols && lowerWantCols.length > 0) {
        if (idxColsLower.length >= lowerWantCols.length) {
          let ok = true;
          for (let i = 0; i < lowerWantCols.length; i++) {
            if (idxColsLower[i] !== lowerWantCols[i]) { ok = false; break; }
          }
          if (ok) {
            matches.push({ indexName: idx.indexName, columns: idx.columns.slice(), nonUnique: idx.nonUnique });
            continue;
          }
        }
      }
    }

    return { found: matches.length > 0, matches };
  } catch (err) {
    console.error("Error in checkIndexExists:", err.message);
    return null;
  } finally {
    await conn.end();
  }
}
async function columnHasKey(config, databaseName, tableName, columnName) {
  let connection;
  try {
    connection = await mysql.createConnection({ ...config, database: databaseName });

    // Query for PRIMARY and UNIQUE keys
    const [indexRows] = await connection.execute(`
            SELECT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
        `, [databaseName, tableName, columnName]);

    // Query for FOREIGN KEY constraints
    const [fkRows] = await connection.execute(`
            SELECT CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
              AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [databaseName, tableName, columnName]);

    const keys = [
      ...indexRows.map(row => row.INDEX_NAME),
      ...fkRows.map(row => row.CONSTRAINT_NAME)
    ];

    return { hasKey: keys.length > 0, keys };
  } catch (err) {
    throw err;
  } finally {
    if (connection) await connection.end();
  }
}
async function getForeignKeyDetails(config, databaseName, tableName, columnName = null) {
  let connection;
  try {
    connection = await mysql.createConnection({
      ...config,
      database: databaseName
    });

    const sql = `
      SELECT
        kcu.CONSTRAINT_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        rc.DELETE_RULE,
        rc.UPDATE_RULE,
        kcu.COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ${columnName ? "AND kcu.COLUMN_NAME = ?" : ""}
    `;

    const params = columnName
      ? [databaseName, tableName, columnName]
      : [databaseName, tableName];

    const [rows] = await connection.query(sql, params);

    if (!rows.length) return false;

    // single-column FK
    if (columnName) {
      const r = rows[0];
      return {
        table: r.REFERENCED_TABLE_NAME,
        column: r.REFERENCED_COLUMN_NAME,
        deleteOption: r.DELETE_RULE,
        updateOption: r.UPDATE_RULE,
        constraintName: r.CONSTRAINT_NAME
      };
    }

    // multiple FKs
    return rows.map(r => ({
      column: r.COLUMN_NAME,
      table: r.REFERENCED_TABLE_NAME,
      referencedColumn: r.REFERENCED_COLUMN_NAME,
      deleteOption: r.DELETE_RULE,
      updateOption: r.UPDATE_RULE,
      constraintName: r.CONSTRAINT_NAME
    }));

  } catch (err) {
    console.error("FK lookup error:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function getAllForeignKeyDetails(config, databaseName, tableName) {
  let connection;

  const query = `
    SELECT 
        k.TABLE_NAME,
        k.COLUMN_NAME,
        k.CONSTRAINT_NAME,
        k.REFERENCED_TABLE_NAME,
        k.REFERENCED_COLUMN_NAME,
        r.DELETE_RULE
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
        AND k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = ?
      AND k.TABLE_NAME = ?
      AND k.REFERENCED_TABLE_NAME IS NOT NULL;
  `;

  try {
    connection = await mysql.createConnection({ ...config, database: databaseName });
    const [rows] = await connection.execute(query, [databaseName, tableName]);
    return rows;
  } catch (err) {
    console.error("Error fetching foreign key details:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function findReferencingFromColumns(config, database, parentTable, parentColumn) {
  const conn = await mysql.createConnection(config);
  try {
    // Build KEY_COLUMN_USAGE query. If parentColumn is provided, include it in filter.
    let kcuSql = `
      SELECT
        kcu.CONSTRAINT_SCHEMA AS constraint_schema,
        kcu.TABLE_SCHEMA AS child_schema,
        kcu.TABLE_NAME AS child_table,
        kcu.CONSTRAINT_NAME AS fk_name,
        kcu.COLUMN_NAME AS child_column,
        kcu.ORDINAL_POSITION AS ordinal_position,
        kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
        kcu.REFERENCED_TABLE_NAME AS referenced_table,
        kcu.REFERENCED_COLUMN_NAME AS referenced_column
      FROM information_schema.KEY_COLUMN_USAGE kcu
      WHERE kcu.REFERENCED_TABLE_SCHEMA = ?
        AND kcu.REFERENCED_TABLE_NAME = ?
    `;
    const params = [database, parentTable];
    if (parentColumn) {
      kcuSql += ` AND kcu.REFERENCED_COLUMN_NAME = ?`;
      params.push(parentColumn);
    }
    kcuSql += ` ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;`;

    const [kcuRows] = await conn.execute(kcuSql, params);

    if (!kcuRows.length) return [];

    // Get update/delete rules for the involved constraints from REFERENTIAL_CONSTRAINTS
    // Build list of unique (constraint_schema, constraint_name) pairs
    const uniqueKeys = new Set();
    for (const r of kcuRows) {
      uniqueKeys.add(`${r.constraint_schema}||${r.fk_name}`);
    }
    // Prepare placeholders and params for referential constraints query
    const rcWhereParts = [];
    const rcParams = [];
    for (const key of uniqueKeys) {
      const [schema, name] = key.split('||');
      rcWhereParts.push('(CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = ?)');
      rcParams.push(schema, name);
    }
    const rcSql = `
      SELECT CONSTRAINT_SCHEMA, CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE
      FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE ${rcWhereParts.join(' OR ')};
    `;
    const [rcRows] = rcParams.length ? await conn.execute(rcSql, rcParams) : [[]];

    // Map rc by schema+name
    const rcMap = new Map();
    for (const rc of rcRows) {
      rcMap.set(`${rc.CONSTRAINT_SCHEMA}||${rc.CONSTRAINT_NAME}`, {
        update_rule: rc.UPDATE_RULE,
        delete_rule: rc.DELETE_RULE
      });
    }

    // Group kcuRows by constraint (schema + fk_name + child_table) and collect ordered columns
    const grouped = new Map();
    for (const row of kcuRows) {
      const key = `${row.child_schema}||${row.child_table}||${row.fk_name}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          fk_name: row.fk_name,
          child_schema: row.child_schema,
          child_table: row.child_table,
          child_columns: [],
          referenced_schema: row.referenced_schema,
          referenced_table: row.referenced_table,
          referenced_columns: [],
          ordinal_positions: []
        });
      }
      const g = grouped.get(key);
      g.child_columns.push(row.child_column);
      g.referenced_columns.push(row.referenced_column);
      g.ordinal_positions.push(row.ordinal_position);
    }

    // Build final array and attach update/delete rules if available.
    const result = [];
    for (const [key, g] of grouped.entries()) {
      const [schema, , fk_name] = key.split('||');
      const rcKey = `${schema}||${fk_name}`;
      const rc = rcMap.get(rcKey) || {};
      // Ensure columns are ordered by ordinal_position (we already fetched in order,
      // but let's be defensive and sort if needed)
      // (we'll build an array of tuples and sort)
      const tuples = g.ordinal_positions.map((ord, i) => ({ ord: Number(ord), child: g.child_columns[i], ref: g.referenced_columns[i] }));
      tuples.sort((a, b) => a.ord - b.ord);
      const child_columns = tuples.map(t => t.child);
      const referenced_columns = tuples.map(t => t.ref);

      result.push({
        fk_name: g.fk_name,
        child_schema: g.child_schema,
        child_table: g.child_table,
        child_columns,
        referenced_schema: g.referenced_schema,
        referenced_table: g.referenced_table,
        referenced_columns,
        update_rule: rc.update_rule || null,
        delete_rule: rc.delete_rule || null
      });
    }

    return result;
  } catch (err) {
    console.error("Error in findReferencingColumns:", err.message);
    return null;
  } finally {
    await conn.end();
  }
}
async function addForeignKeyWithIndex(config, dbName, tableName, columnName, refTable, refColumn, options = {}) {
  const {
    onDelete = "RESTRICT",
    onUpdate = "RESTRICT"
  } = options;

  const indexName = `idx_${tableName}_${columnName}`;
  const fkName = `fk_${tableName}_${refTable}_${columnName}`;

  let connection;

  try {
    connection = await mysql.createConnection({
      ...config,
      database: dbName
    });

    // Add index (ignore if already exists)
    try {
      await connection.query(`
        ALTER TABLE \`${tableName}\`
        ADD INDEX \`${indexName}\` (\`${columnName}\`)
      `);
    } catch (_) {
      // index probably exists — safe to ignore
    }

    // Add foreign key constraint
    await connection.query(`
      ALTER TABLE \`${tableName}\`
      ADD CONSTRAINT \`${fkName}\`
      FOREIGN KEY (\`${columnName}\`)
      REFERENCES \`${refTable}\` (\`${refColumn}\`)
      ON DELETE ${onDelete}
      ON UPDATE ${onUpdate}
    `);

    return true;
  } catch (err) {
    const message = err?.message || "";

    console.error("FK add error:", message);

    if (message.toLowerCase().includes("duplicate")) {
      return false; // already exists
    }

    return null;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
async function addForeignKey(config, data) {
  const {
    database,
    table,
    column,
    refTable,
    refColumn,
    onDelete = "RESTRICT",
    onUpdate = "RESTRICT"
  } = data;

  const connection = await mysql.createConnection({
    ...config,
    database
  });

  try {
    // 1. Ensure column index exists (required for FK)
    const [indexes] = await connection.execute(
      `
      SHOW INDEX
      FROM \`${table}\`
      WHERE Column_name = ?
      `,
      [column]
    );

    if (indexes.length === 0) {
      await connection.execute(
        `ALTER TABLE \`${table}\` ADD INDEX (\`${column}\`)`
      );
    }

    // 2. Generate constraint name
    const constraintName = `fk_${table}_${column}_${refTable}_${refColumn}`;

    // 3. Add foreign key
    const sql = `
      ALTER TABLE \`${table}\`
      ADD CONSTRAINT \`${constraintName}\`
      FOREIGN KEY (\`${column}\`)
      REFERENCES \`${refTable}\` (\`${refColumn}\`)
      ON DELETE ${onDelete}
      ON UPDATE ${onUpdate}
    `;

    await connection.execute(sql);

    return {
      success: true,
      constraint: constraintName
    };
  } finally {
    await connection.end();
  }
}
async function removeForeignKeyFromColumn(config, databaseName, tableName, columnName) {
  let connection;

  try {
    connection = await mysql.createConnection({
      ...config,
      database: databaseName
    });

    // 1️⃣ Find FK constraint(s) for this column
    const fkRowsSql = `
      SELECT
        CONSTRAINT_NAME,
        ORDINAL_POSITION
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `;

    const [fkRows] = await connection.query(fkRowsSql, [
      databaseName,
      tableName,
      columnName
    ]);

    if (!fkRows.length) {
      return false; // no FK
    }

    // Multiple rows possible for composite FKs
    const constraintName = fkRows[0].CONSTRAINT_NAME;

    // 2️⃣ Get all columns in this FK constraint
    const fkColsSql = `
      SELECT COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    const [fkCols] = await connection.query(fkColsSql, [
      databaseName,
      tableName,
      constraintName
    ]);

    const fkColumnNames = fkCols.map(r => r.COLUMN_NAME);

    // 3️⃣ Drop the foreign key constraint
    await connection.query(`
      ALTER TABLE \`${tableName}\`
      DROP FOREIGN KEY \`${constraintName}\`
    `);

    // 4️⃣ Find candidate indexes that exactly match FK columns
    const indexSql = `
      SELECT
        INDEX_NAME,
        COLUMN_NAME,
        SEQ_IN_INDEX
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME IN (?)
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `;

    const [indexRows] = await connection.query(indexSql, [
      databaseName,
      tableName,
      fkColumnNames
    ]);

    // Group index columns
    const indexMap = new Map();

    for (const row of indexRows) {
      if (!indexMap.has(row.INDEX_NAME)) {
        indexMap.set(row.INDEX_NAME, []);
      }
      indexMap.get(row.INDEX_NAME).push(row.COLUMN_NAME);
    }

    // 5️⃣ Drop index only if it exactly matches FK columns
    for (const [indexName, cols] of indexMap.entries()) {
      if (
        cols.length === fkColumnNames.length &&
        cols.every((c, i) => c === fkColumnNames[i])
      ) {
        await connection.query(`
          ALTER TABLE \`${tableName}\`
          DROP INDEX \`${indexName}\`
        `);
        break; // only one index per FK
      }
    }

    return true;

  } catch (err) {
    console.error("Drop FK error:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function removeForeignKeyConstraintFromColumn(config, databaseName, tableName, columnName) {
  let connection;
  let removed = false;

  try {
    connection = await mysql.createConnection({
      ...config,
      database: databaseName
    });

    /* 1️⃣ Remove FOREIGN KEY if exists */
    const [fkRows] = await connection.execute(`
            SELECT CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
              AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [databaseName, tableName, columnName]);

    for (const row of fkRows) {
      await connection.execute(`
                ALTER TABLE \`${tableName}\`
                DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\`
            `);
      removed = true;
    }

    /* 2️⃣ Remove INDEX / UNIQUE KEY (excluding PRIMARY) */
    const [indexRows] = await connection.execute(`
            SELECT DISTINCT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
              AND INDEX_NAME <> 'PRIMARY'
        `, [databaseName, tableName, columnName]);

    for (const row of indexRows) {
      await connection.execute(`
                ALTER TABLE \`${tableName}\`
                DROP INDEX \`${row.INDEX_NAME}\`
            `);
      removed = true;
    }

    return removed;

  } catch (err) {
    console.error(err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function columnExists(config, databaseName, tableName, columnName) {
  let connection;
  try {
    connection = await mysql.createConnection(config);

    const [rows] = await connection.execute(
      `
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            LIMIT 1
            `,
      [databaseName, tableName, columnName]
    );

    return rows.length > 0;
  } catch (err) {
    console.error("columnExists error:", err.message);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}
async function runQuery(config, databaseName, queryText) {
  let connection;
  try {
    if (!queryText || typeof queryText !== "string") return null;
    console.log("Database:", cstyler.hex("#00d9ffff")(databaseName), "Running query: ", cstyler.green(queryText));

    connection = await mysql.createConnection({
      ...config,
      database: databaseName
    });

    await connection.execute(queryText);
    return true;
  } catch (err) {
    const errms = err.message;
    console.error(errms);
    return null;
  } finally {
    if (connection) await connection.end();
  }
}




module.exports = {
  isNumber,
  getDateTime,
  removefromarray,
  isSameArray,
  getMySQLVersion,
  isMySQL578OrAbove,
  isValidMySQLConfig,
  isMySQLDatabase,
  getCharsetAndCollations,
  isCharsetCollationValid,
  getMySQLEngines,
  checkDatabaseExists,
  getAllDatabaseNames,
  isValidMySQLIdentifier,
  isValidDatabaseName,
  isValidTableName,
  isValidColumnName,
  createloopname,
  perseTableNameWithLoop,
  perseDatabaseNameWithLoop,
  getloop,
  reverseLoopName,
  stringifyAny,
  isJsonString,
  isJsonObject,
  isJsonSame,
  JoinJsonObjects,
  getTableNames,
  getColumnNames,
  getDatabaseCharsetAndCollation,
  getColumnDetails,
  inspectColumnConstraint,
  checkIndexExists,
  columnHasKey,
  getForeignKeyDetails,
  getAllForeignKeyDetails,
  findReferencingFromColumns,
  addForeignKeyWithIndex,
  addForeignKey,
  removeForeignKeyFromColumn,
  removeForeignKeyConstraintFromColumn,
  columnExists,
  dropDatabase,
  dropTable,
  dropColumn,
  writeJsFile,
  runQuery,
}