require('dotenv').config();
var cors = require('cors');
const cron = require('node-cron')
const express = require("express");
const connectDB = require("./config/db");
const path = require("path");
const app = express();
const config = require('config');
const moment = require('moment');
// Socket IO
const server = require('http').createServer(app);
const io = require('socket.io')(server, { origins: '*:*'});
const socketioJwt = require('socketio-jwt');
//const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cronFn = require("./cron2");
const PositionPanic = require('./models/PositionPanic');
const Vehicle = require('./models/Vehicle');
const VehicleRoute = require('./utils/VehicleRoute');
const AlertJob = require('./utils/AlertJob');
const initializeDocketNotifier = require('./utils/DocketNotify');

connectDB();

if(process.env.NODE_ENV === 'production'){ 
  initializeDocketNotifier();
  AlertJob();
}

//global = connectDB();
//console.log('GLOBAL',global); //connect DB

var whitelist = ['https://ts-landing.cardinal.dev','https://gemini.cardinal.dev','https://admin.cardinal.dev','https://b763b788b690.ngrok-free.app','http://ec2-3-136-118-80.us-east-2.compute.amazonaws.com/','http://localhost:3000','http://localhost:3001','http://localhost:8080','http://ec2-3-136-118-80.us-east-2.compute.amazonaws.com:3000','http://ec2-3-136-118-80.us-east-2.compute.amazonaws.com:5000','http://www.cardinaltigre.com','https://cardinaltigre.com','https://www.cardinaltigre.com','http://api.cardinaltigre.com','https://api.cardinaltigre.com','https://urbaser.cardinal.dev']

const corsOptions = {

  origin: function (origin, callback) {
    //console.log(origin)
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error("Not allowed by CORS"))
    }
  },
  credentials: true,
}


/*
// Socket IO
io.use((socket, next) => {

  //console.log(socket.handshake.headers,socket.handshake.query.token)
  let token = socket.handshake.query.token;
  //console.log('token:',token,typeof(token))

  if(!token || token === 'undefined'){
    return next(new Error('No Token, auth denied'));
  }

  if(jwt.verify(token,config.get('jwtSecret'))){

    console.log('access verified')
    //const decoded = jwt.verify(token,config.get('jwtSecret'));
    //req.user = decoded.user;
    return next();

  }else{

    console.log('authentication error');
    return next(new Error('authentication error'));

  }
  
  
});*/

cron.schedule("*/30 * * * *", () => {
  if(process.env.NODE_ENV === 'production'){ 
    console.log('-- BIOMETRIC CRON ACCESS', moment().format('DD/MM/YY HH:mm:ss'))
    cronFn()
  }
})

//SocketIO with JWT
io.use(socketioJwt.authorize({
  secret: config.get('jwtSecret'),
  handshake: true
}));

 
io.on('connection', (socket) => {
  console.log('*> hello socket!', socket.decoded_token.user.id);

  const ChannelCompany = socket.decoded_token.user.company;
  const companyID = new mongoose.Types.ObjectId(socket.decoded_token.user.company);

  PositionPanic.watch([
    { $match : {"operationType" : "insert" } }
    ]).on('change', async data => {
    
    console.log(data.fullDocument.deviceID)

    const PanicQuery = await Vehicle.exists({DeviceID:{$eq:data.fullDocument.deviceID},company:companyID}, function(err, result) {
     // console.log(result)
     // console.log(data.fullDocument);
      if (result) {
        socket.emit(`${socket.decoded_token.user.company}`, `El interno ${data.fullDocument.deviceID} necesita ayuda.`);
        console.log(`emit panic -${socket.decoded_token.user.company}`);
      }
    });
   
  });

  socket.on("disconnect", () => {
      console.log("*> Client disconnected:",socket.decoded_token.user.id);
  });

});

