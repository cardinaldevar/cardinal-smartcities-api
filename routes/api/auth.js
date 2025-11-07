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
const CoreSection = require('../../models/CoreSection');
var randtoken = require('rand-token');

// Implement RefreshTokens
var refreshTokens = {} 

/**
 * Convierte una lista plana de secciones en un árbol jerárquico.
 * @param {Array} sections - Lista de secciones permitidas para el usuario.
 * @returns {Array} - Un array de objetos de menú anidados.
 */
const buildMenuTree = (sections) => {
    const map = new Map();
    const roots = [];

    // Primero, crea un mapa para acceso rápido y añade un array 'children' a cada sección.
    sections.forEach(section => {
        map.set(section._id.toString(), { ...section, children: [] });
    });

    // Ahora, itera de nuevo para anidar los hijos dentro de sus padres.
    sections.forEach(section => {
        if (section.parentId) {
            const parentIdStr = section.parentId.toString();
            if (map.has(parentIdStr)) {
                map.get(parentIdStr).children.push(map.get(section._id.toString()));
            }
        } else {
            // Si no tiene padre, es un elemento raíz.
            roots.push(map.get(section._id.toString()));
        }
    });

    return roots;
};

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
      /*  let user = await User.findOne({}).populate('company').populate('category').populate({
            path: 'access.id',
            model: 'core.section',
            select: 'name nameField position'
          }).then(user => {
            if (user && user.access && Array.isArray(user.access)) {
                user.access.sort((a, b) => a.id.position - b.id.position);
            }
            return user;
          });*/

          const [user, allSections] = await Promise.all([
            User.findOne({email,appSystem:true,status:1}).populate('company').populate('category').lean(),
            CoreSection.find({ status: 1 }).sort({ order: 1 }).lean() 
        ]);
       console.log('user',user)


        if(!user){
            return res.status(400).json({errors: [{msg:'Invalid Credential'}]});
        }
        
        bcrypt.compare(password,user.password)
        .then(async isMatch =>{

            if(isMatch){
                
                var query = { _id: user._id };
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

                   
                const userPermissions = user.access; 
                const visibleKeys = new Set(Object.keys(userPermissions).filter(key => userPermissions[key] !== 'none'));
                const explicitlyVisibleKeys = new Set(visibleKeys);

                const sectionMap = new Map(allSections.map(s => [s._id.toString(), s]));
                allSections.forEach(section => {
                    if (visibleKeys.has(section.key)) {
                        let current = section;
                        while (current && current.parentId) {
                            const parent = sectionMap.get(current.parentId.toString());
                            if (parent && !visibleKeys.has(parent.key)) {
                                visibleKeys.add(parent.key);
                            }
                            current = parent;
                        }
                    }
                });

                const userMenuSections = allSections
                    .filter(section => visibleKeys.has(section.key))
                    .map(section => ({
                        ...section,
                        permission: userPermissions[section.key] || 'none',
                        isDirectlyAccessible: explicitlyVisibleKeys.has(section.key)
                    }));
                    
                const finalMenuTree = buildMenuTree(userMenuSections);

                const payload ={
                    user:{
                        id:user._id,
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
                    access:finalMenuTree
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

    console.log('/me',req.user)
    try {
        const [user, allSections] = await Promise.all([
            User.findById(req.user.id).populate('company').populate('category').lean(),
            CoreSection.find({ status: 1 }).sort({ order: 1 }).lean() 
        ]);
        
        
        const userPermissions = user.access; 
        const visibleKeys = new Set(Object.keys(userPermissions).filter(key => userPermissions[key] !== 'none'));
        const explicitlyVisibleKeys = new Set(visibleKeys);

        const sectionMap = new Map(allSections.map(s => [s._id.toString(), s]));
        allSections.forEach(section => {
            if (visibleKeys.has(section.key)) {
                let current = section;
                while (current && current.parentId) {
                    const parent = sectionMap.get(current.parentId.toString());
                    if (parent && !visibleKeys.has(parent.key)) {
                        visibleKeys.add(parent.key);
                    }
                    current = parent;
                }
            }
        });

        const userMenuSections = allSections
            .filter(section => visibleKeys.has(section.key))
            .map(section => ({
                ...section,
                permission: userPermissions[section.key] || 'none',
                isDirectlyAccessible: explicitlyVisibleKeys.has(section.key)
            }));
            
        const finalMenuTree = buildMenuTree(userMenuSections);

        // El objeto de respuesta ya está bien, no necesita cambios
        res.json({
            _id: user._id,
            category: {degree: user.category.degree, name: user.category.name},
            role: user.category.role,
            username: user.name,
            fullName: user.name,
            email: user.email,
            fleetAccess: user.fleetAccess,
            avatar: user.avatar === null ? await getURLS3(user.company.logo,120, '') : await getURLS3(`xs_${user.avatar}`,120, ''),
            company: user.company._id,
            license: user.company.license,
            location: user.company.location,
            initialRegion: {
                latitude: user.company.location.coordinates && user.company.location.coordinates[1],
                longitude: user.company.location.coordinates && user.company.location.coordinates[0],
                latitudeDelta: 0.210,
                longitudeDelta: 0.210
            },
            country_code: user.company.country_code,
            timezone: user.company.timezone,
            access: finalMenuTree
        });
        
    } catch(err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;