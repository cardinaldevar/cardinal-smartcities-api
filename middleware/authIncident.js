const jwt = require('jsonwebtoken');

module.exports = function(req, res, next){
    //Get Token from header
    const token = req.header('x-auth-token');
    //check if no token
    if(!token){
        return res.status(401).json({msg:'No Token, auth denied'})
    }

    //verify token
    try{
        
        const decoded = jwt.verify(token,process.env.SEC_TOKEN_INCIDENT);
        req.user = decoded.user;
        next();
        
    }catch(err){
        res.status(401).json({msg:'Token is not valid'});
    }
}