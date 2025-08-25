
const turf = require('@turf/turf');

const FixLineString = (feature) => {
    
    // Selecciona el primer punto como referencia
    const [firstLng, firstLat] = feature.geometry.coordinates[0];

    // Compara todos los puntos con el primer punto
    const sonIguales = feature.geometry.coordinates.every(([lng, lat]) => lng === firstLng && lat === firstLat);

    if (sonIguales) {
        // Si todos los puntos son iguales, devuelve dos puntos:
        // El primero es el punto original, y el segundo es uno casi idéntico usando Turf.js

        const puntoOriginal = [firstLng, firstLat];

        // Genera un punto casi idéntico utilizando un desplazamiento muy pequeño (e.g., 1 metro)
        const puntoCasiIdentico = turf.destination(turf.point(puntoOriginal), 0.001, 90); // 0.001 km (1 metro) al este
        return {
            type: 'Feature',
            properties: {validate:false},
            geometry: {
              type: 'LineString',
              coordinates: [puntoOriginal, puntoCasiIdentico.geometry.coordinates]
            }
          };

    } else {

        // Si no todos los puntos son iguales
        return feature;
    }
}

module.exports = FixLineString;