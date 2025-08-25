const mongoose = require('mongoose');

const pollQuestionSchema = new mongoose.Schema({
    question:{ type:String, required: true},
    description:{ type:String, default:""},
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
});

module.exports = pollQuestion = mongoose.model('mechanical.question', pollQuestionSchema);