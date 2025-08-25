const mongoose = require('mongoose');

mongoose.pluralize(null);
const config = require('config');
const dbURI = config.get('mongoURI');
const dbCoreURI = config.get('mongoURICore');

const connectDB = async () =>{
   try {
        await mongoose.connect(dbURI);
        console.log('Mongo - Cardinal, Connected');
    }catch(err){
        console.error(err.message);
        process.exit(1);
    }

  /*  try {
        const db = await mongoose.createConnection(dbURI, {
            useNewUrlParser: true,useCreateIndex: true, useFindAndModify: false
        })
        const dbCore = await mongoose.createConnection(dbCoreURI, {
            useNewUrlParser: true,useCreateIndex: true, useFindAndModify: false
        })
            console.log("Connected Mongo Dbs")
            return {
                    db,
                    dbCore
              }

        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
*/

}

module.exports = connectDB;