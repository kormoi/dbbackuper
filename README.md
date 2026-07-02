# 🗄️ DBBACKUPER

## 🛠️ Configuration & Smart Aliases
You do not need to memorize exact property structures. The internal parsing architecture normalizes all incoming arguments (lowercase, stripping underscores/hyphens, resolving spaces) and matches them against our global alias groups.

### 1. Database Connection Parameters
Specify connection details using your infrastructure's native keys.

Standard Term | Supported Key Variations & Aliases
| :--- | :--- |
| **Host** | host, hostname, server, ip, address, domain, endpoint, url, db_host, dbhost, db host, database_host |
| **Port** | port, portnumber, conn_port, connection_port, db_port, dbport, db port, database_port |
| **User** | user, username, uid, role, account, login, profile, db_user, dbuser, db user, database_user |
| **Password** | password, pass, pwd, secret, cred, credential, token, auth, db_password, dbpass, dbpwd |
| **Database/DB** | db, database, schema, db_list, dblist, db_name, database_name, target_db, source_database |

### 2. Operation Core (Work Mode & Slates)
Control how the module initializes actions.workMode Key Mapping: mode, workmode, work_mode, action, operation, job, task, type, command, direction, method, strategy, process, runmodeuploadType Key Mapping: type, uploadtype, upload_type, strategy, syncstrategy, sync_strategy, policy, conflictpolicy, conflict_policy, behaviorpath Key Mapping: path, dir, directory, folder, location, destination, source, target, filepath, folder_path, output_path, save_path (Pure path terms—no backup suffix configuration required)

## ⚙️ Work Mode Configurations
When assigning values to your configurations, you can use any matching action parameter value.Download / Export ActionsTriggers an output data compilation sequence.Accepted values: download, export, dump, extract, pull, retrieve, save, fetch, outbound (+ automatic variations like download_backup, downloadbackup, db_dump, data_export).Upload / Import ActionsFeeds data back into your target schema configuration.Accepted values: upload, import, load, restore, push, feed, ingest, inbound (+ automatic variations like upload_backup, uploadbackup, db_import, file_upload).

## 🎯 Upload & Synchronization Type Strategies
When running an Upload/Import work mode, passing down a strategy key configulates how primary key collisions or old vs. new data boundaries handle interactions. Every strategy parameter automatically processes base terms, _backup, backup, and  backup suffixes flawlessly.

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
                                        ├── clean -> Wipe table first
                                        ├── merge -> Safe skip / Protect old
                                        ├── replace -> Force overwrite / Newest wins
                                        └── force -> Force export file overwrite


🟩 1. Clean Strategy (cleanBackupAliases)
Destructive initialization. Wipes target structures entirely before dumping fresh dataset arrays.Values: clean, purge, truncate, reset, clear, empty, blank, wipeout, fresh, readd, mirror, wipe, sanitize, flush, initialize, obliterate

🟦 2. Merge / Keep Old Strategy (mergeKeepOldAliases)
Safe / Additive preservation. Inserts missing rows cleanly. If a record collision occurs, it acts as a protective shield for the live environment, skipping modifications or preserving the older row structure.Values: merge, upsert, update, sync, patch, combine, additive, append, integrate, blend, coalesce, amalgamate, intertwine, keepold, keepoldest, oldestwins, safemerge, skipexisting, preserve, ignoreconflicts, keep_old, skip_existing

🟨 3. Replace / Keep New Strategy (replaceKeepNewAliases)
Forceful update / Source-of-truth priority. Brute-forces updates over existing rows on key conflict, or dynamically processes data so the incoming dataset changes take precedence.Values: replace, overwrite, destructive, force, rewrite, supersede, override, clobber, overlay, substitute, keepnew, keepnewest, newestwins, smartmerge, timestampmerge, latest, recent, keep_new, smart_merge

🟥 4. Force Export Strategy (forceDownloadAliases)
File system layout enforcement. Forces systemic script parameters to bypass target confirmations and write directly over active directory file items.Values: forcedownload, force_download, forceexport, force_export, forcedump, overwrite_export, overwrite_download

📦 5. Scope Optimization (fullBackupAliases)
Scope validation toggles. Defines if operations encompass structural data aggregates as a comprehensive snapshot block.Values: full, complete, entire, all, total, comprehensive, max, bulk, whole

💻 Technical Usage ExampleJavaScriptimport { DBBackuper } from 'dbbackuper';

// Intentionally mixed/spaced config keys that map perfectly inside the engine
const messyUserConfig = {
    "db server": "127.0.0.1",
    "db_user": "root",
    "SECRET": "super_secure_pass",
    "target db": "production_warehouse",
    "work mode": "import_backup",          // Evaluates as Upload Mode
    "sync strategy": "skip_existing",      // Evaluates as Merge / Keep Old Strategy
    "folder path": "./backups/july_2026/"
};

const backupEngine = new DBBackuper(messyUserConfig);
await backupEngine.execute();
console.log("Operation handled successfully via automated alias extraction!");
📄 LicenseThis project is licensed under the MIT License - see the LICENSE file for details.