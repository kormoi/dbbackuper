const fncs = require('./functions');
const cstyler = require('cstyler');
const dbtasker = require("dbtasker");



async function uploadData(config, data, operation) {
    try {
        const dbtaskerdata = data.dbtaskerdata;
        const rows = data.rows;

        config.dropdb = false;
        config.droptable = false;
        config.dropcol = false;
        config.sep = "_";
        config.forceupdatecolumn = true;
        const operatedb = await dbtasker(config, dbtaskerdata);
    } catch (err) {
        console.error(err.message);
        return null;
    }
}


module.exports = {
    uploadData
}