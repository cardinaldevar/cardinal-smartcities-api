const mongoose = require('mongoose');
mongoose.pluralize(null);
const config = require('config');
const dbCore = config.get('mongoURICore');

const connectDBCore = async () =>{
    try {
        await mongoose.connect(dbCore);
        console.log('Mongo - Cardinal Core, Connected');
    }catch(err){
        console.error(err.message);
        process.exit(1);
    }
}

module.exports = connectDBCore;