/*
var numUsers = 0;

io.on('connection', (socket) => {
  var addedUser = false;
  console.log('connected socket');
  let token = socket.handshake.query.token;

  const decoded = jwt.verify(token,config.get('jwtSecret'));

  const ChannelCompany = decoded.user.company;
  console.log("New client connected",decoded.user.company);
  
  const companyID = new mongoose.Types.ObjectId(decoded.user.company);

  
  socket.on('clientConnect', (username) => {
    console.log('recieve clientConnect',username,addedUser)
    if (addedUser) return;

    // we store the username in the socket session for this client
    socket.username = username._id;
    ++numUsers;
    addedUser = true;

  });

  PositionPanic.watch([
    { $match : {"operationType" : "insert" } }
    ]).on('change', async data => {
    
    console.log(data.fullDocument.deviceID)

    const PanicQuery = await Vehicle.exists({DeviceID:{$eq:data.fullDocument.deviceID},company:companyID}, function(err, result) {
     // console.log(result)
     // console.log(data.fullDocument);
      if (result) {
        socket.emit(`${decoded.user.company}`, `El interno ${data.fullDocument.deviceID} necesita ayuda.`);
        console.log(`emit panic -${decoded.user.company}`);
      }
    });
   
  });

  socket.on("disconnect", () => {

    if (addedUser) {
      --numUsers;
      console.log("Client disconnected",socket.username);
      addedUser = false;
    }
   // clearInterval(interval);
  });


});
*/
/*
server.listen(9000, function () {
  console.log('Socket on https://localhost:9000');
});
*/

/////////////////////////

/*cron.schedule("* * * * *",()=> {
  log("logs every minute", new Date())
})
*/


cron.schedule("1 * * * *",()=> {
  if(process.env.NODE_ENV === 'production'){ 
    console.log("VehicleRoute running", new Date())
    VehicleRoute();
  }
});


app.use(cors(corsOptions));
//,credentials: true
//app.get("/", (req, res) => res.send("API RUNNING"));
app.use(express.json({ extended: true,limit: '15mb' }));

//define routes
app.use("/api/user", require("./routes/api/user"));
app.use("/api/auth", require("./routes/api/auth"));
app.use("/api/mobile/auth", require("./routes/api/mobile/authMechanical"));
app.use("/api/profile", require("./routes/api/profile"));
app.use("/api/dashboard", require("./routes/api/dashboard"));
app.use("/api/live", require("./routes/api/live"));
app.use("/api/V2/live", require("./routes/api/liveV2"));
app.use("/api/report", require("./routes/api/report"));
//app.use("/api/geo", require("./routes/api/reportTest"));
app.use("/api/fleet", require("./routes/api/fleet"));

app.use("/api/employee", require("./routes/api/employee"));
app.use("/api/zone", require("./routes/api/zone"));
app.use("/api/poll", require("./routes/api/poll"));
app.use("/api/mechanical", require("./routes/api/mechanical"));
app.use("/api/panic", require("./routes/api/panic"));
app.use("/api/nodes", require("./routes/api/nodes"));
app.use("/api/access", require("./routes/api/access"));
app.use("/api/service", require("./routes/api/service"));
app.use("/api/sensor", require("./routes/api/sensor"));
app.use("/api/map", require("./routes/api/map"));

//API VERSION 2
app.use("/api/garage", require("./routes/api/garage"));
app.use("/api/V2/fleet", require("./routes/api/fleetV2"));
app.use("/api/alert", require("./routes/api/alert"));
app.use("/api/incident", require("./routes/api/incident"));
//app.use("/api/import", require("./routes/api/IMPORTFLEET"));
//app.use("/api/position", require("./routes/api/position"));

//EXTERNAL SERVICES
app.use("/api/incident/external", require("./routes/api/incident/external"));
//LANDING SERVICES
app.use("/api/public/landing", require("./routes/api/public/landing"));

//server static assets in production
/*if(process.env.NODE_ENV === 'production'){
  //set static folder
  app.use(express.static('client/build'));
  app.get('*',(req,res)=>{
    res.sendFile(path.resolve(__dirname,'client','build','index.html'))
  });
}*/
console.log('node_env',process.env.NODE_ENV);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(` Server start ${PORT}`));
