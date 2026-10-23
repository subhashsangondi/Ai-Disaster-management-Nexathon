export const MAX_DESCRIPTION_LENGTH = 1000;

export function validateIncident(values) {
  const errors = {};

  if (!values.category.trim()) errors.category = "Choose an emergency category.";
  if (!values.reporter_type.trim()) errors.reporter_type = "Choose who is reporting this emergency.";

  const description = values.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  if (
    values.people_affected !== null &&
    values.people_injured !== null &&
    values.people_injured > values.people_affected
  ) {
    errors.people_injured = "Injured people cannot exceed the number of people affected.";
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
