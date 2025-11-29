const mongoose = require('mongoose');
const { Schema } = mongoose;

const IncidentDocketTypeValidateSchema = new Schema({
    company: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    // La 'llave' o nombre del campo a validar. Ej: 'abl'
    key: {
        type: String,
        required: true
    },
    // El 'valor' esperado para esa llave. Ej: '123'
    value: {
        type: String,
        required: true
    }
}, { timestamps: true });

// Índice compuesto para optimizar las búsquedas de validación.
// Asegura que no haya duplicados para la misma combinación de compañía, llave y valor.
IncidentDocketTypeValidateSchema.index({ company: 1, key: 1, value: 1 }, { unique: true });

module.exports = mongoose.model('IncidentDocketTypeValidate', IncidentDocketTypeValidateSchema, 'incident.docket_types.validate');
