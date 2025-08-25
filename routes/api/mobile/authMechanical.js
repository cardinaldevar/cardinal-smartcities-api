const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const auth = require('../../../middleware/auth');
const User = require('../../../models/User');
const UserCategory = require('../../../models/UserCategory');
const Company = require('../../../models/Company');
const jwt = require('jsonwebtoken');
const config = require('config');
const { check, validationResult } = require('express-validator');
const { getURLS3, putObjectS3 } = require("../../../utils/s3.js");

// @route GET API USER
router.get('/', auth, async (req,res) => {

    try{
        const user = await User.findById(req.user.id).select('-password').populate('company').populate('category'); 
        
        res.json({
            _id:user._id,
            category:{degree:user.category.degree,name:user.category.name},
            name:user.name,
            email:user.email,
            fleetAccess:user.fleetAccess,
            avatar:user.avatar === null ? await getURLS3(`xs_${user.company.logo}`,120, '') : await getURLS3(`xs_${user.avatar}`,120, ''),
            company:user.company._id,
            license:user.company.license,
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

    console.log('APP',req.body);

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {email,password} = req.body;
    
    try {

        //see if user existe
        let user = await User.findOne({email,appMechanical:true,status:1}).populate('company').populate('category');
        //console.log(user)
        if(!user){
            return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
        }
        
        bcrypt.compare(password,user.password)
        .then(isMatch =>{

            if(isMatch){
                
                var query = { _id: user.id };
                var update = { last_connect: Date.now() };

                User.updateOne(query, update, function(err, result) {
                if (err) {
                    console.log("Something went wrong when updating");
                    return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
                } else {
                   // console.log(result);
                }
                });

                const payload ={
                
                    user:{
                        id:user.id,
                        company:user.company._id,
                        category:{degree:user.category.degree,name:user.category.name},
                        fleetAccess:user.fleetAccess,
                        license:user.company.license
                    }
                    
                }
                //console.log(user,payload);
                jwt.sign(
                    payload,config.get('jwtSecret'),
                    {expiresIn:36000},
                    (err,token)=>{
                        if(err) throw err;
                        res.json({token});
                    }
                );

            }else{
                return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
            }

        });

    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});

module.exports = router;