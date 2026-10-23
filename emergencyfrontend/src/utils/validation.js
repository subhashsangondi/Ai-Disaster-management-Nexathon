export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 5000;

export function validateIncident(values) {
  const errors = {};
  const emergencyType = String(values.category ?? "").trim();
  const description = String(values.description ?? "").trim();

  if (emergencyType.length < 2) errors.category = "Choose an emergency category.";
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  if (!values.reporter_type) {
    errors.reporter_type = "Choose who is reporting.";
  }

  if (
    values.people_affected !== null
    && values.people_injured !== null
    && values.people_injured > values.people_affected
  ) {
    errors.people_injured = "Injured people cannot exceed the number of people affected.";
  }

  const victimPhone = String(values.victim_phone ?? "").trim();
  const volunteerPhone = String(values.volunteer_phone ?? "").trim();
  if (!victimPhone && !volunteerPhone) {
    errors.contact_phone = "Enter either the victim's or volunteer's phone number.";
  }

  for (const [field, phone] of [
    ["victim_phone", victimPhone],
    ["volunteer_phone", volunteerPhone],
  ]) {
    const digitCount = phone.replace(/\D/g, "").length;
    if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || digitCount < 7 || digitCount > 15)) {
      errors[field] = "Enter a valid number with 7–15 digits.";
    }
  }

  if (description && description.length < MIN_DESCRIPTION_LENGTH) {
    errors.description = `Describe the emergency in at least ${MIN_DESCRIPTION_LENGTH} characters.`;
  }

  const hasLatitude = values.latitude !== null && values.latitude !== undefined;
  const hasLongitude = values.longitude !== null && values.longitude !== undefined;
  const hasManualLocation = Boolean(String(values.location_text ?? "").trim());
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
