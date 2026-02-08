// Geometry utilities for point-in-polygon checks

/**
 * Ray-casting point-in-polygon test.
 * @param {number} lat - Latitude of point
 * @param {number} lng - Longitude of point
 * @param {Array} ring - Array of [lng, lat] coordinates (GeoJSON order)
 * @returns {boolean}
 */
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Check if a point is inside a GeoJSON Polygon or MultiPolygon geometry.
 * @param {number} lat
 * @param {number} lng
 * @param {Object} geometry - GeoJSON geometry object
 * @returns {boolean}
 */
function pointInGeometry(lat, lng, geometry) {
  if (geometry.type === "Polygon") {
    // First ring is outer boundary, rest are holes
    if (!pointInRing(lat, lng, geometry.coordinates[0])) return false;
    for (let i = 1; i < geometry.coordinates.length; i++) {
      if (pointInRing(lat, lng, geometry.coordinates[i])) return false;
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      if (pointInRing(lat, lng, polygon[0])) {
        // Check holes
        let inHole = false;
        for (let i = 1; i < polygon.length; i++) {
          if (pointInRing(lat, lng, polygon[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
  }
  return false;
}

/**
 * Find which state a lat/lng point falls in.
 * @param {number} lat
 * @param {number} lng
 * @param {Object} geoJsonData - FeatureCollection of India states
 * @returns {string|null} stateId or null if outside all states
 */
function findStateForPoint(lat, lng, geoJsonData) {
  for (const feature of geoJsonData.features) {
    if (pointInGeometry(lat, lng, feature.geometry)) {
      return feature.properties.stateId;
    }
  }
  return null;
}

/**
 * Check if a point is inside a specific state.
 * @param {number} lat
 * @param {number} lng
 * @param {string} stateId
 * @param {Object} geoJsonData - FeatureCollection
 * @returns {boolean}
 */
function isPointInState(lat, lng, stateId, geoJsonData) {
  const feature = geoJsonData.features.find(
    (f) => f.properties.stateId === stateId
  );
  if (!feature) return false;
  return pointInGeometry(lat, lng, feature.geometry);
}
