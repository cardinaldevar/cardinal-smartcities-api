const mongoose = require('mongoose');

const userCategorySchema = new mongoose.Schema({
    name:{ type:String, required: true},
    degree:{ type:Number, required: true},
    role:{ type:String, default:""}
});

module.exports = userCategory = mongoose.model('users.category', userCategorySchema);