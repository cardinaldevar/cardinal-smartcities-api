const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const auth = require('../../middleware/auth');
const Nodes = require('../../models/Nodes');
const jwt = require('jsonwebtoken');
const config = require('config');
const { check, validationResult } = require('express-validator');
var randtoken = require('rand-token');

// Implement RefreshTokens
var refreshTokens = {} 


//@route POST API Auth
//@Desc Auth Nodes & Get Token
router.post('/auth',[
    check('host','Token Fail').isString(),
    check('password','Fail Password').not().isEmpty()
],async (req,res)=>{
    
    console.log(new Date(),'Node Login',req.body);
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {host,password} = req.body;
    
    try {

        //see if user existe
        let Node = await Nodes.findOne({host});
        //console.log(user)
        if(!Node){
            return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
        }
        bcrypt.compare(password,Node.password)
        .then(isMatch =>{

            if(isMatch){

                var query = { _id: Node.id };
                var update = { $set: { last_connect: Date.now() }};

                Nodes.updateOne(query, update, function(err, result) {
                if (err) {
                    console.log("Something went wrong when updating");
                    return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
                } else {
                   // console.log(result);
                }
                });

                const payload ={
                    node:{
                        id:Node.id,
                        name:Node.name,
                        host:Node.host
                    }
                }
                //console.log(user,payload);

                

                jwt.sign(
                    payload,config.get('jwtSecret'),
                    {expiresIn:36000},
                    (err,token)=>{
                        if(err) throw err;
                        // RefreshToken
                        var refreshToken = randtoken.uid(256);
                        refreshTokens[refreshToken] = Node.host;
                        res.json({token,refreshToken: refreshToken});
                    }
                );

            }else{
                console.log('error load user')
                return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
            }

        });

    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});


// Implement RefreshToken with local object
router.post('/token',[
    check('host','Token Fail').isString(),
    check('refreshToken','Token Fail').not().isEmpty()
],async (req,res)=>{

    console.log(req.body);
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    var host = req.body.host;
    var refreshToken = req.body.refreshToken;
    
    if((refreshToken in refreshTokens) && (refreshTokens[refreshToken] == host)) {
      var user = {
        'host': host,
      }
      var token = jwt.sign(user, config.get('jwtSecret'), { expiresIn: 300 })
      res.status(200).json({token});
    }

    else {
        res.status(401).send('Unauth');
    }
});

router.post('/token/reject',auth,[
    check('refreshToken','Token Fail').not().isEmpty()
],async (req,res)=>{

    if(req.user.category.degree != 0){
        return res.status(400).json({errors:'Not Auth'});
    }
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    var refreshToken = req.body.refreshToken;

    if(refreshToken in refreshTokens) { 
      delete refreshTokens[refreshToken]
    } 
    res.status(204).send('token clear')
 })


// CREATE NODE
router.post('/',auth,[
    check('node','Token Fail').isString(),
    check('host','Host Fail').isString(),
    check('password','Host Fail').isString(),
], async (req,res)=>{

    console.log('POST...',req.user.category.degree);
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    if(req.user.category.degree != 0){
        return res.status(400).json({errors:'Not Auth'});
    }
    
    const {node,password,host} = req.body;
    
    try {

        //see if user exist3
        let user = await Nodes.findOne({name:node});
        if(user){
            return res.status(400).json({errors: [{msg:'El Nodo ya existe'}]});
        }
        
        NewNode = new Nodes({
            name:node,
            password,
            host
        });

        // encrypt pass
        const salt = await bcrypt.genSalt(10);
        NewNode.password = await bcrypt.hash(password,salt);
        await NewNode.save();

        res.json({created:NewNode.id,name:node});

    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});


module.exports = router;