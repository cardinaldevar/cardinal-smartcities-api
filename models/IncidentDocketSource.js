const mongoose = require('mongoose');
const { Schema } = mongoose;

const DocketSourceSchema = new Schema({
    createdAt: {
        type: Date,
        default: Date.now
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    company: { type: Schema.Types.ObjectId, ref: 'company' },
    locked: { type: Boolean, default: false },
    status: { type: Number, default: 1}, //0 inactivo , 1 activo, 2 eliminado, 3 archivado
}, { timestamps: true });

DocketSourceSchema.index({ name: 1, company: 1 }, { unique: true });
DocketSourceSchema.pre('remove', function(next) {
    if (this.locked) {
        // Si es una fuente del sistema, bloqueamos el borrado.
        const err = new Error('System sources cannot be deleted.');
        return next(err);
    }
    next();
});
const DocketSource = mongoose.model('DocketSource', DocketSourceSchema, 'incident.source');

module.exports = DocketSource;