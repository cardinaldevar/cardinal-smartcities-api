const mongoose = require('mongoose');
const { Schema } = mongoose;
const slugify = require('slugify');

const DocketAreaSchema = new Schema({
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
        ref: 'DocketArea', 
        default: null
    },
    position: {
        type: Number,
        default: 0
    },
    address: {
        type: String,
        trim: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // Formato [longitud, latitud]
            default: [0, 0]
        }
    },
    keywords: {
        type: [String],
        default: []
    },
    searchText: {
        type: String,
        trim: true
    },
    status: {
        type: Number,
        required: true,
        default: 1 
    },
    zone:[{ type: mongoose.SchemaTypes.ObjectId, ref: 'Zone' }]
}, { timestamps: true });

DocketAreaSchema.index({ location: '2dsphere' });

DocketAreaSchema.pre('save', async function(next) {
    const doc = this;  
    const Model = mongoose.model('DocketArea');  

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

        doc.searchText = textParts.join(' ').toLowerCase();
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

const DocketArea = mongoose.model('DocketArea', DocketAreaSchema, 'incident.docket_areas');

module.exports = DocketArea;