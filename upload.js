const fncs = require('./functions');
const cstyler = require('cstyler');
const dbtasker = require("dbtasker");




async function uploadData(config, data) {
    try{
        const raw = data.raw;
        const dbtaskerdata = data.dbtaskerdata;
        const rows = data.rows;

    } catch(err){
        console.error(err.message);
        return null;
    }
}


module.exports = {
    uploadData
}