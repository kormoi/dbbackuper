# Working on PG
This module would download and install pg or Postgre module. Do not worry. It will take a few kelo byte of space on your drive. It will not disturbe your system until you call pg module and work with it.

# 🗄️ DBBACKUPER
### The Ultra-Flexible, Intelligent Database Backup & Synchronization Engine

`dbbackuper` is a developer-friendly, bulletproof database backup utility designed to safely handle production workflows without strict configuration rigidness. Featuring a highly adaptive, **case-insensitive key/value aliasing engine**, it seamlessly interprets user intent—whether they type shorthand flags, environment variable names, spaced configurations, or custom parameters.

[![npm version](https://img.shields.io/badge/npm-v3.1.4-blue.svg)](https://www.npmjs.com/package/dbbackuper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=flat-square&logo=mysql&logoColor=white)](https://www.mysql.com/)
[![Facebook](https://img.shields.io/badge/Facebook-%231877F2.svg?logo=Facebook&logoColor=white)](https://facebook.com/kormoi)

---

## 🚀 Key Features

* **Intelligent Parameter Mapping:** Never break a workflow over a typo. Accepts options like `dbHost`, `db_host`, `server`, or `host` automatically.

* **Flexible Strategy Routing:** Tailor data migration workflows using dynamic conflict resolutions (`clean`, `merge/keep_old`, `replace/keep_new`).

* **Automatic Suffix Evaluation:** Intuitively processes strategy tokens with or without suffixes (`clean`, `cleanbackup`, `clean_backup`).

* **Idempotent & Safe Execution:** Built to handle destructive schema updates or protective backups depending on your specific operation mode.

---

## 📦 Installation

```bash
npm install dbbackuper
# or if used alongside core schema automation
npm install dbtasker
```

## 🛠️ Configuration & Smart Aliases
You do not need to memorize exact property structures. The internal parsing architecture normalizes all incoming arguments (lowercase, stripping underscores/hyphens, resolving spaces) and matches them against our global alias groups.

### 1. Database Connection Parameters
Specify connection details using your infrastructure's native keys.

Standard Term | Supported Key Variations & Aliases
| :--- | :--- |
| **Host** | `host, hostname, server, ip, address, domain, endpoint, url, db_host, dbhost, db host, database_host` |
| **Port** | `port, portnumber, conn_port, connection_port, db_port, dbport, db port, database_port` |
| **User** | `user, username, uid, role, account, login, profile, db_user, dbuser, db user, database_user` |
| **Password** | `password, pass, pwd, secret, cred, credential, token, auth, db_password, dbpass, dbpwd` |
| **Database/DB** | `db, database, schema, db_list, dblist, db_name, database_name, target_db, source_database` |



### 2. Operation Core (Work Mode & Slates)
Control how the module initializes actions.

- `workMode` **Key Mapping:** `mode`, `workmode`, `work_mode`, `action`, `operation`, `job`, `task`, `type`, `command`, `direction`, `method`, `strategy`, `process`, `runmode`

- `uploadType` **Key Mapping:** `type`, `uploadtype`, `upload_type`, `strategy`, `syncstrategy`, `sync_strategy`, `policy`, `conflictpolicy`, `conflict_policy`, `behavior`

- `path` **Key Mapping:** `path`, `dir`, `directory`, `folder`, `location`, `destination`, `source`, `target`, `filepath`, `folder_path`, `output_path`, `save_path` (Pure path terms—no backup suffix configuration required)



## ⚙️ Work Mode Configurations
When assigning values to your configurations, you can use any matching action parameter value.


### Download / Export Actions
Triggers an output data compilation sequence.
- **Accepted values:** `download`, `export`, `dump`, `extract`, `pull`, `retrieve`, `save`, `fetch`, `outbound` (+ automatic variations like `download_backup`, `downloadbackup`, `db_dump`, `data_export`).

### Upload / Import Actions
Feeds data back into your target schema configuration.
- **Accepted values:** `upload`, `import`, `load`, `restore`, `push`, `feed`, `ingest`, `inbound` (+ automatic variations like `upload_backup`, `uploadbackup`, `db_import`, `file_upload`).

## 🎯 Upload & Synchronization Type Strategies
When running an **Upload/Import** work mode, passing down a strategy key configulates how primary key collisions or old vs. new data boundaries handle interactions. Every strategy parameter automatically processes base terms, `_backup`, `backup`, and  `backup` suffixes flawlessly.





                ┌───────────────────────────────┐
                │      Is Primary Key Match?    │
                └───────────────┬───────────────┘
                                │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
    [ NO PK COLLISION ]                [ PK COLLISION MATCH ]
                │                                 │
                ▼                                 ▼
    Direct Safe Insert               Evaluate Upload Strategy:
                                    ├── clean -> Wipe table first then add row
                                    ├── merge -> Safe skip / Protect old
                                    ├── replace -> Force overwrite / Newest wins
                                    └── force -> Force download file
                                        (skips bigger than available ram files inside database)




## 🟩 1. Clean Strategy (`cleanBackupAliases`)
**Destructive initialization.** Wipes target structures entirely before dumping fresh dataset arrays.
- Values: `clean`, `purge`, `truncate`, `reset`, `clear`, `empty`, `blank`, `wipeout`, `fresh`, `readd`, `mirror`, `wipe`, `sanitize`, `flush`, `initialize`, `obliterate`

## 🟦 2. Merge / Keep Old Strategy (`mergeKeepOldAliases`)
**Safe / Additive preservation.** Inserts missing rows cleanly. If a record collision occurs, it acts as a protective shield for the live environment, skipping modifications or preserving the older row structure.
- Values: `merge`, `upsert`, `update`, `sync`, `patch`, `combine`, `additive`, `append`, `integrate`, `blend`, `coalesce`, `amalgamate`, `intertwine`, `keepold`, `keepoldest`, `oldestwins`, `safemerge`, `skipexisting`, `preserve`, `ignoreconflicts`, `keep_old`, `skip_existing`

## 🟨 3. Replace / Keep New Strategy (`replaceKeepNewAliases`)
**Forceful update / Source-of-truth priority.** Brute-forces updates over existing rows on key conflict, or dynamically processes data so the incoming dataset changes take precedence.
- Values: `replace`, `overwrite`, `destructive`, `force`, `rewrite`, `supersede`, `override`, `clobber`, `overlay`, `substitute`, `keepnew`, `keepnewest`, `newestwins`, `smartmerge`, `timestampmerge`, `latest`, `recent`, `keep_new`, `smart_merge`

## 🟥 4. Force Export Strategy (`forceDownloadAliases`)
**File system layout enforcement.** Forces systemic script parameters to bypass target confirmations and write directly over active directory file items.
- Values: `forcedownload`, `force_download`, `forceexport`, `force_export`, `forcedump`, `overwrite_export`, `overwrite_download`

## 📦 5. Scope Optimization (`fullBackupAliases`)
**Scope validation toggles.** Defines if operations encompass structural data aggregates as a comprehensive snapshot block.
- Values: `full`, `complete`, `entire`, `all`, `total`, `comprehensive`, `max`, `bulk`, `whole`

## 💻 Technical Usage Example
```js
JavaScript
const DBBackuper = require('dbbackuper');

// Intentionally mixed/spaced config keys that map perfectly inside the engine
const messyUserConfig = {
    "db server": "127.0.0.1",                       // host: "localhost"
    "db_user": "root",                              // user: "admin_etc"
    "SECRET": "super_secure_pass",                  // Database passowrd
    "port": 3306,
    "target db": "production_warehouse",            // That you want to backup or you can keep it empty then system will deside
    "work mode": "import_backup" || "upload backup" || "download",          // Evaluates as Upload Mode
    "sync strategy": "skip_existing",      // Best describe in three words clean(delete everything old) or replace(change database setting and replace if primary key exist) or merge(change setting and do not add replace data if exist)
    "folder path": "./backups/july_2026/" // if uploading file path "./backup/july_2026.zip" must be zip
    "full backup": true; // by default it is false (if you want to backup program files also or not)
    "force download"; false; // if true it will leave those rows that contain bigger data on a single column then available RAM
};

const backupEngine = await DBBackuper(messyUserConfig);
console.log("Operation handled successfully via automated alias extraction!");
```

## 📄 License
This project is licensed under the MIT License.