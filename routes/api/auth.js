const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const auth = require('../../middleware/auth');
const User = require('../../models/User');
const UserCategory = require('../../models/UserCategory');
const Company = require('../../models/Company');
const jwt = require('jsonwebtoken');
const config = require('config');
const { getURLS3 } = require("../../utils/s3.js");
const { check, validationResult } = require('express-validator');
var randtoken = require('rand-token');

// Implement RefreshTokens
var refreshTokens = {} 


// @route GET API USER
router.get('/', auth, async (req,res) => {
    try{
        const user = await User.findById(req.user.id).select('-password').populate('company').populate('category'); 
        //console.log('Load User');
        res.json({
            _id:user._id,
            category:{degree:user.category.degree,name:user.category.name},
            name:user.name,
            email:user.email,
            fleetAccess:user.fleetAccess,
            avatar:user.avatar === null ? await getURLS3(user.company.logo,120, '') :  await getURLS3(user.avatar,120, ''),
            company:user.company._id,
            license:user.company.license,
            access:user.access,
            timezone:user.company.timezone
        });
        
    }catch(err){
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

//@route POST API Auth
//@Desc Auth User & Get Token
router.post('/',[
    check('email','Ingrese un Email por favor').isEmail(),
    check('password','La contraseña es requerida.').not().isEmpty()
],async (req,res)=>{
    
    console.log(new Date(),req.body);

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {email,password} = req.body;
    
    try {

        //see if user existe
        let user = await User.findOne({email,appSystem:true}).populate('company').populate('category').populate({
            path: 'access.id',
            model: 'core.section',
            select: 'name nameField position'
          }).then(user => {
            if (user && user.access && Array.isArray(user.access)) {
                user.access.sort((a, b) => a.id.position - b.id.position);
            }
            return user;
          });


        if(!user){
            return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
        }
        
        bcrypt.compare(password,user.password)
        .then(async isMatch =>{

            if(isMatch){
                
                var query = { _id: user.id };
                var update = { $set: { last_connect: Date.now() }};

                const UserUpdate = User.updateOne(query, update);
                UserUpdate.exec().then(function(result) {
                    if (!result) {
                        console.log("Something went wrong when updating");
                        return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
                    } else {
                       // console.log(result);
                    }
                }).catch(function(error) {
                  console.log('UserUpdate',error)
                });

                const payload ={
                    user:{
                        id:user.id,
                        name:user.name,
                        email:user.email,
                        company:user.company._id,
                        category:{degree:user.category.degree,name:user.category.name},
                        fleetAccess:user.fleetAccess,
                        license:user.company.license,
                        role:user.category.role,
                        country_code:user.company.country_code,
                        timezone:user.company.timezone
                    }
                    
                }
                
                let userData = {
                    _id:user._id,
                    category:{degree:user.category.degree,name:user.category.name},
                    role:user.category.role,
                    username:user.name,
                    fullName:user.name,
                    email:user.email,
                    fleetAccess:user.fleetAccess,
                    avatar:user.avatar === null ?  await getURLS3(user.company.logo,120, '') :  await getURLS3(`xs_${user.company.logo}`,120, ''),
                    company:user.company._id,
                    license:user.company.license,
                    location:user.company.location,
                    initialRegion:{
                        latitude: user.company.location.coordinates && user.company.location.coordinates[1],
                        longitude: user.company.location.coordinates && user.company.location.coordinates[0],
                        latitudeDelta: 0.210,
                        longitudeDelta: 0.210
                    },
                    country_code:user.company.country_code,
                    timezone:user.company.timezone,
                    access:user.access.map(a => {return {value:a.value,name:a.id.name,nameField:a.id.nameField,position:a.id.position} } )
                };


                jwt.sign(
                    payload,config.get('jwtSecret'),
                    {expiresIn:21600},//36000
                    (err,token)=>{
                        if(err) throw err;

                        res.json({token,userData});
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


// @route GET API USER
router.get('/me', auth, async (req,res) => {

    try{
        const user = await User.findById(req.user.id).populate('company').populate('category').populate({
            path: 'access.id',
            model: 'core.section',
            select: 'name nameField position'
          }).then(user => {
            if (user && user.access && Array.isArray(user.access)) {
                user.access.sort((a, b) => a.id.position - b.id.position);
            }
            return user;
          });
          
        res.json({
            _id:user._id,
            category:{degree:user.category.degree,name:user.category.name},
            role:user.category.role,
            username:user.name,
            fullName:user.name,
            email:user.email,
            fleetAccess:user.fleetAccess,
            avatar:user.avatar === null ?  await getURLS3(user.company.logo,120, '') :  await getURLS3(`xs_${user.avatar}`,120, ''),
            company:user.company._id,
            license:user.company.license,
            location:user.company.location,
            initialRegion:{
                latitude: user.company.location.coordinates && user.company.location.coordinates[1],
                longitude: user.company.location.coordinates && user.company.location.coordinates[0],
                latitudeDelta: 0.210,
                longitudeDelta: 0.210
            },
            country_code:user.company.country_code,
            timezone:user.company.timezone,
            access:user.access.map(a => {return {value:a.value,name:a.id.name,nameField:a.id.nameField,position:a.id.position} } )
        });
        
    }catch(err){
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;