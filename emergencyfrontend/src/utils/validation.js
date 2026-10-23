export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 5000;

export function validateIncident(values) {
  const errors = {};
  const emergencyType = values.category.trim();
  const description = values.description.trim();

  if (emergencyType.length < 2) errors.category = "Choose an emergency category.";
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    errors.description = `Describe the emergency in at least ${MIN_DESCRIPTION_LENGTH} characters.`;
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  const hasLatitude = values.latitude !== null && values.latitude !== undefined;
  const hasLongitude = values.longitude !== null && values.longitude !== undefined;
  const hasManualLocation = Boolean(values.location_text.trim());
  let coordinatesAreValid = false;

  if (hasLatitude && hasLongitude) {
    const validLatitude = Number.isFinite(values.latitude) && values.latitude >= -90 && values.latitude <= 90;
    const validLongitude = Number.isFinite(values.longitude) && values.longitude >= -180 && values.longitude <= 180;
    coordinatesAreValid = validLatitude && validLongitude;
    if (!coordinatesAreValid && !hasManualLocation) {
      errors.location = "GPS coordinates are invalid. Enter a manual location.";
    }
  } else if ((hasLatitude || hasLongitude) && !hasManualLocation) {
    errors.location = "A complete latitude and longitude pair is required.";
  }

  if (!coordinatesAreValid && !hasManualLocation && !errors.location) {
    errors.location = "Use your current location or enter a location manually.";
  }

  return errors;
}
