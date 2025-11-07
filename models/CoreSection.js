const mongoose = require('mongoose');

const CoreSectionSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, trim: true},
    title: { type: String, required: true },
    path: { type: String, default: null },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'core.section2',
        default: null
    },
    icon: { type: String },
    order: { type: Number, default: 0 },
    isGroupHeader: { type: Boolean, default: false },
    status:{ type:Number, required: true, default: 1 }
});

module.exports = coreSection = mongoose.model('core.section2', CoreSectionSchema);