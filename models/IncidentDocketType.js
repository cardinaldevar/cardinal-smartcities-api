const mongoose = require('mongoose');
const { Schema } = mongoose;
const slugify = require('slugify');

const DocketTypeSchema = new Schema({
    company: { type: mongoose.Schema.Types.ObjectId,ref: 'company'},
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        unique: true,
        trim: true
    },
    parent: {
        type: Schema.Types.ObjectId,
        ref: 'DocketType', 
        default: null
    },
    position: {
        type: Number,
        default: 0
    },
    fields: [
        {
            key: { type: String, required: true },
            label: { type: String, required: true },
            fieldType: {
                type: String,
                required: true,
                enum: ['text', 'textarea', 'number', 'date', 'select', 'checkbox','files','address']
            },
            required: { type: Boolean, default: false },
            validation: { type: String, default: null },
            placeholder: { type: String },
            options: [
                {
                    value: { type: String },
                    label: { type: String }
                }
            ]
        }
    ],
    keywords: {
        type: [String],
        default: []
    },
    searchText: {
        type: String,
        trim: true
    },
    docket_area: [{
        type: Schema.Types.ObjectId,
        ref: 'DocketArea'
    }],
    status: {
        type: Number,
        required: true,
        default: 1 
    },
});

DocketTypeSchema.index({ name:1,company: 1, searchText: 'text',status:1 });
DocketTypeSchema.pre('save', async function(next) {
    const doc = this; // 'this' es el documento que se va a guardar
    const Model = mongoose.model('DocketType'); // Obtenemos el modelo

    // --- Lógica para searchText (Tu código original) ---
    // (Se ejecuta si cambia el nombre, padre o keywords)
    if (doc.isModified('name') || doc.isModified('parent') || doc.isModified('keywords')) {
        
        const textParts = [];
        if (doc.name) {
            textParts.push(doc.name);
        }

        if (doc.parent) {
            try {
                // Buscamos el padre para el searchText
                const parentDoc = await Model.findById(doc.parent).select('name').lean();
                if (parentDoc && parentDoc.name) {
                    textParts.push(parentDoc.name);
                }
            } catch (error) {
                console.error("Error fetching parent document for searchText:", error);
            }
        }

        if (doc.keywords && doc.keywords.length > 0) {
            textParts.push(...doc.keywords);
        }

        doc.searchText = textParts.map(part => part.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).join(' ').toLowerCase();
    }


    // ---  Lógica para el Slug Hierárquico ---
    if (doc.isModified('name') || doc.isModified('parent')) {
        
        const selfSlug = slugify(doc.name, { 
            lower: true, 
            strict: true, 
            replacement: '_' 
        });

        let parentSlug = '';

        // 2. Si tiene padre, buscar el slug del padre
        if (doc.parent) {
            try {
                const parentDoc = await Model.findById(doc.parent).select('slug').lean();
                if (parentDoc && parentDoc.slug) {
                    parentSlug = parentDoc.slug;
                }
            } catch (error) {
                console.error("Error fetching parent document for slug:", error);
                // Continuamos, pero el slug no tendrá la jerarquía completa
            }
        }

        // Ej: "reclamo_alumbrado" + "_" + "problema_de_alumbrado"
        const baseSlug = parentSlug ? `${parentSlug}_${selfSlug}` : selfSlug;

        let newSlug = baseSlug;
        let counter = 1;
        let slugExists = true;

        while (slugExists) {

            const conflict = await Model.findOne({ 
                slug: newSlug,
                _id: { $ne: doc._id } // Excluye este mismo documento
            });
            
            if (!conflict) {
                slugExists = false; // No hay conflicto, slug es único
            } else {
                // Conflicto. Prueba con "reclamo_alumbrado_2", "reclamo_alumbrado_3", etc.
                counter++;
                newSlug = `${baseSlug}_${counter}`;
            }
        }
        
        doc.slug = newSlug;
    }

    next();
});

const DocketType = mongoose.model('DocketType', DocketTypeSchema, 'incident.docket_types');

module.exports = DocketType;