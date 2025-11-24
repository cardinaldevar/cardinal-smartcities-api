// helpers/nlpHelper.js
const axios = require('axios');
const IncidentDocketType = require('../models/IncidentDocketType'); 

async function predictCategory(text) {
    try {
        const url = `${process.env.TIGRESIRVE_NLP_URL}/predict`;
        const response = await axios.post(url, { text });
        const predictionPayload = response.data;

        if (!predictionPayload.categories || predictionPayload.categories.length === 0) {
            return null; // O manejar error
        }

        // Extraer IDs
        const categoryIds = predictionPayload.categories.map(cat => cat._id).filter(id => id);

        if (categoryIds.length === 0) {
            return predictionPayload.categories[0]; // Retorno raw si no hay IDs mongo
        }

        // Buscar en DB
        const docketTypes = await IncidentDocketType.find({
            '_id': { $in: categoryIds }
        }).populate('parent');

        const docketTypesMap = new Map(docketTypes.map(dt => [dt._id.toString(), dt]));

        // Enriquecer
        const enrichedCategories = predictionPayload.categories.map(cat => {
            const docketTypeInfo = docketTypesMap.get(cat._id);
            if (docketTypeInfo) {
                return {
                    ...cat,
                    mongoId: docketTypeInfo._id, // Guardamos el ID real de Mongo
                    name: docketTypeInfo.name,
                    parent: docketTypeInfo.parent?.name || null,
                    fields: docketTypeInfo.fields
                };
            }
            return cat;
        });

        // Devolvemos solo lo que le importa al Bot: la mejor predicción y la lista completa
        return {
            bestMatch: enrichedCategories.length > 0 ? enrichedCategories[0] : null,
            allOptions: enrichedCategories
        };

    } catch (error) {
        console.error('Error en NLP:', error);
        return null;
    }
}

module.exports = { predictCategory };